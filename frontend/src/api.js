
const API = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";

// Fetch all uploaded songs
export async function getSongs() {
  const response = await fetch(`${API}/songs/`);

  if (!response.ok) {
    throw new Error("Could not load songs from Django.");
  }

  const data = await response.json();

  return Array.isArray(data) ? data : (data.results || []);
}

// Upload one or multiple MP3 files
export async function uploadSong(formData, bulk = false) {
  const endpoint = bulk ? "bulk-upload/" : "";

  const response = await fetch(`${API}/songs/${endpoint}`, {
    method: "POST",
    body: formData
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const bulkErrors = Array.isArray(data.errors)
      ? data.errors.map(item =>
          `${item.file}: ${item.error}`
        ).join("\n")
      : "";

    const detail =
      data.details ||
      data.error ||
      bulkErrors ||
      data.original_file?.[0] ||
      "Upload failed.";

    throw new Error(detail);
  }

  return data;
}

// Update existing song metadata

// Update existing song metadata and album artwork
export async function updateSong(songId, changes) {
  const isFormData = changes instanceof FormData;

  const response = await fetch(`${API}/songs/${songId}/`, {
    method: "PATCH",
    headers: isFormData
      ? {}
      : { "Content-Type": "application/json" },
    body: isFormData ? changes : JSON.stringify(changes)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      data.detail ||
      Object.entries(data)
        .map(([field, messages]) =>
          `${field}: ${
            Array.isArray(messages)
              ? messages.join(", ")
              : messages
          }`
        )
        .join("\n") ||
      "Could not update song details.";

    throw new Error(detail);
  }

  return data;
}

