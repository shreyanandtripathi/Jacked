import shutil
import subprocess
from pathlib import Path
from django.conf import settings

RENDITIONS = [
    {"folder": "128k", "bitrate": "128k", "bandwidth": 160000, "average": 128000},
    {"folder": "256k", "bitrate": "256k", "bandwidth": 310000, "average": 256000},
    {"folder": "320k", "bitrate": "320k", "bandwidth": 385000, "average": 320000},
]

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

def process_audio(song):
    original = Path(song.original_file.path)
    output = Path(settings.MEDIA_ROOT) / "hls" / str(song.pk)
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
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(original),
        ])
        song.duration = max(0, float(probe.stdout.strip()))

        for rendition in RENDITIONS:
            folder = output / rendition["folder"]
            folder.mkdir(parents=True, exist_ok=True)
            playlist = folder / "playlist.m3u8"
            pattern = folder / "segment_%05d.ts"
            _run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(original), "-vn", "-c:a", "aac",
                "-b:a", rendition["bitrate"], "-ac", "2", "-ar", "44100",
                "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
                "-hls_flags", "independent_segments",
                "-hls_segment_filename", str(pattern), str(playlist),
            ])

        lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"]
        for rendition in RENDITIONS:
            lines += [
                f'#EXT-X-STREAM-INF:BANDWIDTH={rendition["bandwidth"]},AVERAGE-BANDWIDTH={rendition["average"]},CODECS="mp4a.40.2"',
                f'{rendition["folder"]}/playlist.m3u8',
            ]
        (output / "master.m3u8").write_text("\n".join(lines) + "\n", encoding="utf-8")

        song.hls_master_path = f"hls/{song.pk}/master.m3u8"
        song.processing_status = "ready"
        song.save(update_fields=["duration", "hls_master_path", "processing_status"])
        return song
    except Exception:
        song.processing_status = "failed"
        song.save(update_fields=["processing_status"])
        raise
