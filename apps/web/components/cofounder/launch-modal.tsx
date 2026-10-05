"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowRight, Loader2, Sparkles, X } from "lucide-react";
import { LoginModal } from "@/components/auth/login-modal";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

/**
 * Index-page "Paste your website" → Launch.
 *
 * Sequence (the activation ladder):
 *   1. Anonymous text-only PREVIEW (/api/launch/preview, ~10s): product
 *      summary, the agent's name, the winning hook. The visitor sees THEIR
 *      product understood before any sign-in wall — that's the sunk-cost
 *      moment the best paste-a-link tools use.
 *   2. Sign in (same LoginModal as the clip flow).
 *   3. POST /api/launch/start → /launch/<runId> where the agent mints and the
 *      first videos render live.
 * The wallet_required 409 (Privy still creating the embedded wallet on a
 * brand-new account) is retried a few times before surfacing.
 */
type Preview = { productSummary: string; agentName: string; handle: string; niche: string; hookText: string; concepts: { format: string; title: string }[] };

export function LaunchModal({ websiteUrl, sourceUrl, onClose }: { websiteUrl: string; sourceUrl?: string; onClose: () => void }) {
  const router = useRouter();
  const { authenticated, getFreshToken } = useSupabaseAuth();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [authOpen, setAuthOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // 1. Preview — fires on open, no auth. A failure here is informational
  //    (the launch can still start; the full analysis has screenshots too).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/launch/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl, ...(sourceUrl ? { sourceUrl } : {}) }),
      }).catch(() => null);
      const j = (await res?.json().catch(() => ({}))) as (Partial<Preview> & { ok?: boolean; error?: string }) | undefined;
      if (cancelled) return;
      if (res?.ok && j?.ok && j.agentName) {
        setPreview({ productSummary: j.productSummary ?? "", agentName: j.agentName, handle: j.handle ?? "", niche: j.niche ?? "", hookText: j.hookText ?? "", concepts: j.concepts ?? [] });
      } else {
        setPreviewError(j?.error ?? "Couldn't read that site.");
      }
    })();
    return () => { cancelled = true; };
  }, [websiteUrl, sourceUrl]);

  // 3. Once signed in, start immediately (the visitor already told us the URL).
  useEffect(() => {
    if (!authenticated || startedRef.current) return;
    startedRef.current = true;
    setAuthOpen(false);
    setStarting(true);
    void (async () => {
      let lastErr = "Could not start the launch.";
      for (let attempt = 0; attempt < 4; attempt++) {
        const token = await getFreshToken();
        const res = await fetch("/api/launch/start", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ websiteUrl, ...(sourceUrl ? { sourceUrl } : {}) }),
        }).catch(() => null);
        const j = (await res?.json().catch(() => ({}))) as { ok?: boolean; runId?: string; error?: string; code?: string } | undefined;
        if (res?.ok && j?.runId) {
          router.push(`/launch/${encodeURIComponent(j.runId)}`);
          return;
        }
        lastErr = j?.error ?? `HTTP ${res?.status ?? "network"}`;
        if (j?.code !== "wallet_required") break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      setError(lastErr);
      setStarting(false);
      startedRef.current = false;
    })();
  }, [authenticated, getFreshToken, router, websiteUrl, sourceUrl]);

  // ESC closes (unless the login modal is on top — it handles its own ESC).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !authOpen) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authOpen, onClose]);

  const host = (() => { try { return new URL(websiteUrl).hostname.replace(/^www\./, ""); } catch { return websiteUrl; } })();
  const previewLoading = !preview && !previewError;
  const busy = starting || (authenticated && !error);
  if (!mounted) return null;

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="launch-title"
        initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0b0b0d] p-6 text-left shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-2.5 text-white/50 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60">
          <X className="size-4" />
        </button>

        <p className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-white/40">{host}</p>
        <h2 id="launch-title" className="mt-1.5 text-[20px] font-semibold leading-tight text-white">
          {previewLoading ? "Reading your site…" : previewError ? "We'll read it after sign-in" : `Meet ${preview!.agentName}`}
        </h2>

        {/* Preview card: skeleton → summary + agent + hook */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {previewLoading ? (
              <motion.div key="sk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
                <div className="h-3 w-11/12 rounded bg-white/10 motion-safe:animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-white/10 motion-safe:animate-pulse" />
                <div className="mt-4 flex items-center gap-3">
                  <div className="size-9 rounded-full bg-white/10 motion-safe:animate-pulse" />
                  <div className="space-y-1.5"><div className="h-3 w-28 rounded bg-white/10 motion-safe:animate-pulse" /><div className="h-2.5 w-20 rounded bg-white/10 motion-safe:animate-pulse" /></div>
                </div>
              </motion.div>
            ) : previewError ? (
              <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2.5 text-[13px] text-white/70">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                <div>
                  <p>{previewError}</p>
                  <p className="mt-1 text-white/45">The full read (with screenshots) runs after you sign in. You can still launch.</p>
                </div>
              </motion.div>
            ) : (
              <motion.div key="ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <p className="text-[13.5px] leading-relaxed text-white/80">{preview!.productSummary}</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/20 to-white/5 text-white/80"><Sparkles className="size-4" aria-hidden /></div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-white">{preview!.agentName} <span className="font-normal text-white/40">@{preview!.handle}</span></p>
                    <p className="truncate text-[12px] text-white/45">Your AI creator · {preview!.niche}</p>
                  </div>
                </div>
                {preview!.hookText && (
                  <p className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2 text-[13px] italic text-white/75">
                    First hook: &ldquo;{preview!.hookText}&rdquo;
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ul className="mt-4 space-y-1.5 text-[12.5px] text-white/55">
          <li>3 videos in 3 formats{sourceUrl ? ", plus 3 clips from your long-form" : ""}.</li>
          <li>Your agent is minted and owned by you. Connect TikTok / Instagram / X after.</li>
        </ul>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-200">{error}</p>}

        <button type="button" onClick={() => { if (!authenticated) setAuthOpen(true); }} disabled={busy}
          className="group mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f6f4ec] px-5 py-3.5 text-[14.5px] font-semibold text-neutral-900 transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-70">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? "Starting your launch…" : preview ? `Render ${preview.agentName}'s first videos` : "Sign in to render my videos"}
          {!busy && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />}
        </button>
        <p className="mt-2.5 text-center text-[11.5px] text-white/35">Free. No card. Sign in with Google, takes 10 seconds.</p>
      </motion.div>
      <LoginModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </motion.div>,
    document.body,
  );
}
