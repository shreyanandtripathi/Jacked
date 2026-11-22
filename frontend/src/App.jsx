import React from "react";
import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, NavLink, Routes, Route } from "react-router-dom";
import Hls from "hls.js";
import {
  Activity, AudioLines, ChevronDown, ChevronUp, Heart, Pencil, Home as HomeIcon,
  Library, ListMusic, Moon, Monitor, Music2, Pause, Play, Plus, Radio,
  Search, Settings as SettingsIcon, Shuffle, SkipBack, SkipForward, Sun,
  UploadCloud, Volume2, VolumeX, Repeat, Repeat1, Trash2, X, Headphones, Maximize2, Minimize2
} from "lucide-react";
import { getSongs, uploadSong, updateSong } from "./api";
const Prefs = createContext(null);
const LibraryCtx = createContext(null);
const SongsCtx = createContext(null);
const PlayerCtx = createContext(null);
const defaults = {
  quality: "auto", statsEnabled: true, segmentsEnabled: true, visualizerStyle: "cassette",
  theme: "dark", autoplay: true, normalization: false, crossfade: 0
};
function usePrefs() { return useContext(Prefs); }
function useLibrary() { return useContext(LibraryCtx); }
function useSongs() { return useContext(SongsCtx); }
function usePlayer() { return useContext(PlayerCtx); }
function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("jacked-preferences") || "{}") }; }
    catch { return defaults; }
  });
  useEffect(() => {
    localStorage.setItem("jacked-preferences", JSON.stringify(preferences));
    const resolved = preferences.theme === "system"
      ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : preferences.theme;
    document.documentElement.dataset.theme = resolved;
  }, [preferences]);
  useEffect(() => {
    if (preferences.theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: light)");
    const update = () => { document.documentElement.dataset.theme = media.matches ? "light" : "dark"; };
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [preferences.theme]);
  const update = (key, value) => setPreferences(old => ({ ...old, [key]: value }));
  return <Prefs.Provider value={{ preferences, update }}>{children}</Prefs.Provider>;
}
function LibraryProvider({ children }) {
  const [library, setLibrary] = useState(() => {
    try { return JSON.parse(localStorage.getItem("jacked-library") || '{"likedIds":[],"playlists":[]}'); }
    catch { return { likedIds: [], playlists: [] }; }
  });
  useEffect(() => localStorage.setItem("jacked-library", JSON.stringify(library)), [library]);
  const toggleLike = id => setLibrary(old => ({
    ...old, likedIds: old.likedIds.includes(id) ? old.likedIds.filter(x => x !== id) : [...old.likedIds, id]
  }));
  const createPlaylist = name => {
    const clean = name.trim(); if (!clean) return;
    setLibrary(old => ({ ...old, playlists: [...old.playlists, { id: `${Date.now()}`, name: clean, songIds: [] }] }));
  };
  const addToPlaylist = (playlistId, songId) => setLibrary(old => ({
    ...old, playlists: old.playlists.map(p => p.id === playlistId && !p.songIds.includes(songId) ? { ...p, songIds: [...p.songIds, songId] } : p)
  }));
  const removeFromPlaylist = (playlistId, songId) => setLibrary(old => ({
    ...old, playlists: old.playlists.map(p => p.id === playlistId ? { ...p, songIds: p.songIds.filter(id => id !== songId) } : p)
  }));
  return <LibraryCtx.Provider value={{ library, toggleLike, createPlaylist, addToPlaylist, removeFromPlaylist }}>{children}</LibraryCtx.Provider>;
}
function SongsProvider({ children }) {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true);
    try { setSongs(await getSongs()); setError(""); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  return <SongsCtx.Provider value={{ songs, loading, error, refresh }}>{children}</SongsCtx.Provider>;
}
function fmtTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}
function chooseLevel(hls, mode) {
  if (!hls?.levels?.length) return;
  if (mode === "auto") { hls.currentLevel = -1; return; }
  const target = Number(mode) * 1000;
  let chosen = 0;
  hls.levels.forEach((level, index) => {
    const rate = level.averageBitrate || level.bitrate || 0;
    const current = hls.levels[chosen].averageBitrate || hls.levels[chosen].bitrate || 0;
    if (Math.abs(rate - target) < Math.abs(current - target)) chosen = index;
  });
  hls.currentLevel = chosen;
}
function PlayerProvider({ children }) {
  const { preferences } = usePrefs();
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const [song, setSong] = useState(null);
  const [queue, setQueue] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off");
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [sidePanel, setSidePanel] = useState("queue");
  const [stats, setStats] = useState({ quality: "—", speed: 0, segment: "—", size: "—", buffer: "0.0", state: "Waiting" });
  const [segments, setSegments] = useState([]);
  const updateSongInPlayer = updatedSong => {
    setSong(current => current?.id === updatedSong.id ? { ...current, ...updatedSong } : current);
    setQueue(current => current.map(item => item.id === updatedSong.id ? { ...item, ...updatedSong } : item));
  };
  const playSong = (item, list = []) => {
    setQueue(list.length ? list : [item]);
    if (song?.id === item.id) {
      const audio = audioRef.current;
      if (audio?.paused) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    setSong(item); setTime(0); setPlaying(true); setMonitorOpen(false);
  };
  const next = useCallback(() => {
    if (!queue.length) return;
    const idx = queue.findIndex(x => x.id === song?.id);
    let target = shuffle && queue.length > 1
      ? queue.map((_, i) => i).filter(i => i !== idx)[Math.floor(Math.random() * (queue.length - 1))]
      : idx + 1;
    if (target >= queue.length) {
      if (repeat === "all") target = 0;
      else { setPlaying(false); return; }
    }
    setSong(queue[target]); setTime(0); setPlaying(true);
  }, [queue, song, shuffle, repeat]);
  const previous = () => {
    const audio = audioRef.current;
    if (!queue.length) return;
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    const idx = queue.findIndex(x => x.id === song?.id);
    const target = idx <= 0 ? (repeat === "all" ? queue.length - 1 : 0) : idx - 1;
    setSong(queue[target]); setTime(0); setPlaying(true);
  };
  const togglePlay = () => {
    const audio = audioRef.current; if (!audio || !song) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else audio.pause();
  };
  const toggleFullScreen = () => {
    // Expand inside the Jacked app only; do not invoke the browser Fullscreen API.
    setFullScreen(value => !value);
  };
  const seek = value => { if (audioRef.current) audioRef.current.currentTime = value; };
  const setVol = value => {
    const v = Math.max(0, Math.min(1, Number(value))); setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
    if (v > 0) setMuted(false);
  };
  const toggleMute = () => { if (!audioRef.current) return; audioRef.current.muted = !audioRef.current.muted; setMuted(audioRef.current.muted); };
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !song?.stream_url) return;
    let hls = null;
    let observer = null;
    setSegments([]);
    setStats({ quality: song.source_bitrate ? `${song.source_bitrate} kbps` : "Loading", speed: 0, segment: "—", size: "—", buffer: "0.0", state: "Loading HLS playlist" });
    const getBuffer = () => {
      for (let i = 0; i < audio.buffered.length; i++) {
        if (audio.currentTime >= audio.buffered.start(i) && audio.currentTime <= audio.buffered.end(i))
          return Math.max(0, audio.buffered.end(i) - audio.currentTime);
      }
      return 0;
    };
    const recordSegment = (number, bytes, speed, quality) => {
      const size = bytes > 0 ? `${(bytes / 1024).toFixed(1)} KB` : "Unavailable";
      setStats(old => ({ ...old, quality: quality || old.quality, speed: Math.max(0, Math.round(speed || 0)), segment: String(number), size, buffer: getBuffer().toFixed(1), state: "Segment downloaded" }));
      setSegments(old => [...old.filter(x => x.number !== String(number)), { number: String(number), status: "downloaded", size }].slice(-14));
    };
    const onTime = () => { setTime(audio.currentTime || 0); setStats(s => ({ ...s, buffer: getBuffer().toFixed(1) })); };
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); }
      else if (preferences.autoplay) next();
      else setPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.volume = volume;
    // Prefer hls.js on browsers with Media Source Extensions so fragment telemetry is available.*
    if (Hls.isSupported()) {
      hls = new Hls({ startLevel: 0, capLevelToPlayerSize: false, maxBufferLength: 30, maxMaxBufferLength: 60 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        chooseLevel(hls, preferences.quality);
        const activeIndex = hls.currentLevel >= 0 ? hls.currentLevel : (hls.loadLevel >= 0 ? hls.loadLevel : 0);
        const level = hls.levels[activeIndex];
        const kbps = level ? Math.round((level.averageBitrate || level.bitrate || 0) / 1000) : song.source_bitrate;
        setStats(s => ({ ...s, quality: kbps ? `${kbps} kbps` : "Source quality", state: `Manifest loaded · ${hls.levels.length} rendition(s) available` }));
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level];
        if (level) {
          const kbps = Math.round((level.averageBitrate || level.bitrate || 0) / 1000);
          setStats(s => ({ ...s, quality: `${kbps} kbps`, state: `Playing · rendition ${kbps} kbps` }));
        }
      });
      hls.on(Hls.Events.FRAG_LOADING, (_, data) => {
        const frag = data.frag; if (frag.sn === "initSegment") return;
        setSegments(old => [...old.filter(x => x.number !== String(frag.sn)), { number: String(frag.sn), status: "loading", size: "—" }].slice(-14));
        setStats(s => ({ ...s, state: `Downloading segment ${frag.sn}` }));
      });
      hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
        const frag = data.frag;
        if (frag.sn === "initSegment") return;
        const transferStats = data.stats || {};
        const payloadBytes = data.payload?.byteLength || 0;
        const bytes = Number(
          transferStats.loaded ||
          transferStats.total ||
          frag.stats?.loaded ||
          payloadBytes ||
          0
        );
        const started = Number(transferStats.loading?.start || 0);
        const ended = Number(transferStats.loading?.end || 0);
        const durationMs = ended > started ? ended - started : 0;
        const estimatedKbps = Number(transferStats.bwEstimate || 0) / 1000;
        const speed = durationMs > 0 ? (bytes * 8) / durationMs : estimatedKbps;
        const level = hls.levels[frag.level ?? 0];
        const quality = level
          ? `${Math.round((level.averageBitrate || level.bitrate || 0) / 1000)} kbps`
          : (song.source_bitrate ? `${song.source_bitrate} kbps` : "Source quality");
        recordSegment(frag.sn, bytes, speed, quality);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        setStats(s => ({ ...s, state: `Playback error: ${data.details}` }));
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.destroy();
      });
      hls.loadSource(song.stream_url);
      hls.attachMedia(audio);
    } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS does not expose fragment events. Observe media segment network entries where supported.*
      audio.src = song.stream_url;
      setStats(s => ({ ...s, quality: song.source_bitrate ? `${song.source_bitrate} kbps` : "Source quality", state: "Native HLS playback · collecting network stats" }));
      if ("PerformanceObserver" in window) {
        try {
          observer = new PerformanceObserver(list => {
            list.getEntries().forEach(entry => {
              const match = entry.name.match(/segment[_-](\d+)\.ts(?:[?#]|$)/i);
              if (!match) return;
              const bytes = entry.transferSize || entry.encodedBodySize || 0;
              const ms = entry.duration || 0;
              recordSegment(Number(match[1]), bytes, ms > 0 ? bytes * 8 / ms : 0, song.source_bitrate ? `${song.source_bitrate} kbps` : "Source quality");
            });
          });
          observer.observe({ type: "resource", buffered: true });
        } catch {}
      }
      audio.load();
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      setStats(s => ({ ...s, state: "HLS is not supported by this browser" }));
    }
    const onFullScreenChange = () => { if (!document.fullscreenElement) setFullScreen(false); };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      observer?.disconnect();
      if (hls) hls.destroy();
      hlsRef.current = null;
      audio.removeAttribute("src"); audio.load();
    };
  }, [song?.stream_url]);
  useEffect(() => {
    if (hlsRef.current) chooseLevel(hlsRef.current, preferences.quality);
  }, [preferences.quality]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  const value = {
    song, queue, playing, time, duration, volume, muted, shuffle, repeat,
    monitorOpen, stats, segments, audioRef, playSong, next, previous, updateSongInPlayer,
    togglePlay, seek, setVol, toggleMute, setShuffle, setRepeat, setMonitorOpen, fullScreen, sidePanel, setSidePanel, toggleFullScreen
  };
  return <PlayerCtx.Provider value={value}>{children}<audio ref={audioRef} className="audio-engine" preload="auto" /></PlayerCtx.Provider>;
}
function Sidebar() {
  const links = [
    ["/", "Home", HomeIcon], ["/search", "Search", Search],
    ["/library", "Your Library", Library], ["/upload", "Upload Music", UploadCloud],
    ["/settings", "Settings", SettingsIcon]
  ];
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Headphones size={21} /></div><div><b>JACKED</b><small>YOUR MUSIC. YOUR SPACE.</small></div></div>
    <div className="nav-label">MENU</div>
    <nav>{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
    <div className="sidebar-foot">A little more music,<br />a little less noise.<small>JACKED · LOCAL EDITION</small></div>
  </aside>;
}
function SongCard({ song, onPlay, onAdd }) {
  const { library, toggleLike } = useLibrary();
  const { preferences } = usePrefs();
  const player = usePlayer();
  const { refresh } = useSongs();
  const [editing, setEditing] = useState(false);
  const isCurrent = player.song?.id === song.id;
  const liked = library.likedIds.includes(song.id);
  return <>
    <article className="song-card">
      <button className="cover-button" onClick={() => isCurrent ? player.togglePlay() : onPlay(song)}>
        {song.cover_url ? <img src={song.cover_url} alt="" /> : <div className="cover-placeholder"><FallbackVisualizer style={preferences.visualizerStyle || "cassette"} active={isCurrent ? player.playing : false} /></div>}
        <span className="cover-play">{isCurrent && player.playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</span>
      </button>
      <div className="song-info">
        <div className="song-title-row">
          <button className="song-title" onClick={() => onPlay(song)}>{song.title}</button>
          <button className={`tiny-icon ${liked ? "liked" : ""}`} onClick={() => toggleLike(song.id)} title="Like"><Heart size={16} fill={liked ? "currentColor" : "none"} /></button>
        </div>
        <p>{song.artist}</p>
        <div className="song-card-foot">
          <span className="ready-dot">READY TO STREAM</span>
          <div className="song-card-actions">
            <button className="tiny-icon" onClick={() => setEditing(true)} title="Edit song details" aria-label="Edit song details"><Pencil size={15} /></button>
            <button className="tiny-icon" onClick={() => onAdd(song)} title="Add to playlist"><Plus size={16} /></button>
          </div>
        </div>
      </div>
    </article>
    {editing && <EditSongModal song={song} close={() => setEditing(false)} onSaved={async updated => {
      player.updateSongInPlayer(updated);
      await refresh();
      setEditing(false);
    }} />}
  </>;
}
function PlaylistModal({ song, close }) {
  const { library, createPlaylist, addToPlaylist } = useLibrary();
  const [name, setName] = useState("");
  return <div className="modal-backdrop" onClick={close}><div className="modal" onClick={e => e.stopPropagation()}>
    <div className="modal-top"><div><small>YOUR COLLECTION</small><h2>Add to playlist</h2></div><button className="tiny-icon" onClick={close}><X /></button></div>
    <p className="muted">Choose a playlist for <b>{song.title}</b>.</p>
    {library.playlists.map(p => <button className="playlist-option" key={p.id} onClick={() => { addToPlaylist(p.id, song.id); close(); }}>♫　{p.name}<small>{p.songIds.length} songs</small></button>)}
    <div className="create-row"><input value={name} onChange={e => setName(e.target.value)} placeholder="New playlist name" /><button className="btn" onClick={() => { createPlaylist(name); setName(""); }}>Create</button></div>
  </div></div>;
}


function EditSongModal({ song, close, onSaved }) {
  const [title, setTitle] = useState(song.title || "");
  const [artist, setArtist] = useState(song.artist || "");
  const [album, setAlbum] = useState(song.album || "");
  const [genre, setGenre] = useState(song.genre || "");
  const [cover, setCover] = useState(null);
  const [preview, setPreview] = useState(song.cover_url || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleCover = event => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError("Image must be 8 MB or smaller.");
      return;
    }

    setCover(file);
    setPreview(URL.createObjectURL(file));
    setError("");
  };

  const submit = async event => {
    event.preventDefault();
    setError("");

    if (!title.trim() || !artist.trim()) {
      setError("Song title and artist are required.");
      return;
    }

    const body = new FormData();
    body.append("title", title.trim());
    body.append("artist", artist.trim());
    body.append("album", album.trim());
    body.append("genre", genre.trim());

    if (cover) {
      body.append("cover", cover);
    }

    setBusy(true);

    try {
      const updated = await updateSong(song.id, body);
      await onSaved(updated);
    } catch (err) {
      setError(err.message || "Could not update song details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) close();
    }}>
      <form className="modal edit-song-modal" onSubmit={submit}>
        <div className="modal-top">
          <div>
            <small>YOUR COLLECTION</small>
            <h2>Edit song details</h2>
          </div>
          <button type="button" className="tiny-icon"
            onClick={close} disabled={busy}>
            <X />
          </button>
        </div>

        <p className="muted">
          Update your song information and album artwork.
        </p>

        <div className="edit-cover-preview">
          {preview ? (
            <img src={preview} alt="Album artwork preview" />
          ) : (
            <div className="edit-cover-empty">♫</div>
          )}
        </div>

        <label className="edit-field">
          <span>Album artwork</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleCover}
          />
          <small>JPG, PNG or WebP · Maximum 8 MB</small>
        </label>

        <label className="edit-field">
          <span>Song title</span>
          <input value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200} required />
        </label>

        <label className="edit-field">
          <span>Artist</span>
          <input value={artist}
            onChange={e => setArtist(e.target.value)}
            maxLength={200} required />
        </label>

        <label className="edit-field">
          <span>Album</span>
          <input value={album}
            onChange={e => setAlbum(e.target.value)}
            maxLength={200} />
        </label>

        <label className="edit-field">
          <span>Genre</span>
          <input value={genre}
            onChange={e => setGenre(e.target.value)}
            maxLength={100} />
        </label>

        {error && <div className="error-msg">{error}</div>}

        <div className="edit-actions">
          <button type="button" className="btn btn-secondary"
            onClick={close} disabled={busy}>
            Cancel
          </button>

          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}


function Home() {
  const { songs, loading, error } = useSongs();
  const { playSong } = usePlayer();
  const [pick, setPick] = useState(null);
  const ready = songs.filter(s => s.processing_status === "ready");
  return <div className="page">
    <section className="hero"><div className="hero-copy"><small className="eyebrow">YOUR PERSONAL SOUNDTRACK</small><h1>Music that<br /><em>moves with you.</em></h1><p>Your collection, your rules. Stream in adaptive quality and make every listening session yours.</p><a className="btn" href="#tracks"><Headphones size={16} /> Explore music</a><div className="hero-meta"><i /> HLS STREAMING · SOURCE QUALITY</div></div><div className="hero-art"><div className="vinyl"><div>J</div></div><span className="note note-a">♪</span><span className="note note-b">♫</span></div></section>
    <div className="quick-stats"><span><Music2 size={16} /> <b>{songs.length}</b> tracks</span><span><Headphones size={16} /> <b>{ready.length}</b> ready</span><span><Radio size={16} /> <b>HLS</b> · source quality</span></div>
    <section id="tracks" className="section"><div className="section-head"><div><small className="eyebrow">THE COLLECTION</small><h2>Your music</h2></div><small>{ready.length} TRACKS</small></div>
      {loading ? <div className="empty">Loading your music…</div> : error ? <div className="alert">{error}<br />Make sure Django is running.</div> : ready.length === 0 ? <div className="empty"><span>♫</span><h3>Your library is waiting.</h3><p>Upload your first MP3 to start building your collection.</p></div> : <div className="song-grid">{ready.map(s => <SongCard key={s.id} song={s} onPlay={() => playSong(s, ready)} onAdd={setPick} />)}</div>}
    </section>
    {pick && <PlaylistModal song={pick} close={() => setPick(null)} />}
  </div>;
}
function SearchPage() {
  const { songs } = useSongs(); const { playSong } = usePlayer();
  const [query, setQuery] = useState(""); const [pick, setPick] = useState(null);
  const results = songs.filter(s => s.processing_status === "ready" && [s.title,s.artist,s.album,s.genre].join(" ").toLowerCase().includes(query.toLowerCase()));
  return <div className="page narrow"><PageTitle eyebrow="FIND YOUR NEXT FAVOURITE" title="Search" subtitle="Find tracks by title, artist, album or genre." />
    <div className="search-box"><Search size={19} /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="What do you want to listen to?" />{query && <button className="tiny-icon" onClick={() => setQuery("")}><X size={16} /></button>}</div>
    <div className="section-head search-head"><h2>{query ? `Results for “${query}”` : "All tracks"}</h2><small>{results.length} FOUND</small></div>
    {results.length ? <div className="song-grid">{results.map(s => <SongCard key={s.id} song={s} onPlay={() => playSong(s, results)} onAdd={setPick} />)}</div> : <div className="empty"><h3>No matches found</h3><p>Try another title, artist or genre.</p></div>}
    {pick && <PlaylistModal song={pick} close={() => setPick(null)} />}
  </div>;
}
function LibraryPage() {
  const { songs } = useSongs(); const { playSong } = usePlayer();
  const { library, createPlaylist, removeFromPlaylist } = useLibrary();
  const [name, setName] = useState(""); const [active, setActive] = useState(null); const [pick, setPick] = useState(null);
  const ready = songs.filter(s => s.processing_status === "ready");
  const liked = ready.filter(s => library.likedIds.includes(s.id));
  const selected = library.playlists.find(p => p.id === active);
  const playlistSongs = selected ? ready.filter(s => selected.songIds.includes(s.id)) : [];
  return <div className="page"><PageTitle eyebrow="YOUR PERSONAL COLLECTION" title="Your Library" subtitle="Liked tracks and playlists, saved in this browser." />
    <section className="section"><div className="section-head"><h2><Heart size={19} /> Liked songs</h2><small>{liked.length} TRACKS</small></div>
      {liked.length ? <div className="song-grid">{liked.map(s => <SongCard key={s.id} song={s} onPlay={() => playSong(s, liked)} onAdd={setPick} />)}</div> : <div className="empty">Tap the heart on a track to save it here.</div>}
    </section>
    <section className="section"><div className="section-head"><h2><ListMusic size={19} /> Playlists</h2></div>
      <div className="create-row"><input value={name} onChange={e => setName(e.target.value)} placeholder="Give your playlist a name" onKeyDown={e => e.key === "Enter" && (createPlaylist(name), setName(""))} /><button className="btn" onClick={() => { createPlaylist(name); setName(""); }}><Plus size={15} /> Create playlist</button></div>
      <div className="playlist-list">{library.playlists.map(p => <button key={p.id} className={`playlist-row ${active === p.id ? "selected" : ""}`} onClick={() => setActive(active === p.id ? null : p.id)}><span className="playlist-symbol">♫</span><span><b>{p.name}</b><small>{p.songIds.length} songs</small></span><span className="arrow">›</span></button>)}</div>
      {selected && <div className="playlist-detail"><div className="section-head"><h3>{selected.name}</h3><small>{playlistSongs.length} AVAILABLE</small></div>
        {playlistSongs.length ? <div className="song-grid">{playlistSongs.map(s => <div key={s.id}><SongCard song={s} onPlay={() => playSong(s, playlistSongs)} onAdd={setPick} /><button className="remove-btn" onClick={() => removeFromPlaylist(selected.id, s.id)}><Trash2 size={13} /> Remove</button></div>)}</div> : <p className="muted">This playlist is empty or its songs are unavailable.</p>}
      </div>}
    </section>
    {pick && <PlaylistModal song={pick} close={() => setPick(null)} />}
  </div>;
}
function UploadPage() {
  const { refresh } = useSongs();
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async e => {
    e.preventDefault(); setError(""); setMessage("");
    if (!files.length) { setError("Choose at least one MP3 file."); return; }
    const body = new FormData(); files.forEach(file => body.append("files", file));
    setBusy(true); setMessage(`Uploading ${files.length} track(s). Reading ID3 tags and preparing HLS streams…`);
    try {
      const result = await uploadSong(body, true);
      const failed = result.errors || [];
      setMessage(`${result.count} track(s) uploaded and ready${failed.length ? ` · ${failed.length} failed` : ""}. Metadata was read from the MP3 tags where available.`);
      setFiles([]); await refresh();
      if (failed.length) setError(failed.map(x => `${x.file}: ${x.error}`).join("\n"));
    } catch (err) { setError(err.message); setMessage(""); }
    finally { setBusy(false); }
  };
  return <div className="page narrow"><PageTitle eyebrow="GROW YOUR COLLECTION" title="Upload music" subtitle="Select one MP3 or a whole folder's worth. Jacked reads embedded metadata automatically." />
    <form className="upload-panel" onSubmit={submit}>
      <div className="drop-zone"><UploadCloud size={28} /><h3>{files.length ? `${files.length} MP3 file(s) selected` : "Choose your audio files"}</h3><p>MP3 format · Maximum 100 MB per file · Multiple selection supported</p><input type="file" accept=".mp3,audio/mpeg" multiple onChange={e => setFiles(Array.from(e.target.files || []))} /></div>
      {files.length > 0 && <div className="bulk-file-list">{files.map((f, i) => <div key={`${f.name}-${i}`}><Music2 size={14} /><span>{f.name}</span><small>{(f.size / 1024 / 1024).toFixed(1)} MB</small></div>)}</div>}
      {message && <div className="success-msg">{message}</div>}{error && <div className="error-msg">{error}</div>}
      <button className="btn submit-btn" disabled={busy}>{busy ? "Uploading and processing…" : <><Music2 size={16} /> Upload selected tracks</>}</button>
      <p className="form-note">Original MP3 files are retained unchanged. Jacked reads title, artist, album, genre and embedded cover art from ID3 metadata. One HLS stream is created at the source bitrate; no 128/256/320 kbps ladder is generated.</p>
    </form>
  </div>;
}
function PageTitle({ eyebrow, title, subtitle }) {
  return <div className="page-title"><small className="eyebrow">{eyebrow}</small><h1>{title}</h1><p>{subtitle}</p></div>;
}
function Toggle({ value, onChange }) {
  return <button type="button" role="switch" aria-checked={value} className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)}><i /></button>;
}
function SettingRow({ icon: Icon, title, description, children }) {
  return <div className="setting-row"><div className="setting-icon"><Icon size={18} /></div><div className="setting-copy"><b>{title}</b><p>{description}</p></div><div className="setting-control">{children}</div></div>;
}
function SettingsPage() {
  const { preferences: p, update } = usePrefs();
  return <div className="page narrow"><PageTitle eyebrow="MAKE IT YOURS" title="Settings" subtitle="Fine-tune your listening experience." />
    <section className="settings-card"><div className="settings-heading"><div><small>01 / PLAYBACK</small><h2>Streaming quality</h2></div><Radio size={21} /></div>
      <SettingRow icon={Radio} title="Audio quality" description="Auto adapts to your connection, or choose a preferred HLS rendition.">
        <select value={p.quality} onChange={e => update("quality", e.target.value)}>
          <option value="auto">Auto · Recommended</option><option value="128">Data Saver · 128 kbps</option><option value="256">High · 256 kbps</option><option value="320">Very High · 320 kbps</option>
        </select>
      </SettingRow>
      <div className="quality-options">{[["auto","AUTO","Adaptive"],["128","128","kbps"],["256","256","kbps"],["320","320","kbps"]].map(([value,label,sub]) => <button type="button" key={value} className={p.quality === value ? "chosen" : ""} onClick={() => update("quality",value)}>{label}<small>{sub}</small></button>)}</div>
      <p className="setting-hint">Your uploaded MP3 is retained unchanged. HLS creates AAC streaming renditions only up to the source bitrate; it never upscales a lower-quality upload.</p>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>02 / TRANSPARENCY</small><h2>Streaming diagnostics</h2></div><Activity size={21} /></div>
      <SettingRow icon={Activity} title="Stats for Nerds" description="Live rendition, segment throughput, size and buffer."><Toggle value={p.statsEnabled} onChange={v => update("statsEnabled",v)} /></SettingRow>
      <SettingRow icon={AudioLines} title="Segment visualization" description="Show each HLS media segment as it downloads."><Toggle value={p.segmentsEnabled} onChange={v => update("segmentsEnabled",v)} /></SettingRow>
      <p className="setting-hint">Both diagnostics are ON by default. Open the activity icon in the bottom player to view them.</p>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>03 / PLAYER VISUALS</small><h2>Fallback visualizer</h2></div><AudioLines size={21} /></div>
      <p className="setting-hint">Used whenever a track has no embedded album artwork, and while the player is empty.</p>
      <div className="visualizer-choices">
        <button type="button" className={p.visualizerStyle === "cassette" ? "selected" : ""} onClick={() => update("visualizerStyle","cassette")}><span className="choice-cassette"><i/><i/></span><b>Retro cassette</b><small>Rotating reels</small></button>
        <button type="button" className={p.visualizerStyle === "equalizer" ? "selected" : ""} onClick={() => update("visualizerStyle","equalizer")}><span className="choice-eq">{Array.from({length:9},(_,i)=><i key={i}/>)}</span><b>Rhythmic bars</b><small>Retro equalizer</small></button>
      </div>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>04 / APPEARANCE</small><h2>Theme</h2></div><Sun size={21} /></div>
      <div className="theme-options">{[["dark","Dark",Moon],["light","Light",Sun],["system","System",Monitor]].map(([value,label,Icon]) => <button key={value} className={p.theme === value ? "theme-choice selected" : "theme-choice"} onClick={() => update("theme",value)}><Icon size={18} />{label}{p.theme === value && <span>✓</span>}</button>)}</div>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>05 / OTHER PREFERENCES</small><h2>Listening habits</h2></div><SettingsIcon size={21} /></div>
      <SettingRow icon={Radio} title="Autoplay" description="Continue with the next track when the current one ends."><Toggle value={p.autoplay} onChange={v => update("autoplay",v)} /></SettingRow>
      <SettingRow icon={AudioLines} title="Audio normalization" description="Preference saved; audio processing is not active in this version."><Toggle value={p.normalization} onChange={v => update("normalization",v)} /></SettingRow>
      <SettingRow icon={SettingsIcon} title="Crossfade" description="Preference saved; crossfade playback is planned for a later version.">
        <select value={p.crossfade} onChange={e => update("crossfade",Number(e.target.value))}><option value="0">Off</option><option value="2">2 seconds</option><option value="4">4 seconds</option><option value="6">6 seconds</option><option value="8">8 seconds</option></select>
      </SettingRow>
    </section>
    <p className="saved-note">✓ Preferences are saved automatically on this device.</p>
  </div>;
}
function FallbackVisualizer({ style = "cassette", active = true, compact = false }) {
  if (style === "equalizer") {
    const heights = [28,52,76,42,88,60,34,72,48,92,38,66,82,44,58,30,74,50];
    return <div className={`fallback-visualizer equalizer-visual ${compact ? "compact" : ""} ${active ? "active" : "paused"}`} aria-label="Retro audio equalizer">
      <div className="eq-glow" />{heights.map((height,i) => <i key={i} style={{ height: `${height}%`, animationDelay: `${(i%7)*-0.17}s` }} />)}
    </div>;
  }
  return <div className={`fallback-visualizer cassette-visual ${compact ? "compact" : ""} ${active ? "active" : "paused"}`} aria-label="Rotating retro cassette">
    <div className="cassette-shell"><div className="cassette-label"><span>JACKED</span><small>STEREO · 90 MIN</small></div><div className="cassette-window"><div className="cassette-reel"><i /></div><div className="cassette-tape"/><div className="cassette-reel"><i /></div></div><div className="cassette-bottom"><i/><i/><i/></div></div>
  </div>;
}
function GlobalPlayer() {
  const player = usePlayer(); const { preferences, update } = usePrefs();
  const song = player.song;
  const updatePlayerQuality = value => update("quality", value);
  const visualizerStyle = preferences.visualizerStyle || "cassette";
  if (!song) return <div className="global-player empty-player"><FallbackVisualizer style={visualizerStyle} active compact /><span>Select a song to start listening</span><small>JACKED · READY WHEN YOU ARE</small></div>;
  const progress = player.duration ? player.time / player.duration * 100 : 0;
  const artworkStyle = song.cover_url ? { backgroundImage: `linear-gradient(90deg,rgba(12,12,18,.88),rgba(12,12,18,.72)),url("${song.cover_url}")` } : {};
  return <div className="global-player">
    {player.fullScreen && createPortal(<div className="fullscreen-player" style={artworkStyle}>
      <div className="full-top"><span>JACKED / NOW PLAYING</span><div className="full-top-actions">{!song.cover_url && <button className="visualizer-toggle" onClick={() => update("visualizerStyle", visualizerStyle === "cassette" ? "equalizer" : "cassette")}>Switch to {visualizerStyle === "cassette" ? "rhythmic bars" : "cassette"}</button>}<button className="collapse-player" onClick={player.toggleFullScreen} title="Collapse player" aria-label="Collapse full-screen player"><Minimize2 /><span>Collapse</span></button></div></div>
      <div className="full-layout"><div className="full-main"><div className="full-art-wrap">{song.cover_url ? <img className="full-art" src={song.cover_url} alt="Album artwork" /> : <div className="full-art full-placeholder"><FallbackVisualizer style={visualizerStyle} active={player.playing} /></div>}<div className="art-glow" /></div><div className="full-track"><h1>{song.title}</h1><p>{song.artist}{song.album ? ` · ${song.album}` : ""}</p></div><div className="full-controls"><button onClick={player.previous}><SkipBack /></button><button className="full-play" onClick={player.togglePlay}>{player.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button onClick={player.next}><SkipForward /></button></div><div className="full-progress"><span>{fmtTime(player.time)}</span><input type="range" min="0" max={player.duration || 0} step=".1" value={Math.min(player.time,player.duration || 0)} onChange={e => player.seek(Number(e.target.value))} style={{"--progress":`${progress}%`}} /><span>{fmtTime(player.duration)}</span></div></div>
      <aside className="full-side"><div className="full-tabs"><button className={player.sidePanel === "queue" ? "active" : ""} onClick={() => player.setSidePanel("queue")}>Up next</button><button className={player.sidePanel === "stats" ? "active" : ""} onClick={() => player.setSidePanel("stats")}>Stats for Nerds</button></div>
      {player.sidePanel === "queue" ? <div className="full-queue">{player.queue.map((item, i) => <button key={`${item.id}-${i}`} className={item.id === song.id ? "current" : ""} onClick={() => player.playSong(item, player.queue)}>{item.cover_url ? <img src={item.cover_url} alt="" /> : <span><FallbackVisualizer style={visualizerStyle} active={item.id === song.id && player.playing} compact /></span>}<div><b>{item.title}</b><small>{item.artist}</small></div>{item.id === song.id && <i>PLAYING</i>}</button>)}</div> : <div className="full-stats">
          <div><small>Current rendition</small><b>{player.stats.quality}</b></div>
          <div><small>Segment throughput</small><b>{player.stats.speed.toLocaleString()} kbps</b></div>
          <div><small>Segment number</small><b>{player.stats.segment}</b></div>
          <div><small>Segment size</small><b>{player.stats.size}</b></div>
          <div><small>Buffered ahead</small><b>{player.stats.buffer}s</b></div>
          <div><small>Transport</small><b>AAC / HLS · source bitrate</b></div>
          <p>{player.stats.state}</p>
          {preferences.segmentsEnabled && <div className="segment-area">
            <div className="segment-label"><b>Recent HLS segments</b><small>Latest {player.segments.length}</small></div>
            <div className="segment-strip">
              {player.segments.length ? player.segments.map((segment, index) => (
                <div key={`${segment.number}-${index}`} className={`segment-chip ${segment.status}`} title={`Segment ${segment.number} · ${segment.size}`}>
                  <span>{segment.number}</span><i />
                </div>
              )) : <span className="setting-hint">Segments appear when playback starts.</span>}
            </div>
            <p className="setting-hint">Each tile represents an individual media fragment downloaded by the browser.</p>
          </div>}
        </div>}</aside></div>
    </div>, document.body)}
    {player.monitorOpen && <div className="monitor-panel">
      <div className="monitor-head"><div><small>LIVE STREAM DIAGNOSTICS</small><h3>Stats for Nerds</h3></div><button className="tiny-icon" onClick={() => player.setMonitorOpen(false)}><ChevronDown size={18} /></button></div>
      {preferences.statsEnabled ? <><div className="stats-grid">
        <div><small>Current rendition</small><b>{player.stats.quality}</b></div>
        <div><small>Segment throughput</small><b>{player.stats.speed.toLocaleString()} kbps</b></div>
        <div><small>Segment number</small><b>{player.stats.segment}</b></div>
        <div><small>Segment size</small><b>{player.stats.size}</b></div>
        <div><small>Buffered ahead</small><b>{player.stats.buffer}s</b></div>
        <div><small>Transport</small><b>AAC / HLS · source bitrate</b></div>
      </div><div className="monitor-state"><i />{player.stats.state}</div></> : <p className="setting-hint">Stats for Nerds is disabled in Settings.</p>}
      {preferences.segmentsEnabled && <div className="segment-area"><div className="segment-label"><b>Recent HLS segments</b><small>Latest {player.segments.length}</small></div>
        <div className="segment-strip">{player.segments.length ? player.segments.map((s,i) => <div key={`${s.number}-${i}`} className={`segment-chip ${s.status}`} title={`Segment ${s.number} · ${s.size}`}><span>{s.number}</span><i /></div>) : <span className="setting-hint">Segments appear when playback starts.</span>}</div>
        <p className="setting-hint">Each tile represents an individual media fragment downloaded by the browser.</p>
      </div>}
    </div>}
    <div className="player-bar">
      <div className="now-playing">{song.cover_url ? <img src={song.cover_url} alt="" /> : <span className="mini-art"><FallbackVisualizer style={visualizerStyle} active={player.playing} compact /></span>}<div><b>{song.title}</b><small>{song.artist}</small></div></div>
      <div className="player-center"><div className="controls">
        <button className={player.shuffle ? "control-on" : ""} onClick={() => player.setShuffle(!player.shuffle)} title="Shuffle"><Shuffle size={16} /></button>
        <button onClick={player.previous} title="Previous"><SkipBack size={18} /></button>
        <button className="main-play" onClick={player.togglePlay} title="Play/Pause">{player.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button onClick={player.next} title="Next"><SkipForward size={18} /></button>
        <button className={player.repeat !== "off" ? "control-on" : ""} onClick={() => player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")} title={`Repeat ${player.repeat}`}>{player.repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}</button>
      </div><div className="progress-line"><span>{fmtTime(player.time)}</span><input type="range" min="0" max={player.duration || 0} step=".1" value={Math.min(player.time,player.duration || 0)} onChange={e => player.seek(Number(e.target.value))} style={{"--progress":`${progress}%`}} /><span>{fmtTime(player.duration)}</span></div></div>
      <div className="player-tools"><select className="player-quality-select" aria-label="Streaming quality" value={preferences.quality} onChange={e => updatePlayerQuality(e.target.value)}><option value="auto">Auto</option><option value="128">128 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option></select><button onClick={() => player.setMonitorOpen(!player.monitorOpen)} title="Streaming diagnostics"><Activity size={17} /></button><button className="fullscreen-trigger" onClick={player.toggleFullScreen} title="Open full-screen Now Playing"><Maximize2 size={18} /><span>Now Playing</span></button><button onClick={player.toggleMute} title="Mute">{player.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><input aria-label="Volume" type="range" min="0" max="1" step=".01" value={player.volume} onChange={e => player.setVol(e.target.value)} /></div>
    </div>
  </div>;
}
function AppShell() {
  return <PlayerProvider><div className="app-shell"><Sidebar /><main className="main-area"><Routes>
    <Route path="/" element={<Home />} /><Route path="/search" element={<SearchPage />} />
    <Route path="/library" element={<LibraryPage />} /><Route path="/upload" element={<UploadPage />} />
    <Route path="/settings" element={<SettingsPage />} />
  </Routes></main><GlobalPlayer /></div></PlayerProvider>;
}
export default function App() {
  return <PreferencesProvider><SongsProvider><LibraryProvider><BrowserRouter><AppShell /></BrowserRouter></LibraryProvider></SongsProvider></PreferencesProvider>;
}
