# JACKED — Local Music Streaming

A local music library and HLS audio player built with Django, React, SQLite, FFmpeg and HLS.js.

## What's included in this update

- Single and bulk MP3 upload.
- Automatic ID3 metadata extraction: title, artist, album, genre and embedded cover art.
- Original MP3 retained unchanged in local media storage.
- Adaptive HLS AAC renditions (128/256/320 kbps where the uploaded source supports them); the original MP3 is retained unchanged and is never upscaled.
- Master `.m3u8` playlist plus HLS media playlist and `.ts` segments.
- Song-based storage names, with a unique suffix to prevent filename collisions.
- Persistent player, queue, shuffle, repeat, seek and volume controls.
- Fixed card play/pause state and automatic playback when selecting a track.
- Stats for Nerds using HLS.js fragment events: rendition, segment number, transfer size, throughput and buffer.
- Full-screen Now Playing view with subtle artwork motion, dynamic blurred album-art background, Up Next queue and Stats for Nerds side panel.
- Selectable no-art fallback visualizer: rotating retro cassette or animated equalizer bars (saved in Settings).
- Streaming-quality selector: Auto, 128, 256 or 320 kbps, constrained by each upload's source quality.
- Home, Search, Library, Upload and Settings pages.
- Likes and playlists stored in browser localStorage.
- Dark, Light and System themes.

## Requirements

- Python 3.10+
- Node.js 18+
- FFmpeg and FFprobe installed and available on PATH
- Windows 10/11, macOS or Linux

## 1. Install FFmpeg

Download FFmpeg from https://ffmpeg.org/download.html (or a trusted Windows build). Add the folder containing `ffmpeg.exe` and `ffprobe.exe` to PATH.

Open a NEW PowerShell window and verify:

```powershell
ffmpeg -version
ffprobe -version
```

## 2. Start Django (PowerShell terminal 1)

From the extracted Jacked folder:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
```

If PowerShell blocks activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

Install and initialize:

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py makemigrations music
python manage.py migrate
# Optional but recommended when updating an older Jacked install:
python manage.py reprocess_songs
python manage.py runserver
```

If this is an update over an older local Jacked database and Django says a table already exists when applying the new initial migration, run:

```powershell
python manage.py migrate music --fake-initial
python manage.py migrate
```

Backend endpoints:
- API: http://127.0.0.1:8000/api/songs/
- Bulk upload: http://127.0.0.1:8000/api/songs/bulk-upload/
- Admin: http://127.0.0.1:8000/admin/
- Health: http://127.0.0.1:8000/api/health/

SQLite database: `backend/db.sqlite3`
Original MP3s, covers and HLS output: `backend/media/`

## 3. Start React (PowerShell terminal 2)

Open another terminal:

```powershell
cd path\to\Jacked\frontend
npm install
npm run dev
```

Open http://localhost:5173.

## 4. Add music

1. Open Jacked > Upload Music.
2. Select one or multiple MP3 files (Ctrl-click or Shift-click to select several).
3. Click Upload selected tracks.
4. Jacked reads ID3 metadata from each file. If a title/artist tag is missing, the filename and `Unknown artist` are used as fallbacks.
5. Embedded ID3 cover art is extracted automatically when available.
6. Wait while FFmpeg creates the HLS stream. The songs appear in Home once processing succeeds.

When updating an existing Jacked library, run `python manage.py reprocess_songs` once after migrating. It rebuilds each track from its retained original MP3 and updates its HLS path. The original MP3 is stored unchanged. HLS is a streaming delivery format, not an audio quality or a replacement for the uploaded file. The `.m3u8` master is a playlist which points to the generated AAC streams. FFmpeg creates adaptive AAC HLS renditions at 128/256/320 kbps only when the uploaded source supports those rates; the source bitrate is included as the highest level when it is not one of those standard rates. No intermediate MP3 quality copies are created, and lower-quality uploads are never upscaled.

Original file names are based on the song title (slugified) plus a short unique suffix. HLS output uses the same song-based folder name.

## 5. Full-screen player and diagnostics

1. Start playback from a song card or the bottom player.
2. Click the expand icon in the bottom player.
3. The full-screen view shows artwork, playback controls and progress.
4. The right panel opens on **Up Next**. Select **Stats for Nerds** to see rendition, fragment number, fragment size, throughput and buffer.
5. The artwork is subtly animated and its blurred image supplies the listening view's background colours. If a track has no embedded artwork, Jacked uses the selected cassette or equalizer fallback. Change the fallback in Settings > Player visuals.

Stats are based on actual HLS.js fragment download events in browsers where HLS.js/Media Source Extensions are supported. Native HLS implementations may expose fewer per-segment metrics to JavaScript; the UI attempts to collect resource timing data where the browser provides it.

## API

- `GET /api/songs/` — list songs
- `POST /api/songs/` — single-song multipart upload (title, artist, original_file, optional album/genre/cover)
- `POST /api/songs/bulk-upload/` — multi-file multipart upload using repeated `files` fields; metadata and embedded cover art are extracted from ID3 tags
- `GET /api/songs/<id>/` — song details
- `DELETE /api/songs/<id>/` — delete song and local files
- `GET /api/health/` — health check

## Limitations / production notes

- This is a local development MVP, not a public streaming service.
- The local API permits uploads without login. Do not expose it to the internet as-is.
- Django's development server serves media only for local testing. Production requires a dedicated media server/object storage/CDN and access controls.
- Transcoding runs synchronously during upload. A production library should use a background worker such as Celery/RQ.
- Likes and playlists are stored in this browser's localStorage; they are not synced across devices or stored in SQLite.
- User registration, recommendations, cloud deployment and DRM are not included.
- Audio normalization and crossfade are planned preferences; their audio-processing behaviour is not active in this MVP.
- Only upload audio you own or are licensed to distribute.

## Troubleshooting

**ffmpeg not recognized:** Add FFmpeg's `bin` directory to PATH, reopen PowerShell and retry.

**Upload fails:** Verify `ffmpeg -version` and `ffprobe -version` in the same terminal used to run Django. Ensure `mutagen` installed from `requirements.txt`.

**CORS error:** Keep Vite at port 5173, or add its origin to `CORS_ALLOWED_ORIGINS` in `backend/config/settings.py`.

**No tracks:** Upload MP3s from Upload Music and confirm their processing status is `ready` in `/api/songs/`.

**No HLS segments:** Confirm the song status is `ready` and `backend/media/hls/<song-title>-<song-id>/master.m3u8` exists.
