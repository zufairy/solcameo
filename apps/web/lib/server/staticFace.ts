import sharp from "sharp";
import { isDeadMediaUrl } from "../deadMediaHosts";
import { imageExists, imagePublicUrl, putImage, r2ImageConfigured } from "./imageStorage";

// Agent avatars are often stored as animated GIFs. Veo's reference-to-video mode
// needs STATIC images to lock identity — it silently drops GIFs, which collapses
// the render to generic TEXT_2_VIDEO ("text video"). This helper pulls a single
// static frame out of the GIF, caches it as a PNG in R2, and returns the
// public URL so the pipeline gets a real face reference of the NFT.

const HTTP_RE = /^https?:\/\//i;
const GIF_RE = /\.gif(\?|#|$)/i;

export interface StaticFaceResult {
  /** A static HTTPS image of the agent's face (extracted from the GIF if needed). */
  url: string;
  /** Non-fatal note when extraction wasn't possible (caller can keep the original). */
  note?: string;
}

/**
 * Return a STATIC face image URL for the agent. If `avatarUrl` is already a
 * static raster image it's returned as-is. If it's an animated GIF, the first
 * frame is extracted to a PNG and uploaded once (deterministic path → reused on
 * later renders). On any failure the original URL is returned so generation can
 * still proceed (Veo will just fall back to weaker conditioning).
 */
export async function ensureStaticFace(avatarUrl: string | undefined): Promise<StaticFaceResult> {
  const url = (avatarUrl ?? "").trim();
  if (!url || !HTTP_RE.test(url)) return { url };
  if (isDeadMediaUrl(url)) return { url: "", note: "avatar host is dead (restricted Supabase project) — regenerate the avatar" };
  if (!GIF_RE.test(url)) return { url }; // already a static image
  if (!r2ImageConfigured()) {
    return { url, note: "GIF avatar but no storage configured to extract a static frame" };
  }

  try {
    const base = (url.split("/").pop() || "frame.gif").replace(/\.gif.*$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
    const dest = `avatars/frames/${base || "frame"}.png`;

    // Reuse a previously-extracted frame (deterministic key).
    if (await imageExists(dest)) return { url: imagePublicUrl(dest) };

    const res = await fetch(url);
    if (!res.ok) return { url, note: `GIF fetch failed (${res.status})` };
    const gifBuf = Buffer.from(await res.arrayBuffer());
    // sharp reads the first frame of an animated GIF with { page: 0 }.
    const png = await sharp(gifBuf, { page: 0 }).png().toBuffer();

    const { url: publicUrl } = await putImage(png, "image/png", { key: dest });
    return { url: publicUrl };
  } catch (e) {
    return { url, note: e instanceof Error ? e.message : "frame extraction failed" };
  }
}
