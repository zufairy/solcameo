"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/* ── Scroll-triggered YouTube card ───────────────────────────────────────────
   A big rounded video card that autoplays (muted) when it scrolls into view and
   pauses when it leaves. Browsers block UNMUTED autoplay without a user gesture,
   so sound stays off until the viewer clicks the sound toggle.

   Drives the embed via the YouTube iframe postMessage API directly (not the
   YT.Player wrapper) — that plays nicely with React StrictMode's double-mount,
   which otherwise leaves a stale player reference that silently ignores
   commands. */

export const VELLO_QUICK_START_VIDEO_ID = "3O4vZAxiJl4";
const VIDEO_ID = VELLO_QUICK_START_VIDEO_ID;

export function ScrollVideo() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const visibleRef = useRef(false);
  const retryTimers = useRef<number[]>([]);
  const [muted, setMuted] = useState(true);

  // Fire-and-forget command to the embed.
  const cmd = useCallback((func: string, cmdArgs: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args: cmdArgs }),
      "*",
    );
  }, []);

  const clearRetries = useCallback(() => {
    retryTimers.current.forEach((t) => clearTimeout(t));
    retryTimers.current = [];
  }, []);

  // The embed silently drops commands sent before its player is ready, and
  // there's no reliable "ready" signal without the full API — so fire the
  // command now and re-fire a few times to defeat any drops.
  const syncPlayback = useCallback(() => {
    clearRetries();
    const func = visibleRef.current ? "playVideo" : "pauseVideo";
    cmd(func);
    [150, 500, 1200].forEach((delay) => {
      retryTimers.current.push(
        window.setTimeout(() => {
          // Only keep retrying while the intent still matches.
          if ((visibleRef.current ? "playVideo" : "pauseVideo") === func) cmd(func);
        }, delay),
      );
    });
  }, [cmd, clearRetries]);

  // Play when in view, pause when out.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        syncPlayback();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearRetries();
    };
  }, [syncPlayback, clearRetries]);

  const onLoad = () => {
    // Register for player events, then apply current visibility intent.
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening" }),
      "*",
    );
    cmd("mute");
    syncPlayback();
  };

  const toggleSound = () => {
    if (muted) {
      cmd("unMute");
      cmd("setVolume", [100]);
      cmd("playVideo");
      setMuted(false);
    } else {
      cmd("mute");
      setMuted(true);
    }
  };

  // enablejsapi=1 lets us postMessage; mute=1 satisfies the muted-autoplay
  // policy; loop needs playlist=<id>; controls=0 keeps the card clean.
  const src =
    `https://www.youtube.com/embed/${VIDEO_ID}` +
    `?enablejsapi=1&mute=1&controls=0&rel=0&modestbranding=1` +
    `&playsinline=1&loop=1&playlist=${VIDEO_ID}`;

  return (
    <div
      ref={wrapRef}
      className="relative aspect-video w-full overflow-hidden rounded-[28px] bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] ring-1 ring-black/10"
    >
      <iframe
        ref={iframeRef}
        src={src}
        title="Vello Quick Start"
        onLoad={onLoad}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
      <button
        type="button"
        onClick={toggleSound}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute bottom-4 right-4 z-10 flex size-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
      >
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>
    </div>
  );
}
