import shutil
from pathlib import Path
from django.conf import settings
from django.http import JsonResponse
from rest_framework import status, viewsets
from rest_framework.decorators import api_view
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from .models import Song
from .serializers import SongSerializer
from .services import AudioProcessingError, process_audio

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
        song = serializer.save()
        try:
            process_audio(song)
        except Exception as exc:
            song.processing_status = "failed"
            song.save(update_fields=["processing_status"])
            detail = str(exc) if isinstance(exc, AudioProcessingError) else "Unexpected processing error: " + str(exc)
            return Response(
                {"error": "Audio processing failed", "details": detail, "song_id": song.pk},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(self.get_serializer(song).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        song = self.get_object()
        song_id = song.pk
        if song.original_file:
            song.original_file.delete(save=False)
        if song.cover:
            song.cover.delete(save=False)
        hls_dir = Path(settings.MEDIA_ROOT) / "hls" / str(song_id)
        if hls_dir.exists():
            shutil.rmtree(hls_dir, ignore_errors=True)
        song.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
