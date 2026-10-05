/**
 * Upload a File to R2 through /api/media/upload-stream (streamed server-side,
 * never Convex). XHR, not fetch, so the UI gets real byte progress for big
 * source videos. Resolves with the public R2 URL.
 */
export type UploadedMedia = { url: string; kind: "video" | "image" | "audio"; name: string };

export function uploadMediaFile(
  file: File,
  opts: { accessToken?: string | null; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedMedia> {
  return new Promise((resolve, reject) => {
    const type = file.type || guessType(file.name);
    const qs = new URLSearchParams({ name: file.name, type });
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/media/upload-stream?${qs.toString()}`);
    if (opts.accessToken) xhr.setRequestHeader("Authorization", `Bearer ${opts.accessToken}`);
    xhr.setRequestHeader("Content-Type", type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let j: { ok?: boolean; url?: string; kind?: UploadedMedia["kind"]; name?: string; error?: string } = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300 && j.ok && j.url && j.kind) {
        opts.onProgress?.(100);
        resolve({ url: j.url, kind: j.kind, name: j.name ?? file.name });
      } else {
        reject(new Error(j.error ?? (xhr.status === 401 ? "Sign in to upload" : `Upload failed (HTTP ${xhr.status})`)));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", m4v: "video/x-m4v",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" } as Record<string, string>)[ext] ?? "";
}
