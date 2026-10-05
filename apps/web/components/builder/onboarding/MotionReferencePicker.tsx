"use client";
/* eslint-disable @next/next/no-img-element -- remote CDN thumbnails */
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { CATEGORIES, type ReferenceVideo } from "@/lib/explore/feed";

/** Library picker for the Motion Swap format: browse Higgsfield motion references
 *  (same feed as /explore) and pick the move the character will perform. */
export function MotionReferencePicker({ value, onPick }: { value: string; onPick: (ref: ReferenceVideo) => void }) {
  const [items, setItems] = useState<ReferenceVideo[]>([]);
  const [cursor, setCursor] = useState<number | null>(1);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (at: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/explore?cursor=${at}`);
      const data = (await res.json()) as { items?: ReferenceVideo[]; next?: number | null; error?: string };
      if (!res.ok || !data.items) throw new Error(data.error ?? "Library unavailable");
      // Portrait clips only: Motion Swap output is a vertical short.
      const vertical = data.items.filter((i) => (i.height ?? 0) > (i.width ?? 0));
      setItems((prev) => [...prev, ...vertical.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(data.next ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Library unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  const shown = category === "All" ? items : items.filter((i) => i.category === category);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${category === c ? "bg-white text-black" : "bg-white/[0.06] text-zinc-400 hover:text-white"}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="mt-3 grid max-h-[340px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
        {shown.map((r) => {
          const on = r.videoUrl === value;
          return (
            <button key={r.id} type="button" onClick={() => onPick(r)} aria-pressed={on} title={r.title}
              className={`group relative aspect-[9/16] overflow-hidden rounded-lg border transition-colors ${on ? "border-lime-400" : "border-white/10 hover:border-white/30"}`}>
              {r.thumbUrl ? <img src={r.thumbUrl} alt={r.title} loading="lazy" className="size-full object-cover" /> : <div className="size-full bg-white/[0.04]" />}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-left text-[10px] font-medium leading-tight text-white">{r.title}</span>
              {on && <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-lime-400 text-zinc-950"><Check className="size-3" /></span>}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
        <span>{shown.length} moves loaded</span>
        {cursor && (
          <button type="button" disabled={loading} onClick={() => void load(cursor)} className="inline-flex items-center gap-1 font-semibold text-zinc-300 hover:text-white disabled:opacity-50">
            {loading && <Loader2 className="size-3 animate-spin" />}Load more
          </button>
        )}
      </div>
    </div>
  );
}
