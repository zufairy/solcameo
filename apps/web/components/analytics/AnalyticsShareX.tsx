"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, Loader2, Share2, X } from "lucide-react";
import type { AnalyticsReportData } from "@/lib/client/analyticsPdf";
import { canvasToPngBlob, draftAnalyticsPost, renderAnalyticsShareCard } from "@/lib/client/analyticsShareCard";

const ShareCard3D = dynamic(() => import("./ShareCard3D"), { ssr: false });

const XLogo = ({ className = "size-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`fill-current ${className}`} aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
);

/** "Share card" button + popup: live 3D preview of the stats card, editable post, X composer / download. */
export function AnalyticsShareX({ data, disabled = false }: { data: AnalyticsReportData; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState("");
  const [showChart, setShowChart] = useState(true);
  const [showTopAgent, setShowTopAgent] = useState(data.agentCount > 1);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [copy, setCopy] = useState("");
  const [busy, setBusy] = useState<"" | "x" | "download">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [burst, setBurst] = useState(0);

  useEffect(() => { if (open) { setCopy(draftAnalyticsPost(data)); setNote(""); setError(""); } }, [open, data]);

  // Re-render the card art (rounded, for the 3D plane) whenever inputs change.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    renderAnalyticsShareCard(data, { headline, showChart, showTopAgent, rounded: true })
      .then((c) => { if (alive) setPreview(c); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Could not draw the card."); });
    return () => { alive = false; };
  }, [open, data, headline, showChart, showTopAgent]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  async function exportBlob() {
    const full = await renderAnalyticsShareCard(data, { headline, showChart, showTopAgent, rounded: false });
    return canvasToPngBlob(full);
  }

  function saveBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "solcameo-analytics.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function download() {
    setBusy("download"); setError("");
    try { saveBlob(await exportBlob()); setNote("Saved. Attach it to your post."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the image."); }
    finally { setBusy(""); }
  }

  async function postToX() {
    setBusy("x"); setError(""); setNote("");
    // Reserve the tab inside the click gesture so the browser doesn't block it.
    const composer = window.open("", "_blank");
    try {
      const blob = await exportBlob();
      let copied = false;
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); copied = true; } catch { /* clipboard denied */ }
      }
      if (!copied) saveBlob(blob);
      const intent = `https://x.com/intent/post?text=${encodeURIComponent(copy.slice(0, 280))}`;
      if (composer && !composer.closed) composer.location.href = intent; else window.open(intent, "_blank", "noopener,noreferrer");
      setNote(copied ? "X is open. Paste the copied card into your post (Cmd/Ctrl+V)." : "X is open. Attach the downloaded card to your post.");
      setBurst((n) => n + 1);
    } catch (e) {
      composer?.close();
      setError(e instanceof Error ? e.message : "Could not open X.");
    } finally { setBusy(""); }
  }

  const over = copy.length > 280;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled}
        className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_-10px_rgba(255,255,255,0.35)] transition hover:-translate-y-0.5 hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40">
        <Share2 className="size-3.5" /> Share card
      </button>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/75 p-3 backdrop-blur-xl sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
            <motion.div role="dialog" aria-modal="true" aria-label="Share your analytics on X" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="glass3d relative my-auto w-full max-w-[1080px] overflow-hidden rounded-3xl text-white shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]">
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full border border-white/10 text-white/50 transition hover:bg-white/10 hover:text-white"><X className="size-4" /></button>

              <div className="grid lg:grid-cols-[1.45fr_1fr]">
                <div className="relative min-h-[300px] border-b border-white/[0.06] bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,255,255,0.06),transparent_65%)] lg:border-b-0 lg:border-r">
                  <ShareCard3D canvas={preview} burst={burst} className="aspect-[16/10] w-full" />
                  {!preview && <div className="absolute inset-0 grid place-items-center"><Loader2 className="size-5 animate-spin text-white/40" /></div>}
                  <p className="pb-4 text-center text-[11px] text-white/30">Move your cursor over the card</p>
                </div>

                <div className="flex flex-col gap-4 p-5 sm:p-6">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Share</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight">Show off your stats</h2>
                    <p className="mt-1 text-[12px] text-white/45">{data.scopeLabel} · {data.periodLabel}</p>
                  </div>

                  <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Card label
                    <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} placeholder={data.scopeLabel}
                      className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] normal-case tracking-normal text-white outline-none transition placeholder:text-white/25 focus:border-white/30" />
                  </label>

                  <div className="space-y-1.5">
                    <Toggle label="Views chart" on={showChart} set={setShowChart} />
                    {data.agentCount > 1 && <Toggle label="Top agent" on={showTopAgent} set={setShowTopAgent} />}
                  </div>

                  <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Post text
                    <textarea value={copy} onChange={(e) => setCopy(e.target.value)} rows={5}
                      className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-[13px] normal-case leading-relaxed tracking-normal text-white outline-none transition focus:border-white/30" />
                    <span className={`mt-1 block text-right text-[11px] normal-case tracking-normal tabular-nums ${over ? "text-rose-300" : "text-white/35"}`}>{copy.length}/280</span>
                  </label>

                  {error && <p role="alert" className="text-[12px] text-rose-300">{error}</p>}
                  {note && <p role="status" className="flex items-start gap-1.5 text-[12px] text-emerald-300"><Check className="mt-0.5 size-3.5 shrink-0" />{note}</p>}

                  <div className="mt-auto grid gap-2">
                    <button type="button" onClick={postToX} disabled={!!busy || over || !copy.trim() || !preview}
                      className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-bold text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:bg-zinc-100 disabled:opacity-40">
                      {busy === "x" ? <Loader2 className="size-4 animate-spin" /> : <XLogo />} Post to X
                    </button>
                    <button type="button" onClick={download} disabled={!!busy || !preview}
                      className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] text-[13px] font-semibold text-white/85 transition hover:bg-white/[0.09] disabled:opacity-40">
                      {busy === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download PNG
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => set(!on)}
      className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-left text-[12.5px] text-white/75 transition hover:bg-white/[0.06]">
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-white" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full transition-all ${on ? "left-[18px] bg-zinc-950" : "left-0.5 bg-zinc-400"}`} />
      </span>
    </button>
  );
}
