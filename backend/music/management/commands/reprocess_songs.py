from pathlib import Path
import shutil
from django.conf import settings
from django.core.management.base import BaseCommand
from music.models import Song
from music.services import process_audio

class Command(BaseCommand):
    help = "Rebuild HLS streams for existing songs using the original MP3 at its detected source bitrate."

    def handle(self, *args, **options):
        songs = Song.objects.all().order_by("id")
        total = songs.count()
        if not total:
            self.stdout.write(self.style.WARNING("No songs found."))
            return
        for index, song in enumerate(songs, start=1):
            old_path = song.hls_master_path
            self.stdout.write(f"[{index}/{total}] Processing: {song.title} — {song.artist}")
            try:
                process_audio(song)
                if old_path:
                    old_dir = Path(settings.MEDIA_ROOT) / Path(old_path).parent
                    new_dir = Path(settings.MEDIA_ROOT) / "hls" / f"{song.title.lower().replace(' ', '-')}-{song.pk}"
                    # Only remove the former numeric folder layout; never remove the newly generated directory.
                    if old_dir.exists() and old_dir.name.isdigit() and old_dir != new_dir:
                        shutil.rmtree(old_dir, ignore_errors=True)
                self.stdout.write(self.style.SUCCESS(f"  Ready · {song.source_bitrate} kbps source stream"))
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"  Failed: {exc}"))
