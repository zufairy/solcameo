"use client";

import { useEffect, useRef, useState } from "react";

interface YTPlayer {
  getDuration?: () => number;
  getCurrentTime?: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo?: () => void;
  mute: () => void;
  destroy?: () => void;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}

interface YTNamespace {
  Player: new (
    el: Element,
    config: Record<string, unknown>,
  ) => YTPlayer;
  PlayerState?: { PLAYING?: number };
}

interface YTWindow extends Window {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
}

/* ── Cinematic YouTube background ──────────────────────────────────────────
   A drop-in video backdrop with no YouTube chrome:

   • Uses the IFrame Player API and seeks back to the start a touch before the
     clip ends, so the loop never blinks an end-screen.
   • Stays fully transparent until the player reports PLAYING, then fades in —
     this hides YouTube's poster + the big play/pause button that briefly shows
     while the video is loading.
   • `pointer-events-none` + a 1.35× crop keep controls and the title bar from
     ever appearing or being clickable.

   `className` is merged onto the outer absolute-inset container (e.g. pass a
   z-index like `-z-20`). */
export function VideoBackdrop({
  videoId,
  className = "",
}: {
  videoId: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let player: YTPlayer | null = null;
    let seeking = false;

    function tick() {
      if (cancelled) return;
      if (player?.getDuration) {
        const dur = player.getDuration();
        const t = player.getCurrentTime?.() ?? 0;
        if (dur > 0) {
          // Loop a touch early so we never reach the end-card (which flashes).
          if (t >= dur - 0.4 && !seeking) {
            seeking = true;
            player.seekTo(0, true);
            player.playVideo?.();
          } else if (t < dur - 1) {
            seeking = false;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    function makePlayer() {
      if (cancelled || !containerRef.current) return;
      const YT = (window as unknown as YTWindow).YT!;
      player = new YT.Player(containerRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0,
          modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3, showinfo: 0,
        },
        events: {
          onReady: (e: YTPlayerEvent) => {
            e.target.mute();
            e.target.playVideo?.();
            rafId = requestAnimationFrame(tick);
          },
          onStateChange: (e: YTPlayerEvent) => {
            const YTns = (window as unknown as YTWindow).YT;
            if (e.data === YTns?.PlayerState?.PLAYING) setPlaying(true);
          },
        },
      });
    }

    if ((window as unknown as YTWindow).YT?.Player) {
      makePlayer();
    } else {
      if (!document.getElementById("yt-iframe-api")) {
        const tag = document.createElement("script");
        tag.id = "yt-iframe-api";
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
      const prev = (window as unknown as YTWindow).onYouTubeIframeAPIReady;
      (window as unknown as YTWindow).onYouTubeIframeAPIReady = () => {
        prev?.();
        makePlayer();
      };
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      try {
        player?.destroy?.();
      } catch {}
    };
  }, [videoId]);

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div
        className="absolute left-1/2 top-1/2 h-[max(100%,56.25vw)] w-[max(100%,177.78vh)] -translate-x-1/2 -translate-y-1/2 scale-[1.35] transition-opacity duration-700 ease-out [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
        style={{ opacity: playing ? 1 : 0 }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
