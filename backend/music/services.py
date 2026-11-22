import json
import shutil
import subprocess
from pathlib import Path

from django.conf import settings
from django.utils.text import slugify


class AudioProcessingError(Exception):
    pass


def _run(command):
    try:
        return subprocess.run(command, capture_output=True, text=True, check=True, timeout=1800)
    except FileNotFoundError as exc:
        raise AudioProcessingError("FFmpeg/FFprobe was not found. Install FFmpeg and add its bin folder to PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise AudioProcessingError("Audio processing timed out.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc))[-2500:]
        raise AudioProcessingError(f"FFmpeg processing failed: {detail}") from exc


def song_storage_key(song):
    return f"{slugify(song.title)[:70] or 'track'}-{song.pk}"


def process_audio(song):
    """Keep the uploaded MP3 untouched and create adaptive AAC/HLS renditions from it."""
    original = Path(song.original_file.path)
    output = Path(settings.MEDIA_ROOT) / "hls" / song_storage_key(song)
    if not original.exists():
        raise AudioProcessingError("Uploaded MP3 could not be found.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise AudioProcessingError("Both ffmpeg and ffprobe must be available on PATH.")

    song.processing_status = "processing"
    song.save(update_fields=["processing_status"])
    try:
        if output.exists():
            shutil.rmtree(output)
        output.mkdir(parents=True, exist_ok=True)

        probe = _run([
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "format=duration,bit_rate:stream=bit_rate",
            "-of", "json", str(original),
        ])
        info = json.loads(probe.stdout or "{}")
        duration = float((info.get("format") or {}).get("duration") or 0)
        streams = info.get("streams") or []
        source_bps = int((streams[0].get("bit_rate") if streams else 0) or 0)
        if not source_bps:
            source_bps = int((info.get("format") or {}).get("bit_rate") or 192000)
        source_kbps = max(64, min(320, round(source_bps / 1000)))

        # Only create real levels at or below the uploaded source bitrate. The MP3 itself is never changed.
        candidates = [128, 256, 320]
        renditions = sorted({rate for rate in candidates if rate < source_kbps} | {source_kbps})
        # Avoid creating an unnecessary 128 kbps rendition for very low-bitrate sources.
        renditions = [rate for rate in renditions if rate <= source_kbps]
        variants = []
        for rate in renditions:
            folder = output / f"{rate}k"
            folder.mkdir(parents=True, exist_ok=True)
            playlist = folder / "index.m3u8"
            segment_pattern = folder / "segment_%05d.ts"
            _run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(original),
                "-vn", "-c:a", "aac", "-b:a", f"{rate}k", "-ac", "2", "-ar", "44100",
                "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
                "-hls_flags", "independent_segments", "-hls_segment_filename", str(segment_pattern), str(playlist),
            ])
            bandwidth = rate * 1000 + 16000
            variants.append(
                f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={rate * 1000},CODECS="mp4a.40.2"\n'
                f'{rate}k/index.m3u8'
            )

        master = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n" + "\n".join(variants) + "\n"
        (output / "master.m3u8").write_text(master, encoding="utf-8")

        song.duration = max(0, duration)
        song.source_bitrate = source_kbps
        song.hls_master_path = f"hls/{song_storage_key(song)}/master.m3u8"
        song.processing_status = "ready"
        song.save(update_fields=["duration", "source_bitrate", "hls_master_path", "processing_status"])
        return song
    except Exception:
        song.processing_status = "failed"
        song.save(update_fields=["processing_status"])
        raise
