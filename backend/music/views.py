import shutil
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.http import JsonResponse
from django.utils.text import slugify

from mutagen import File as MutagenFile
from mutagen.id3 import ID3

from rest_framework import status, viewsets
from rest_framework.decorators import api_view, action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .models import Song
from .serializers import SongSerializer
from .services import AudioProcessingError, process_audio, song_storage_key


def extract_mp3_metadata(uploaded):
    """
    Read common MP3 tags and the first embedded ID3 album-art image.

    Returns a dictionary. Missing or unreadable tags are treated as empty,
    allowing the caller to fall back to the filename or user-entered values.
    """
    metadata = {
        "title": "",
        "artist": "",
        "album": "",
        "genre": "",
        "cover": None,
    }

    try:
        uploaded.seek(0)
        tags = MutagenFile(uploaded, easy=True)
        if tags:
            for field in ("title", "artist", "album", "genre"):
                values = tags.get(field) or []
                if values:
                    metadata[field] = str(values[0]).strip()
    except Exception:
        # Untagged or unusual MP3 files can still be uploaded.
        pass

    try:
        uploaded.seek(0)
        id3 = ID3(uploaded)
        pictures = id3.getall("APIC")
        if pictures:
            picture = pictures[0]
            mime = (picture.mime or "").lower()
            if mime in ("image/jpeg", "image/jpg"):
                extension = "jpg"
            elif mime == "image/png":
                extension = "png"
            elif mime == "image/webp":
                extension = "webp"
            else:
                extension = "jpg"

            safe_title = slugify(metadata["title"]) or "album-cover"
            metadata["cover"] = ContentFile(
                picture.data,
                name=f"{safe_title}.{extension}",
            )
    except Exception:
        # Artwork is optional; do not reject a valid MP3 if it has no APIC tag.
        metadata["cover"] = None
    finally:
        uploaded.seek(0)

    return metadata


def metadata_values(uploaded, supplied=None):
    """Prefer embedded tags; fall back to explicitly supplied values/filename."""
    supplied = supplied or {}
    embedded = extract_mp3_metadata(uploaded)
    filename_title = Path(uploaded.name).stem

    return {
        "title": (embedded["title"] or supplied.get("title") or filename_title)[:200],
        "artist": (embedded["artist"] or supplied.get("artist") or "Unknown artist")[:200],
        "album": (embedded["album"] or supplied.get("album") or "")[:200],
        "genre": (embedded["genre"] or supplied.get("genre") or "")[:100],
        "cover": embedded["cover"] or supplied.get("cover"),
    }


@api_view(["GET"])
def health_check(request):
    return JsonResponse({"status": "ok", "application": "Jacked API"})


class SongViewSet(viewsets.ModelViewSet):
    queryset = Song.objects.all()
    serializer_class = SongSerializer
    parser_classes = [MultiPartParser, FormParser]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        uploaded = serializer.validated_data["original_file"]
        metadata = metadata_values(uploaded, serializer.validated_data)

        # Embedded ID3 metadata takes priority; user-entered values are fallbacks.
        song = serializer.save(
            title=metadata["title"],
            artist=metadata["artist"],
            album=metadata["album"],
            genre=metadata["genre"],
            cover=metadata["cover"],
        )

        try:
            process_audio(song)
        except Exception as exc:
            song.processing_status = "failed"
            song.save(update_fields=["processing_status"])
            detail = (
                str(exc)
                if isinstance(exc, AudioProcessingError)
                else "Unexpected processing error: " + str(exc)
            )
            return Response(
                {
                    "error": "Audio processing failed",
                    "details": detail,
                    "song_id": song.pk,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            self.get_serializer(song).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="bulk-upload")
    def bulk_upload(self, request):
        files = request.FILES.getlist("files") or request.FILES.getlist("original_files")
        if not files:
            return Response({"error": "Select one or more MP3 files."}, status=400)

        results = []
        errors = []

        for uploaded in files:
            if Path(uploaded.name).suffix.lower() != ".mp3":
                errors.append({
                    "file": uploaded.name,
                    "error": "Only MP3 files are supported.",
                })
                continue

            if uploaded.size > 100 * 1024 * 1024:
                errors.append({
                    "file": uploaded.name,
                    "error": "MP3 must be 100 MB or smaller.",
                })
                continue

            try:
                metadata = metadata_values(uploaded)

                song = Song.objects.create(
                    title=metadata["title"],
                    artist=metadata["artist"],
                    album=metadata["album"],
                    genre=metadata["genre"],
                    original_file=uploaded,
                    cover=metadata["cover"],
                )

                process_audio(song)
                results.append(
                    SongSerializer(song, context={"request": request}).data
                )

            except Exception as exc:
                errors.append({
                    "file": uploaded.name,
                    "error": str(exc),
                })

            finally:
                uploaded.seek(0)

        response_status = status.HTTP_201_CREATED if results else status.HTTP_400_BAD_REQUEST
        return Response(
            {
                "uploaded": results,
                "errors": errors,
                "count": len(results),
            },
            status=response_status,
        )

    def destroy(self, request, *args, **kwargs):
        song = self.get_object()

        if song.original_file:
            song.original_file.delete(save=False)

        if song.cover:
            song.cover.delete(save=False)

        hls_dir = Path(settings.MEDIA_ROOT) / "hls" / song_storage_key(song)
        if hls_dir.exists():
            shutil.rmtree(hls_dir, ignore_errors=True)

        song.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
