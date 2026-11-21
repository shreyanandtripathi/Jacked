# JACKED — Local Music Streaming MVP

A local music-streaming application built with Django, React, SQLite, FFmpeg and HLS.js.

## Included features
- MP3 upload with optional cover artwork and metadata.
- FFmpeg creates audio-only AAC/HLS renditions at 128, 256 and 320 kbps.
- HLS master playlist for adaptive bitrate streaming.
- Auto quality (default) and manual 128/256/320 kbps selection.
- Persistent player that remains mounted while navigating between pages.
- Stats for Nerds: selected rendition, segment throughput, segment number/size, buffer and player state.
- Segment visualization for recent HLS media-fragment downloads.
- Chrome DevTools throttling demonstration.
- Home, Search, Library, Upload and Settings pages.
- Likes and playlists stored locally in this browser.
- Dark, Light and System themes.
- Autoplay queue behaviour and repeat/shuffle controls.
- Settings saved automatically in localStorage.

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
If activation is blocked:
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
python manage.py createsuperuser
python manage.py runserver
```
Backend endpoints:
- API: http://127.0.0.1:8000/api/songs/
- Admin: http://127.0.0.1:8000/admin/
- Health: http://127.0.0.1:8000/api/health/

SQLite database: `backend/db.sqlite3`
Uploads and generated HLS files: `backend/media/`

## 3. Start React (PowerShell terminal 2)
Open another terminal:
```powershell
cd path\to\Jacked\frontend
npm install
npm run dev
```
Open http://localhost:5173.

## 4. Upload a song
1. Open Jacked > Upload Music.
2. Enter title and artist; album and genre are optional.
3. Select an MP3 file (maximum 100 MB) and optional cover image.
4. Click Upload and process.
5. Keep Django running while FFmpeg generates the three renditions.
6. The song will appear in Home and Search once processing succeeds.

## 5. Demonstrate chunk streaming and adaptive quality
1. Start playback.
2. Open the player diagnostics using the activity icon in the bottom player. Stats for Nerds and Segment Visualization are enabled by default.
3. Open Chrome DevTools with F12 > Network.
4. Filter by `.ts` (or select Media). You should see individual HLS media segment requests, plus `.m3u8` playlist requests.
5. In Network throttling, select Slow 3G or create a custom slow profile.
6. Let several segment downloads complete. Chrome throttling changes the actual transfer time; HLS.js estimates throughput and may switch to a lower rendition based on bandwidth and buffer conditions.
7. Restore No throttling and let more segments download. HLS.js may move to a higher rendition once its estimator and buffer permit.
8. In Settings, choose 128/256/320 kbps to demonstrate manual selection. Return to Auto to restore adaptive selection.

Notes:
- Throttling affects browser requests, so it affects hls.js. A switch is not necessarily immediate; it depends on segment duration, buffer, playback state and throughput estimates.
- Segment throughput is calculated from the actual HLS fragment transfer timing; it is not a continuous ISP speed test.
- HLS.js exposes rendition selection in Chrome/Firefox/Edge. Safari may use native HLS, where the same manual rendition-selection API is not exposed.
- 320 kbps is an encode target, not a way to restore detail missing from a low-quality source file.

## API
- `GET /api/songs/` — list songs
- `POST /api/songs/` — multipart upload
- `GET /api/songs/<id>/` — song details
- `DELETE /api/songs/<id>/` — delete song and local files
- `GET /api/health/` — health check

Upload fields: `title`, `artist`, optional `album`, optional `genre`, `original_file` (MP3), optional `cover` (image).

## Limitations / production notes
- This is a local development MVP, not a public streaming service.
- The local API permits uploads without login. Do not expose it to the internet as-is.
- Django's development server serves media only for local testing. Production requires a dedicated media server/object storage/CDN and access controls.
- Transcoding runs synchronously during upload. A production library should use a background worker such as Celery/RQ.
- Likes and playlists are stored in this browser's localStorage; they are not synced across devices or stored in SQLite.
- User registration, social features, recommendations, cloud deployment and DRM are not included.
- Audio normalization and crossfade are shown as planned preferences; their audio-processing behaviour is not active in this MVP.
- Only upload audio you own or are licensed to distribute.

## Troubleshooting
**ffmpeg not recognized:** Add FFmpeg's bin directory to PATH, reopen PowerShell and retry.
**Upload fails:** Verify `ffmpeg -version` and `ffprobe -version` in the same terminal used to run Django.
**CORS error:** Keep Vite at port 5173, or add its origin to `CORS_ALLOWED_ORIGINS` in `backend/config/settings.py`.
**No tracks:** Upload a song from the Upload Music page.
**No HLS segments:** Confirm the song status is `ready` and `backend/media/hls/<song-id>/master.m3u8` exists.
