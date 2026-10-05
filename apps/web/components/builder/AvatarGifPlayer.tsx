"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Download, BadgeCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AvatarGifPlayerProps {
  images: Array<{ url: string; label: string; style: string }>;
  /** Server-hosted animated GIF (Supabase). When present we download THIS directly
   *  instead of re-encoding client-side — far more reliable. */
  gifUrl?: string;
  personaName?: string;
}

// Kie CDN hosts that need our same-origin proxy to dodge canvas CORS tainting.
// Data URIs and Supabase URLs load directly and must NOT be sent to the proxy
// (the proxy rejects non-Kie hosts → that was the old "Failed to load" error).
const PROXY_HOSTS = ["kie.ai", "aiquickdraw.com"];
function needsProxy(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  try {
    const host = new URL(url, window.location.origin).hostname;
    return PROXY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function AvatarGifPlayer({ images, gifUrl, personaName }: AvatarGifPlayerProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const validImages = images.filter((img) => img.url);

  useEffect(() => {
    if (validImages.length < 2) return;
    intervalRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % validImages.length);
    }, 500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [validImages.length]);

  const handleDownloadGif = useCallback(async () => {
    if (validImages.length === 0 && !gifUrl) return;
    setIsDownloading(true);
    const filename = `${(personaName ?? "avatar").replace(/\s+/g, "-").toLowerCase()}-nft.gif`;
    try {
      // ── Primary path: the server already made the animated GIF on Supabase.
      // Route the download through our same-origin /api/download-gif endpoint:
      // it fetches the GIF server-side (no browser CORS) and returns it with
      // Content-Disposition: attachment, so the browser performs a real download
      // instead of opening the file in a new tab. No client encoding, no proxy.
      if (gifUrl) {
        const href = `/api/download-gif?url=${encodeURIComponent(gifUrl)}&name=${encodeURIComponent(filename)}`;
        triggerDownload(href, filename);
        return;
      }

      // ── Fallback: re-encode a GIF from the frames in the browser.
      const SIZE = 512;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GIFEncoder = (await import("gif-encoder-2")).default as any;
      const encoder = new GIFEncoder(SIZE, SIZE, "neuquant", true);
      encoder.setDelay(500);
      encoder.setRepeat(0);
      encoder.setQuality(10);
      encoder.start();

      const offscreen = document.createElement("canvas");
      offscreen.width = SIZE;
      offscreen.height = SIZE;
      const ctx = offscreen.getContext("2d")!;

      for (const img of validImages) {
        const el = new window.Image();
        // Only data URIs / blobs / same-origin / Supabase here — proxy ONLY the
        // Kie CDN hosts that actually need it. Proxying a data URI is what broke
        // downloads before (the proxy 403s anything that isn't a Kie host).
        const src = needsProxy(img.url)
          ? `/api/proxy-image?url=${encodeURIComponent(img.url)}`
          : img.url;
        if (!src.startsWith("data:")) el.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          el.onload = () => resolve();
          el.onerror = () => reject(new Error(`Failed to load ${img.url.slice(0, 64)}`));
          el.src = src;
        });
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(el, 0, 0, SIZE, SIZE);
        encoder.addFrame(ctx);
      }

      encoder.finish();
      const buffer = encoder.out.getData() as unknown as ArrayBuffer;
      const blob = new Blob([buffer], { type: "image/gif" });
      const objUrl = URL.createObjectURL(blob);
      triggerDownload(objUrl, filename);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch (err) {
      console.error("GIF download failed:", err);
      // Last resort: open the hosted GIF in a new tab so the user can save it manually.
      if (gifUrl) window.open(gifUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsDownloading(false);
    }
  }, [validImages, gifUrl, personaName]);

  if (validImages.length === 0) return null;

  const current = validImages[activeIdx % validImages.length];

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Animated GIF player */}
      <div className="relative rounded-xl overflow-hidden border border-emerald-400/20 shadow-lg shadow-emerald-900/20"
        style={{ aspectRatio: "1", width: "100%" }}>
        <AnimatePresence mode="wait">
          <motion.img
            key={current.url}
            src={current.url}
            alt={current.label}
            className="absolute inset-0 w-full h-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeInOut" }}
          />
        </AnimatePresence>

        {/* Overlay: label + frame counter */}
        <div className="absolute bottom-0 inset-x-0 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent flex items-end justify-between">
          <span className="text-[10px] text-white/80 font-medium">{current.label}</span>
          <span className="text-[10px] text-white/40">
            {(activeIdx % validImages.length) + 1}/{validImages.length}
          </span>
        </div>

        {/* Flashing highlight ring */}
        <motion.div
          className="absolute inset-0 rounded-xl ring-1 ring-emerald-400/40 pointer-events-none"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Strip thumbnails */}
      <div className="grid grid-cols-3 gap-1">
        {validImages.map((img, i) => (
          <button
            key={img.url}
            onClick={() => setActiveIdx(i)}
            className={`relative rounded-md overflow-hidden aspect-square border transition-all ${
              activeIdx % validImages.length === i
                ? "border-emerald-400 shadow-sm shadow-emerald-400/30"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/20" />
            <span className="absolute bottom-0.5 inset-x-0 text-center text-[8px] text-white/70 truncate px-0.5">
              {img.label}
            </span>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleDownloadGif}
          disabled={isDownloading}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/25 hover:border-emerald-400/50 text-emerald-300 text-[11px] font-medium py-2 transition-all disabled:opacity-50"
        >
          {isDownloading ? (
            <>
              <span className="size-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
              Creating GIF…
            </>
          ) : (
            <>
              <Download className="size-3" />
              Download GIF
            </>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-2 text-[11px] font-semibold text-emerald-300">
          <BadgeCheck className="size-3.5" />
          NFT-ready
        </div>
      </div>
    </div>
  );
}
