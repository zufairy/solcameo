"use client";
/* eslint-disable @next/next/no-img-element -- user media and GIPHY animated images */
import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Play, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { CalloutAttachment } from "@/lib/solstar/calloutMedia";
export function CalloutMedia({ attachments, onRemove, compact = false }: { attachments: CalloutAttachment[]; compact?: boolean; onRemove?: (index: number) => void }) {
  const reduced = useReducedMotion();
  const [opened, setOpened] = useState<CalloutAttachment | null>(null);
  const [playing, setPlaying] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  if (!attachments.length) return null;
  return <>
    <div className={`grid max-w-[500px] gap-2 ${attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {attachments.map((a, i) => <div key={`${a.url}-${i}`} className="group relative overflow-hidden rounded-[3px] border border-white/10 bg-white/[0.025]">
        <button type="button" aria-label={a.type === "gif" && reduced && !playing.includes(a.url) ? `Play GIF: ${a.alt}` : `Open attachment: ${a.alt}`} onClick={() => { if (a.type === "gif" && reduced && !playing.includes(a.url)) setPlaying(p => [...p, a.url]); else setOpened(a); }} className={`block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${attachments.length > 1 ? (compact ? "h-28" : "aspect-square") : "min-h-24"}`}>
          {failed.includes(a.url) ? <span className="flex h-24 items-center justify-center text-xs text-zinc-500">Image unavailable</span> : a.type === "gif" && reduced && !playing.includes(a.url) ? <span className="flex h-32 items-center justify-center gap-2 text-xs text-zinc-300"><Play className="size-4" />Play GIF</span> : <img src={a.url} alt={a.alt || "Callout attachment"} loading="lazy" decoding="async" onError={() => setFailed(p => [...p, a.url])} className={`w-full ${attachments.length > 1 ? "h-full object-cover" : compact ? "max-h-[120px] object-contain" : "max-h-[320px] object-contain"}`} />}
        </button>
        {a.type === "gif" && <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-md">GIF</span>}
        {onRemove && <button type="button" onClick={() => onRemove(i)} aria-label={`Remove attachment ${i + 1}`} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur-md hover:bg-black focus-visible:ring-2 focus-visible:ring-white"><X className="size-3.5" /></button>}
      </div>)}
    </div>
    <Dialog open={!!opened} onOpenChange={value => { if (!value) setOpened(null); }}><DialogContent className="border-white/15 bg-[#14161a]/95 p-4 text-white backdrop-blur-xl sm:max-w-3xl"><DialogTitle className="sr-only">{opened?.alt || "Callout attachment"}</DialogTitle>{opened && <img src={opened.url} alt={opened.alt} className="max-h-[80dvh] w-full rounded-lg object-contain" />}</DialogContent></Dialog>
  </>;
}
