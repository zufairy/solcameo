"use client";
/* eslint-disable @next/next/no-img-element -- GIPHY previews */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Search, Film } from "lucide-react";
import { CALLOUT_GIFS, CALLOUT_MEDIA_LIMIT, CALLOUT_UPLOAD_BYTES, isGiphyUrl, type CalloutAttachment } from "@/lib/solstar/calloutMedia";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { CalloutMedia } from "./CalloutMedia";
export function CalloutAttachments({ value, onChange, onBusy, disabled, children }: { children?: React.ReactNode; value: CalloutAttachment[]; onChange: (value: CalloutAttachment[]) => void; onBusy: (busy: boolean) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null), upload = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false), [picker, setPicker] = useState(false), [query, setQuery] = useState("");
  const [key, setKey] = useState<string | null>(null), [results, setResults] = useState<CalloutAttachment[]>(CALLOUT_GIFS);
  const [searching, setSearching] = useState(false), [error, setError] = useState("");
  const full = value.length >= CALLOUT_MEDIA_LIMIT;
  const visibleResults = key ? results : CALLOUT_GIFS.filter(a => `${a.alt} ${a.tags}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => () => { upload.current?.abort(); }, []);
  useEffect(() => {
    if (!picker) return;
    const ctrl = new AbortController();
    void fetch("/api/solstar/callouts/gifs", { signal: ctrl.signal }).then(r => r.json()).then(d => setKey(typeof d.apiKey === "string" ? d.apiKey : null)).catch(() => {});
    return () => ctrl.abort();
  }, [picker]);
  useEffect(() => {
    if (!picker) return;
    const fallback = CALLOUT_GIFS.filter(a => `${a.alt} ${a.tags}`.toLowerCase().includes(query.trim().toLowerCase()));
    if (!key) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true); setError("");
      try {
        const params = new URLSearchParams({ api_key: key, limit: "24", rating: "pg", ...(query ? { q: query } : {}) });
        const res = await fetch(`https://api.giphy.com/v1/gifs/${query ? "search" : "trending"}?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error("search");
        const json = await res.json();
        const gifs = (json.data as Array<{ title?: string; images?: { fixed_width?: { url?: string } } }>).flatMap(g => {
          const url = g.images?.fixed_width?.url;
          return url && isGiphyUrl(url) ? [{ url, type: "gif" as const, alt: (g.title || "GIPHY reaction").slice(0, 160) }] : [];
        });
        if (!ctrl.signal.aborted) setResults(gifs);
      } catch { if (!ctrl.signal.aborted) { setResults(fallback); setError("GIF search is unavailable. Try a reaction below or upload a GIF."); } }
      finally { if (!ctrl.signal.aborted) setSearching(false); }
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); setSearching(false); };
  }, [picker, key, query]);
  async function uploadFile(file: File) {
    if (disabled || uploading || full) return;
    if (!file.size || file.size > CALLOUT_UPLOAD_BYTES || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(file.type)) { setError("Choose PNG, JPG, WebP, AVIF or GIF under 8 MB."); return; }
    const ctrl = new AbortController(); upload.current = ctrl;
    setUploading(true); onBusy(true); setError("");
    try {
      if (!getCurrentSiwsToken()) await ensureSiwsViaRegistered();
      if (ctrl.signal.aborted) return;
      const form = new FormData(); form.append("file", file);
      const res = await fetch("/api/solstar/callouts/upload", { method: "POST", body: form, signal: ctrl.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed. Please try again.");
      if (!ctrl.signal.aborted) onChange([...value, { url: data.url, type: data.type, alt: data.alt }]);
    } catch (e) { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Upload failed. Please try again."); }
    finally { if (!ctrl.signal.aborted) { setUploading(false); onBusy(false); } }
  }
  return <div className="overflow-hidden rounded-xl border border-white/15 bg-white/[0.025] transition-colors focus-within:border-white/30 focus-within:ring-1 focus-within:ring-white/10">
    {children}
    {!!value.length && <div className="px-3 pb-3"><CalloutMedia compact attachments={value} onRemove={disabled || uploading ? undefined : i => onChange(value.filter((_, index) => index !== i))} /></div>}
    <div className="flex items-center gap-1 border-t border-white/[0.06] px-2 py-1.5">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadFile(file); }} />
      <button type="button" aria-label="Add image" title="Add image" disabled={disabled || uploading || full} onClick={() => input.current?.click()} className="grid size-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40">{uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}</button>
      <button type="button" aria-label="Add GIF" title="Add GIF" aria-expanded={picker} disabled={disabled || uploading || full} onClick={() => { setPicker(p => !p); setError(""); }} className={`grid size-8 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 ${picker ? "bg-white text-black" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}><Film className="size-3.5" /></button>
      <span className="ml-auto text-[10px] text-zinc-500">{value.length}/{CALLOUT_MEDIA_LIMIT} · 8 MB each</span>
    </div>
    {picker && <div className="mx-2 mb-2 rounded-lg border border-white/10 bg-black/10 p-2.5">
      <div className="mb-2 flex items-center gap-2 rounded-md border border-white/10 bg-black/10 px-2"><Search className="size-3.5 text-zinc-500" /><input aria-label={key ? "Search GIPHY" : "Search GIF reactions"} value={query} maxLength={50} onChange={e => setQuery(e.target.value)} placeholder={key ? "Search GIPHY…" : "Search reactions: win, cheers, loss…"} className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none" />{searching && <Loader2 className="size-3 animate-spin text-zinc-400" />}</div>
      <div aria-label="GIF results" aria-busy={searching} className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain">
        {visibleResults.map(g => <button key={g.url} type="button" disabled={disabled || uploading || full} aria-label={`Add GIF: ${g.alt}`} onClick={() => { onChange([...value, { url: g.url, type: "gif", alt: g.alt }]); setPicker(false); }} className="aspect-square overflow-hidden rounded-md bg-white/5 transition hover:ring-2 hover:ring-[#d7ff00] focus-visible:ring-2 focus-visible:ring-white"><img src={g.url} alt={g.alt} loading="lazy" className="h-full w-full object-cover" /></button>)}
      </div>
      {!visibleResults.length && !searching && <p className="py-4 text-center text-xs text-zinc-500">No GIFs found. Try another word or upload your own.</p>}
      <a href="https://giphy.com" target="_blank" rel="noopener noreferrer" className="mt-2 block text-right text-[9px] font-semibold text-zinc-500">GIFs from GIPHY ↗</a>
    </div>}
    {uploading && <div className="flex items-center justify-between gap-2 px-3 pb-2"><p role="status" className="text-xs text-zinc-400">Uploading your image…</p><button type="button" onClick={() => { upload.current?.abort(); setUploading(false); onBusy(false); }} className="text-xs text-zinc-400 underline hover:text-white">Cancel</button></div>}
    {error && <p role="alert" className="px-3 pb-2 text-xs text-rose-400">{error}</p>}
  </div>;
}
