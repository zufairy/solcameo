"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, FileText, Loader2, X } from "lucide-react";
import { downloadAnalyticsPdf, type AnalyticsReportData } from "@/lib/client/analyticsPdf";

export function AnalyticsPdfExport({ data, disabled = false }: { data: AnalyticsReportData; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Content Performance Report");
  const [topPosts, setTopPosts] = useState(true);
  const [agentBreakdown, setAgentBreakdown] = useState(data.agentCount > 1);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && status !== "loading") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, status]);

  async function generate() {
    setStatus("loading");
    setError(null);
    try {
      await downloadAnalyticsPdf(data, { title: title.trim() || "Content Performance Report", includeTopPosts: topPosts, includeAgentBreakdown: agentBreakdown });
      setStatus("done");
      setTimeout(() => setStatus("idle"), 1800);
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "The report could not be generated.");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className="flex h-9 items-center gap-1.5 rounded-full bg-lime-300 px-3.5 text-[13px] font-semibold text-zinc-950 shadow-[0_8px_24px_-10px_rgba(190,242,100,.7)] transition hover:-translate-y-0.5 hover:bg-lime-200 disabled:pointer-events-none disabled:opacity-40">
        <Download className="size-3.5" /> PDF report
      </button>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget && status !== "loading") setOpen(false); }}>
            <motion.div role="dialog" aria-modal="true" aria-labelledby="pdf-report-title" initial={{ opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/12 bg-[#111315] shadow-[0_32px_100px_rgba(0,0,0,.65)]">
              <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_80%_0%,rgba(190,242,100,.16),transparent_58%)]" />
              <button type="button" aria-label="Close report options" onClick={() => setOpen(false)} disabled={status === "loading"} className="absolute right-5 top-5 z-10 grid size-8 place-items-center rounded-full border border-white/10 text-white/45 transition hover:bg-white/10 hover:text-white disabled:opacity-40"><X className="size-4" /></button>
              <div className="relative grid gap-6 p-6 sm:grid-cols-[.8fr_1.2fr] sm:p-8">
                <div className="hidden sm:block">
                  <div className="mx-auto aspect-[.707] max-w-[210px] overflow-hidden rounded-md border border-white/10 bg-[#090b0d] p-5 shadow-2xl">
                    <div className="flex items-center justify-between"><span className="text-[10px] font-black tracking-[.2em] text-white">VELLO</span><span className="text-[5px] font-bold tracking-widest text-lime-300">ANALYTICS</span></div>
                    <div className="mt-8 h-2 w-4/5 rounded bg-white/80" /><div className="mt-2 h-1 w-1/2 rounded bg-white/20" />
                    <div className="mt-6 grid grid-cols-2 gap-2">{[data.totalViews, data.videosGenerated, data.videosPosted, data.avgViewsPerPost].map((value, index) => <div key={index} className="rounded bg-white/[.06] p-2"><div className="h-1 w-9 rounded bg-white/15"/><div className={`mt-2 text-[9px] font-bold ${index === 0 ? "text-lime-300" : "text-white"}`}>{value.toLocaleString()}</div></div>)}</div>
                    <div className="mt-5 h-20 rounded bg-white/[.05] p-3"><svg viewBox="0 0 100 35" className="size-full"><path d="M0 30 C18 29 20 14 38 21 S63 7 75 14 S91 4 100 7" fill="none" stroke="#b7f34a" strokeWidth="2" /></svg></div>
                    <div className="mt-4 space-y-2">{[75, 55, 68].map((width) => <div key={width} className="h-1 rounded bg-white/10" style={{ width: `${width}%` }} />)}</div>
                  </div>
                  <p className="mt-3 text-center text-[10px] text-white/30">A4 executive snapshot</p>
                </div>

                <div>
                  <span className="grid size-10 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10 text-lime-300"><FileText className="size-5" /></span>
                  <h2 id="pdf-report-title" className="mt-4 text-xl font-semibold tracking-tight text-white">Export a polished report</h2>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-white/45">Ready to share with clients, partners, and your team.</p>

                  <label className="mt-6 block text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Report title</label>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={56} className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-[13px] text-white outline-none transition placeholder:text-white/20 focus:border-lime-300/40" />

                  <div className="mt-5 space-y-2">
                    <Option label="Include top content" checked={topPosts} onChange={setTopPosts} />
                    {data.agentCount > 1 && <Option label="Include agent breakdown" checked={agentBreakdown} onChange={setAgentBreakdown} />}
                  </div>

                  <div className="mt-5 rounded-xl border border-white/[.07] bg-white/[.035] px-3 py-2.5 text-[11px] text-white/40"><span className="font-medium text-white/65">{data.scopeLabel}</span><span className="mx-2 text-white/15">•</span>{data.periodLabel}</div>
                  {error && <p className="mt-3 text-[11.5px] text-rose-300">{error}</p>}
                  <button type="button" onClick={generate} disabled={status === "loading"} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime-300 text-[13px] font-bold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-wait">
                    {status === "loading" ? <><Loader2 className="size-4 animate-spin" /> Building report…</> : status === "done" ? <><Check className="size-4" /> Downloaded</> : <><Download className="size-4" /> Generate PDF</>}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Option({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2.5 text-left text-[12.5px] text-white/70 transition hover:bg-white/[.05]"><span>{label}</span><span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-lime-300" : "bg-white/10"}`}><motion.span className="absolute top-1 size-3 rounded-full bg-zinc-950" animate={{ left: checked ? 20 : 4 }} transition={{ type: "spring", stiffness: 500, damping: 32 }} /></span></button>;
}
