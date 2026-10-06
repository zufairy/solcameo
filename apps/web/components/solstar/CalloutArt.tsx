"use client";
import { useEffect, useRef } from "react";
import { CARD_H, CARD_W, drawCalloutCard, loadCardImage, type CalloutCardData, type CalloutThemeId } from "@/lib/client/calloutCard";

/**
 * A callout's share card, drawn in its chosen template. It counts up and draws its chart the first time it
 * scrolls into view, then idles with the template's own motion (see `.callout-art` in globals.css).
 */
export function CalloutArt({ data, theme, className = "", scale = 0.5, replay = false }: { data: CalloutCardData; theme: CalloutThemeId; className?: string; /** Canvas resolution relative to 720×1280. Feed cards stay at 0.5; the preview uses more. */ scale?: number; /** Replay the count-up whenever the data or template changes (the composer preview). */ replay?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const latest = useRef({ data, theme });
  const state = useRef<{ img: HTMLImageElement | null; loadedFor: string; played: boolean; raf: number; draw: (p: number) => void }>({ img: null, loadedFor: "", played: false, raf: 0, draw: () => {} });
  latest.current = { data, theme };
  const key = `${theme}|${data.name}|${data.ticker}|${data.body}|${data.cap}|${data.changePct}|${data.label}|${data.views}|${data.videos}|${data.bars?.join(",")}|${data.volume}|${data.followers}|${data.calledAt}|${data.caller}|${data.imageUrl}`;

  useEffect(() => {
    const el = canvas.current, host = shell.current;
    if (!el || !host) return;
    const SCALE = scale;
    el.width = CARD_W * SCALE; el.height = CARD_H * SCALE;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = state.current;
    s.draw = (p: number) => {
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawCalloutCard(ctx, latest.current.data, s.img, latest.current.theme, p);
    };
    const url = data.imageUrl ?? "";
    if (url !== s.loadedFor) {
      s.loadedFor = url;
      void loadCardImage(url).then((img) => { if (s.loadedFor === url) { s.img = img; s.draw(s.played ? 1 : 0); } });
    }
    s.draw(s.played || reduced ? 1 : 0);
    const play = () => {
      if (s.played) return;
      s.played = true;
      if (reduced) { s.draw(1); return; }
      const start = performance.now();
      const frame = (now: number) => {
        const k = Math.min(1, (now - start) / 1100);
        s.draw(k);
        if (k < 1) s.raf = requestAnimationFrame(frame);
      };
      s.raf = requestAnimationFrame(frame);
    };
    if (replay) { s.played = false; play(); return () => cancelAnimationFrame(s.raf); }
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { play(); observer.disconnect(); } }, { threshold: 0.35 });
    observer.observe(host);
    return () => { observer.disconnect(); cancelAnimationFrame(s.raf); };
    // Redraw whenever any visible field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div ref={shell} data-theme={theme} className={`callout-art relative aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-black ring-1 ring-white/15 ${className}`}>
      <canvas ref={canvas} role="img" aria-label={`${data.name} callout card`} className="absolute inset-0 size-full" />
    </div>
  );
}
