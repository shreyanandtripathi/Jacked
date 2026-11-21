import React ,{ createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, NavLink, Routes, Route } from "react-router-dom";
import Hls from "hls.js";
import {
  Activity, AudioLines, ChevronDown, ChevronUp, Heart, Home as HomeIcon,
  Library, ListMusic, Moon, Monitor, Music2, Pause, Play, Plus, Radio,
  Search, Settings as SettingsIcon, Shuffle, SkipBack, SkipForward, Sun,
  UploadCloud, Volume2, VolumeX, Repeat, Repeat1, Trash2, X, Headphones
} from "lucide-react";
import { getSongs, uploadSong } from "./api";

const Prefs = createContext(null);
const LibraryCtx = createContext(null);
const SongsCtx = createContext(null);
const PlayerCtx = createContext(null);

const defaults = {
  quality: "auto", statsEnabled: true, segmentsEnabled: true,
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
  const [stats, setStats] = useState({ quality: "—", speed: 0, segment: "—", size: "—", buffer: "0.0", state: "Waiting" });
  const [segments, setSegments] = useState([]);

  const playSong = (item, list = []) => {
    setQueue(list.length ? list : [item]); setSong(item); setTime(0); setPlaying(true); setMonitorOpen(true);
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
    else { audio.pause(); setPlaying(false); }
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
    setSegments([]);
    setStats({ quality: "Loading", speed: 0, segment: "—", size: "—", buffer: "0.0", state: "Loading HLS playlist" });

    const getBuffer = () => {
      for (let i = 0; i < audio.buffered.length; i++) {
        if (audio.currentTime >= audio.buffered.start(i) && audio.currentTime <= audio.buffered.end(i))
          return Math.max(0, audio.buffered.end(i) - audio.currentTime);
      }
      return 0;
    };

    if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = song.stream_url;
      setStats(s => ({ ...s, state: "Native HLS playback" }));
    } else if (Hls.isSupported()) {
      hls = new Hls({
        startLevel: -1, capLevelToPlayerSize: false,
        maxBufferLength: 30, maxMaxBufferLength: 60,
        abrEwmaDefaultEstimate: 500000, abrBandWidthFactor: .8,
        abrBandWidthUpFactor: .7
      });
      hlsRef.current = hls;
      hls.loadSource(song.stream_url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStats(s => ({ ...s, state: "Manifest loaded · ready" }));
        chooseLevel(hls, preferences.quality);
        if (playing) audio.play().catch(() => setPlaying(false));
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level];
        if (level) setStats(s => ({ ...s, quality: `${Math.round((level.averageBitrate || level.bitrate) / 1000)} kbps` }));
      });
      hls.on(Hls.Events.FRAG_LOADING, (_, data) => {
        const frag = data.frag; if (frag.sn === "initSegment") return;
        setSegments(old => [...old.filter(x => x.number !== String(frag.sn)), { number: String(frag.sn), status: "loading", size: "—" }].slice(-14));
        setStats(s => ({ ...s, state: `Downloading segment ${frag.sn}` }));
      });
      hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
        const frag = data.frag; if (frag.sn === "initSegment") return;
        const bytes = data.stats.loaded || 0;
        const ms = data.stats.loading.end - data.stats.loading.start;
        const speed = ms > 0 ? Math.round(bytes * 8 / ms) : 0;
        const level = hls.levels[frag.level];
        const quality = level ? `${Math.round((level.averageBitrate || level.bitrate) / 1000)} kbps` : "—";
        const size = `${(bytes / 1024).toFixed(1)} KB`;
        setStats({ quality, speed, segment: String(frag.sn), size, buffer: getBuffer().toFixed(1), state: "Segment downloaded" });
        setSegments(old => [...old.filter(x => x.number !== String(frag.sn)), { number: String(frag.sn), status: "downloaded", size }].slice(-14));
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        setStats(s => ({ ...s, state: `Playback error: ${data.details}` }));
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.destroy();
      });
    } else {
      setStats(s => ({ ...s, state: "HLS is not supported by this browser" }));
    }

    const onTime = () => { setTime(audio.currentTime || 0); setStats(s => ({ ...s, buffer: getBuffer().toFixed(1) })); };
    const onDuration = () => setDuration(audio.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); }
      else if (preferences.autoplay) next();
      else setPlaying(false);
    };
    audio.volume = volume;
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
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
    monitorOpen, stats, segments, audioRef, playSong, next, previous,
    togglePlay, seek, setVol, toggleMute, setShuffle, setRepeat, setMonitorOpen
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
  const liked = library.likedIds.includes(song.id);
  return <article className="song-card">
    <button className="cover-button" onClick={() => onPlay(song)}>
      {song.cover_url ? <img src={song.cover_url} alt="" /> : <div className="cover-placeholder">♫</div>}
      <span className="cover-play"><Play size={19} fill="currentColor" /></span>
    </button>
    <div className="song-info"><div className="song-title-row"><button className="song-title" onClick={() => onPlay(song)}>{song.title}</button>
      <button className={`tiny-icon ${liked ? "liked" : ""}`} onClick={() => toggleLike(song.id)} title="Like"><Heart size={16} fill={liked ? "currentColor" : "none"} /></button></div>
      <p>{song.artist}</p><div className="song-card-foot"><span className="ready-dot">READY TO STREAM</span><button className="tiny-icon" onClick={() => onAdd(song)} title="Add to playlist"><Plus size={16} /></button></div>
    </div>
  </article>;
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

function Home() {
  const { songs, loading, error } = useSongs();
  const { playSong } = usePlayer();
  const [pick, setPick] = useState(null);
  const ready = songs.filter(s => s.processing_status === "ready");
  return <div className="page">
    <section className="hero"><div className="hero-copy"><small className="eyebrow">YOUR PERSONAL SOUNDTRACK</small><h1>Music that<br /><em>moves with you.</em></h1><p>Your collection, your rules. Stream in adaptive quality and make every listening session yours.</p><a className="btn" href="#tracks"><Headphones size={16} /> Explore music</a><div className="hero-meta"><i /> HLS STREAMING · 128–320 KBPS</div></div><div className="hero-art"><div className="vinyl"><div>J</div></div><span className="note note-a">♪</span><span className="note note-b">♫</span></div></section>
    <div className="quick-stats"><span><Music2 size={16} /> <b>{songs.length}</b> tracks</span><span><Headphones size={16} /> <b>{ready.length}</b> ready</span><span><Radio size={16} /> <b>Adaptive HLS</b> streaming</span></div>
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
  const [form, setForm] = useState({ title: "", artist: "", album: "", genre: "" });
  const [audio, setAudio] = useState(null); const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const update = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const submit = async e => {
    e.preventDefault(); setError(""); setMessage("");
    if (!audio) { setError("Choose an MP3 file first."); return; }
    const body = new FormData(); Object.entries(form).forEach(([k,v]) => body.append(k,v));
    body.append("original_file", audio); if (cover) body.append("cover", cover);
    setBusy(true); setMessage("Uploading and generating three HLS renditions. Keep this page open…");
    try {
      const result = await uploadSong(body);
      setMessage(`“${result.title}” is processed and ready to stream.`);
      setForm({ title: "", artist: "", album: "", genre: "" }); setAudio(null); setCover(null);
      await refresh();
    } catch (err) { setError(err.message); setMessage(""); }
    finally { setBusy(false); }
  };
  return <div className="page narrow"><PageTitle eyebrow="GROW YOUR COLLECTION" title="Upload music" subtitle="Add an MP3. Jacked prepares adaptive HLS streams automatically." />
    <form className="upload-panel" onSubmit={submit}>
      <div className="drop-zone"><UploadCloud size={28} /><h3>{audio ? audio.name : "Choose your audio file"}</h3><p>MP3 format · Maximum 100 MB</p><input type="file" accept=".mp3,audio/mpeg" onChange={e => setAudio(e.target.files?.[0] || null)} required /></div>
      <div className="form-grid">
        <label>Song title *<input required value={form.title} onChange={e => update("title",e.target.value)} placeholder="Song title" /></label>
        <label>Artist *<input required value={form.artist} onChange={e => update("artist",e.target.value)} placeholder="Artist name" /></label>
        <label>Album<input value={form.album} onChange={e => update("album",e.target.value)} placeholder="Album name" /></label>
        <label>Genre<input value={form.genre} onChange={e => update("genre",e.target.value)} placeholder="Genre" /></label>
      </div>
      <label className="cover-field">Album artwork (optional) <input type="file" accept="image/*" onChange={e => setCover(e.target.files?.[0] || null)} /></label>
      {message && <div className="success-msg">{message}</div>}{error && <div className="error-msg">{error}</div>}
      <button className="btn submit-btn" disabled={busy}>{busy ? "Processing audio…" : <><Music2 size={16} /> Upload and process</>}</button>
      <p className="form-note">Original MP3 is retained locally. FFmpeg generates 128, 256 and 320 kbps AAC/HLS versions.</p>
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
      <SettingRow icon={Radio} title="Audio quality" description="Auto adapts to network and buffer conditions.">
        <select value={p.quality} onChange={e => update("quality",e.target.value)}><option value="auto">Auto · Recommended</option><option value="128">Data Saver · 128 kbps</option><option value="256">High · 256 kbps</option><option value="320">Very High · 320 kbps</option></select>
      </SettingRow>
      <div className="quality-options">{["auto","128","256","320"].map(q => <div key={q} className={p.quality === q ? "chosen" : ""}>{q === "auto" ? "AUTO" : q}<small>{q === "auto" ? "Adaptive" : "kbps"}</small></div>)}</div>
      <p className="setting-hint">Auto is enabled by default. Manual modes select the nearest available rendition. A 320 kbps encode cannot restore detail absent from the source.</p>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>02 / TRANSPARENCY</small><h2>Streaming diagnostics</h2></div><Activity size={21} /></div>
      <SettingRow icon={Activity} title="Stats for Nerds" description="Live rendition, segment throughput, size and buffer."><Toggle value={p.statsEnabled} onChange={v => update("statsEnabled",v)} /></SettingRow>
      <SettingRow icon={AudioLines} title="Segment visualization" description="Show each HLS media segment as it downloads."><Toggle value={p.segmentsEnabled} onChange={v => update("segmentsEnabled",v)} /></SettingRow>
      <p className="setting-hint">Both diagnostics are ON by default. Open the activity icon in the bottom player to view them.</p>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>03 / APPEARANCE</small><h2>Theme</h2></div><Sun size={21} /></div>
      <div className="theme-options">{[["dark","Dark",Moon],["light","Light",Sun],["system","System",Monitor]].map(([value,label,Icon]) => <button key={value} className={p.theme === value ? "theme-choice selected" : "theme-choice"} onClick={() => update("theme",value)}><Icon size={18} />{label}{p.theme === value && <span>✓</span>}</button>)}</div>
    </section>
    <section className="settings-card"><div className="settings-heading"><div><small>04 / OTHER PREFERENCES</small><h2>Listening habits</h2></div><SettingsIcon size={21} /></div>
      <SettingRow icon={Radio} title="Autoplay" description="Continue with the next track when the current one ends."><Toggle value={p.autoplay} onChange={v => update("autoplay",v)} /></SettingRow>
      <SettingRow icon={AudioLines} title="Audio normalization" description="Preference saved; audio processing is not active in this version."><Toggle value={p.normalization} onChange={v => update("normalization",v)} /></SettingRow>
      <SettingRow icon={SettingsIcon} title="Crossfade" description="Preference saved; crossfade playback is planned for a later version.">
        <select value={p.crossfade} onChange={e => update("crossfade",Number(e.target.value))}><option value="0">Off</option><option value="2">2 seconds</option><option value="4">4 seconds</option><option value="6">6 seconds</option><option value="8">8 seconds</option></select>
      </SettingRow>
    </section>
    <p className="saved-note">✓ Preferences are saved automatically on this device.</p>
  </div>;
}

function GlobalPlayer() {
  const player = usePlayer(); const { preferences } = usePrefs();
  const song = player.song;
  if (!song) return <div className="global-player empty-player"><span className="empty-mark">♫</span>Select a song to start listening <small>HLS · Adaptive audio</small></div>;
  const progress = player.duration ? player.time / player.duration * 100 : 0;
  return <div className="global-player">
    {player.monitorOpen && <div className="monitor-panel">
      <div className="monitor-head"><div><small>LIVE STREAM DIAGNOSTICS</small><h3>Stats for Nerds</h3></div><button className="tiny-icon" onClick={() => player.setMonitorOpen(false)}><ChevronDown size={18} /></button></div>
      {preferences.statsEnabled ? <><div className="stats-grid">
        <div><small>Current rendition</small><b>{player.stats.quality}</b></div>
        <div><small>Segment throughput</small><b>{player.stats.speed.toLocaleString()} kbps</b></div>
        <div><small>Segment number</small><b>{player.stats.segment}</b></div>
        <div><small>Segment size</small><b>{player.stats.size}</b></div>
        <div><small>Buffered ahead</small><b>{player.stats.buffer}s</b></div>
        <div><small>Transport</small><b>AAC / HLS</b></div>
      </div><div className="monitor-state"><i />{player.stats.state}</div></> : <p className="setting-hint">Stats for Nerds is disabled in Settings.</p>}
      {preferences.segmentsEnabled && <div className="segment-area"><div className="segment-label"><b>Recent HLS segments</b><small>Latest {player.segments.length}</small></div>
        <div className="segment-strip">{player.segments.length ? player.segments.map((s,i) => <div key={`${s.number}-${i}`} className={`segment-chip ${s.status}`} title={`Segment ${s.number} · ${s.size}`}><span>{s.number}</span><i /></div>) : <span className="setting-hint">Segments appear when playback starts.</span>}</div>
        <p className="setting-hint">Each tile represents an individual media fragment downloaded by the browser.</p>
      </div>}
    </div>}
    <div className="player-bar">
      <div className="now-playing">{song.cover_url ? <img src={song.cover_url} alt="" /> : <span className="mini-art">♫</span>}<div><b>{song.title}</b><small>{song.artist}</small></div></div>
      <div className="player-center"><div className="controls">
        <button className={player.shuffle ? "control-on" : ""} onClick={() => player.setShuffle(!player.shuffle)} title="Shuffle"><Shuffle size={16} /></button>
        <button onClick={player.previous} title="Previous"><SkipBack size={18} /></button>
        <button className="main-play" onClick={player.togglePlay} title="Play/Pause">{player.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button onClick={player.next} title="Next"><SkipForward size={18} /></button>
        <button className={player.repeat !== "off" ? "control-on" : ""} onClick={() => player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")} title={`Repeat ${player.repeat}`}>{player.repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}</button>
      </div><div className="progress-line"><span>{fmtTime(player.time)}</span><input type="range" min="0" max={player.duration || 0} step=".1" value={Math.min(player.time,player.duration || 0)} onChange={e => player.seek(Number(e.target.value))} style={{"--progress":`${progress}%`}} /><span>{fmtTime(player.duration)}</span></div></div>
      <div className="player-tools"><span className="quality-tag">{preferences.quality === "auto" ? `AUTO · ${player.stats.quality}` : `${preferences.quality} KBPS`}</span><button onClick={() => player.setMonitorOpen(!player.monitorOpen)} title="Streaming diagnostics"><Activity size={17} /></button><button onClick={player.toggleMute} title="Mute">{player.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button><input aria-label="Volume" type="range" min="0" max="1" step=".01" value={player.volume} onChange={e => player.setVol(e.target.value)} /></div>
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
