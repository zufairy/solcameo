"use client";
/* eslint-disable @next/next/no-img-element -- previews are browser blob URLs from the exact GIF renderer */
import { useEffect, useState, type ReactNode } from "react";
import type { MaterialData } from "@/lib/server/postMaterialRender";

export type MaterialRender = (data: MaterialData, format: "png" | "gif") => Promise<Blob>;

/* GIF renders are heavy (~25s each): only a couple run at once so a grid of tiles never floods the server. */
let active = 0;
const waiters: (() => void)[] = [];
export async function renderSlot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
  try { return await job(); } finally { active--; waiters.shift()?.(); }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** One card: instant PNG still, then (with `autoAnimate`) the real animated GIF swaps in. */
export function MaterialTile({ data, title, description, index, render, autoAnimate = false, extra }: {
  data: MaterialData; title: string; description: string; index: number; render: MaterialRender; autoAnimate?: boolean; extra?: ReactNode;
}) {
  const [still, setStill] = useState<string>();
  const [gif, setGif] = useState<{ url: string; blob: Blob }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dataKey = JSON.stringify(data);
  useEffect(() => {
    let active = true; const urls: string[] = [];
    const timer = setTimeout(async () => {
      try {
        const png = await render(JSON.parse(dataKey) as MaterialData, "png");
        const url = URL.createObjectURL(png); urls.push(url);
        if (!active) return;
        setStill(url); setError("");
        if (autoAnimate) {
          const blob = await renderSlot(() => render(JSON.parse(dataKey) as MaterialData, "gif"));
          if (!active) return;
          const g = URL.createObjectURL(blob); urls.push(g);
          setGif({ url: g, blob });
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Render failed"); }
    }, 250);
    return () => { active = false; clearTimeout(timer); urls.forEach((u) => URL.revokeObjectURL(u)); setGif(undefined); };
  }, [dataKey, render, autoAnimate]);
  async function exportGif() {
    setBusy(true); setError("");
    try { downloadBlob(gif?.blob ?? await render(data, "gif"), `solcameo-${data.kind}-${data.date.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.gif`); }
    catch (e) { setError(e instanceof Error ? e.message : "Download failed."); }
    finally { setBusy(false); }
  }
  const shown = gif?.url ?? still;
  return (
    <article className="min-w-0">
      <div className="relative aspect-video overflow-hidden border border-lime-300/20 bg-[#090c09] shadow-[0_24px_65px_-38px_rgba(154,209,89,.25)] transition-colors hover:border-lime-300/50">
        {shown ? <img src={shown} alt={`${title} preview`} className="h-full w-full object-contain" /> : <div className="absolute inset-0 animate-pulse bg-[#152015]" />}
        {autoAnimate && still && <span className="absolute right-2 top-2 flex items-center gap-1.5 border border-lime-300/30 bg-black/70 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[.16em] text-lime-200"><span className={`size-1.5 ${gif ? "bg-lime-300" : "animate-pulse bg-amber-300"}`} />{gif ? "Animated" : "Rendering animation"}</span>}
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="flex gap-3"><span className="pt-1 font-mono text-[11px] text-lime-300/65">0{index + 1}</span><div><h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2><p className="mt-1 text-xs text-zinc-500">{description}</p></div></div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button type="button" disabled={busy || !still} onClick={exportGif} className="border border-lime-300/35 bg-lime-300/[.07] px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[.13em] text-lime-200 transition-colors hover:bg-lime-300 hover:text-black active:scale-[.98] disabled:cursor-wait disabled:opacity-40">{busy ? "Rendering…" : "Export GIF"}</button>
          {extra}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </article>
  );
}
