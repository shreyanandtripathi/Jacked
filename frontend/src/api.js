const API = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";

export async function getSongs() {
  const response = await fetch(`${API}/songs/`);
  if (!response.ok) throw new Error("Could not load songs from Django.");
  const data = await response.json();
  return Array.isArray(data) ? data : (data.results || []);
}

export async function uploadSong(formData) {
  const response = await fetch(`${API}/songs/`, { method: "POST", body: formData });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.details || data.error || data.original_file?.[0] || "Upload failed.";
    throw new Error(detail);
  }
  return data;
}
