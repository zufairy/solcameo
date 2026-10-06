"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { browserXIntentFor, finalizePostText, X_POST_LIMIT, type ShareStats } from "@/lib/share/xShareCard";

type Draft = { text: string; stats: ShareStats; nonce: string };
type XStatus = "checking" | "connected" | "disconnected" | "unavailable" | "error";
const CONNECT_URL_CACHE_MS = 47 * 60 * 60_000;
const connectCacheKey = (mint: string) => `vello:upload-post-connect:v2:${mint}`;

function connectionReturnUrl(mint: string): string {
  const current = new URL(window.location.href);
  if (current.protocol === "https:" && current.hostname !== "localhost" && current.hostname !== "127.0.0.1") return current.href;
  return `https://velloagents.com/control?agent=${encodeURIComponent(mint)}`;
}

function cachedConnectUrl(mint: string): string | null {
  try {
    const raw = localStorage.getItem(connectCacheKey(mint));
    if (!raw) return null;
    const cached = JSON.parse(raw) as { url?: unknown; savedAt?: unknown };
    if (typeof cached.url !== "string" || typeof cached.savedAt !== "number" || Date.now() - cached.savedAt > CONNECT_URL_CACHE_MS) return null;
    return new URL(cached.url).protocol === "https:" ? cached.url : null;
  } catch { return null; }
}

function saveConnectUrl(mint: string, url: string) {
  try { localStorage.setItem(connectCacheKey(mint), JSON.stringify({ url, savedAt: Date.now() })); }
  catch { /* A blocked storage write must not block connecting. */ }
}

const CHIP = "rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white active:scale-[0.98] disabled:opacity-40";
const PRIMARY = "mt-2.5 w-full rounded-full bg-lime-300 px-4 py-2 text-[12px] font-bold text-[#0f1a06] shadow-[0_8px_24px_-8px_rgba(190,242,100,0.55),inset_0_1px_0_rgba(255,255,255,0.5)] transition hover:bg-lime-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY = "w-full rounded-full border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-[12px] font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/[0.09] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";
const LINK = "mt-2 inline-block text-[11px] font-semibold text-lime-200/80 underline underline-offset-2 hover:text-lime-100";

const PROGRESS_SEGMENTS = 28;

/** Pixel-segmented progress bar, matching the card's LED look. */
function ShareProgress({ value, label, compact }: { value: number; label: string; compact: boolean }) {
  const lit = Math.round((Math.min(100, value) / 100) * PROGRESS_SEGMENTS);
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label} className={compact ? "w-full" : "w-[min(78%,340px)]"}>
      <div className="mb-2 flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
        <span className="text-lime-200/85">{label}</span>
        <span className="tabular-nums text-white/55">{Math.round(value)}%</span>
      </div>
      <div className="flex gap-[3px]">
        {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
          <span key={i} className={`h-2 flex-1 transition-colors duration-200 ${i < lit ? (i === lit - 1 ? "bg-white" : "bg-lime-300") : "bg-white/10"}`} />
        ))}
      </div>
    </div>
  );
}

export function ShareOnX({ mint, name, compact = false, inline = false }: { mint: string; name: string; compact?: boolean; /** Sits in a row beside another button instead of filling its own line. */ inline?: boolean }) {
  const { getFreshToken } = useSupabaseAuth();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copy, setCopy] = useState("");
  const [xStatus, setXStatus] = useState<XStatus>("checking");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [awaitingConnection, setAwaitingConnection] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [gifState, setGifState] = useState<"idle" | "ready" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postPhase, setPostPhase] = useState<"idle" | "image" | "upload">("idle");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [browserShareNote, setBrowserShareNote] = useState("");
  const [browserShareUrl, setBrowserShareUrl] = useState("");
  const inFlight = useRef(false);

  // The still renders in well under a second, so it shows first; the animated
  // GIF (the one that gets shared) loads behind it and swaps in when ready.
  const stillPath = draft ? `/api/share/x-card?mint=${encodeURIComponent(mint)}&nonce=${encodeURIComponent(draft.nonce)}` : "";
  const gifPath = stillPath ? `${stillPath}&format=gif` : "";
  const cardPath = gifState === "failed" ? stillPath : gifPath;
  const previewPath = gifState === "ready" ? gifPath : stillPath;
  const cardExt = gifState === "failed" ? "png" : "gif";

  // Preload the GIF once the still is on screen.
  useEffect(() => {
    if (!open || !imageReady || !gifPath) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setGifState("ready"); };
    img.onerror = () => { if (!cancelled) setGifState("failed"); };
    img.src = gifPath;
    return () => { cancelled = true; img.onload = null; img.onerror = null; };
  }, [open, imageReady, gifPath]);

  // Honest-ish progress: each stage eases toward its own ceiling and only the
  // real completion (GIF loaded, or failed back to the still) reaches 100%.
  const progressStage = !open ? "idle" : !draft ? "draft" : !imageReady ? "still" : gifState === "ready" || gifState === "failed" ? "done" : "gif";
  useEffect(() => {
    if (progressStage === "idle" || progressStage === "done") return;
    const ceiling = progressStage === "draft" ? 30 : progressStage === "still" ? 62 : 95;
    const timer = window.setInterval(() => setProgress((p) => Math.min(ceiling, Math.max(p, p + (ceiling - p) * 0.07))), 120);
    return () => window.clearInterval(timer);
  }, [progressStage]);
  const shownProgress = progressStage === "done" ? 100 : progressStage === "idle" ? 0 : progress;
  const progressLabel = progressStage === "draft" ? "Pulling your agent's stats" : progressStage === "still" ? "Pixelating your top clips" : progressStage === "gif" ? "Animating the card" : "Ready";

  const checkConnection = useCallback(async () => {
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Sign in to check your X connection.");
      const response = await fetch(`/api/social/status?username=${encodeURIComponent(mint)}`, { headers: { Authorization: `Bearer ${token}` } });
      const status = await response.json() as { ok?: boolean; configured?: boolean; connected?: Record<string, unknown>; error?: string };
      if (!response.ok || !status.ok) throw new Error(status.error || "Could not check your X connection.");
      if (status.configured === false) { setXStatus("unavailable"); setConnectionError("Social connections are not configured on this server yet."); return false; }
      const connected = Boolean(status.connected?.x || status.connected?.twitter);
      setXStatus(connected ? "connected" : "disconnected");
      if (connected) { setAwaitingConnection(false); setConnectionError(""); }
      return connected;
    } catch (cause) {
      setXStatus("error");
      setConnectionError(cause instanceof Error ? cause.message : "Could not check your X connection.");
      return false;
    }
  }, [getFreshToken, mint]);

  useEffect(() => {
    if (!open || !awaitingConnection) return;
    let checks = 0;
    const poll = () => {
      checks += 1;
      if (checks >= 30) { setAwaitingConnection(false); return; }
      void checkConnection();
    };
    const timer = window.setInterval(poll, 4000);
    window.addEventListener("focus", poll);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [open, awaitingConnection, checkConnection]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !posting) setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKey); };
  }, [open, posting]);

  async function prepare(nonce: string) {
    setLoading(true);
    setImageReady(false);
    setGifState("idle");
    setProgress(0);
    setDraft(null);
    setError("");
    setSuccess(false);
    setXStatus("checking");
    setConnectionError("");
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Sign in to share your agent.");
      const headers = { Authorization: `Bearer ${token}` };
      const [draftResponse] = await Promise.all([
        fetch("/api/share/x-draft", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ mint, nonce }) }),
        checkConnection(),
      ]);
      const prepared = await draftResponse.json();
      if (!draftResponse.ok || !prepared.ok) throw new Error(prepared.error || "Could not create the share card.");
      setDraft(prepared as Draft);
      setCopy(prepared.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the share card.");
    } finally {
      setLoading(false);
    }
  }

  function openShare() {
    setOpen(true);
    setBrowserShareNote("");
    setBrowserShareUrl("");
    void prepare(String(Date.now()));
  }

  async function shareFromBrowser() {
    if (!draft || !imageReady || !copy.trim()) return;
    setError("");
    setBrowserShareNote("");
    const intent = browserXIntentFor(copy, mint);
    // Reserve the tab within the click gesture; browsers block windows opened
    // after the image fetch or clipboard permission prompt completes.
    const composer = window.open("", "_blank");
    if (composer) {
      composer.document.title = "Preparing your X post";
      composer.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#f5faf4;color:#24523a;font:600 16px system-ui";
      composer.document.body.textContent = "Preparing your image for X...";
    }
    try {
      const response = await fetch(cardPath);
      if (!response.ok) throw new Error("Could not prepare the image for sharing.");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("The share image is not ready yet.");
      // Browsers can only put PNGs on the clipboard, which would freeze the
      // animated card — so a GIF is always downloaded for manual attaching.
      let copied = false;
      if (blob.type === "image/png" && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          copied = true;
        } catch { /* Browser denied image clipboard; download a file instead. */ }
      }
      if (!copied) {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-vello-membership.${blob.type === "image/gif" ? "gif" : "png"}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
      setBrowserShareNote(copied
        ? "X is open with your post text. Paste the copied image into the composer, then publish from your browser account."
        : "X is open with your post text. Attach the downloaded GIF, then publish from your browser account.");
      setBrowserShareUrl(intent);
      if (composer && !composer.closed) composer.location.href = intent;
      else window.open(intent, "_blank", "noopener,noreferrer");
    } catch (cause) {
      composer?.close();
      setError(cause instanceof Error ? cause.message : "Could not open the X composer.");
    }
  }

  async function connectX() {
    if (connectBusy) return;
    setConnectBusy(true);
    setConnectionError("");
    setConnectUrl(null);
    // Open synchronously from the user's click. An async window.open is blocked
    // by Safari and Chrome after the hosted link request resolves.
    const popup = window.open("", `vello-connect-x-${mint}`, "width=560,height=780");
    if (popup) {
      try {
        popup.document.title = "Connecting X to Vello";
        popup.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#10150e;color:#c9e7ad;font:16px system-ui";
        popup.document.body.textContent = "Opening secure X connection...";
        popup.opener = null;
      } catch { /* Reused cross-origin window; redirecting it still works. */ }
    }
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Sign in to connect X.");
      const response = await fetch("/api/social/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // Upload-Post rejects localhost as an OAuth return URL. Use the public
        // control page during local preview, then keep the current HTTPS page
        // in production so the owner returns to this agent.
        body: JSON.stringify({ username: mint, redirectUrl: connectionReturnUrl(mint) }),
      });
      const result = await response.json() as { ok?: boolean; url?: string; error?: string; rateLimited?: boolean; retryAfterSeconds?: number; limitReached?: boolean; code?: string };
      const url = result.ok && result.url ? result.url : result.rateLimited ? cachedConnectUrl(mint) : null;
      if (!url) {
        const wait = result.rateLimited ? ` Try again in about ${result.retryAfterSeconds ?? 30} seconds.` : "";
        const detail = result.code === "siws_required" ? "Sign in with your wallet, then retry connecting X." : result.limitReached ? "The social account limit has been reached. Add capacity in Upload-Post to connect this agent." : result.error || "Could not open the X connection.";
        throw new Error(`${detail}${wait}`);
      }
      if (new URL(url).protocol !== "https:") throw new Error("The connect service returned an invalid URL.");
      saveConnectUrl(mint, url);
      setConnectUrl(url);
      setAwaitingConnection(true);
      if (popup && !popup.closed) popup.location.href = url;
    } catch (cause) {
      popup?.close();
      setConnectionError(cause instanceof Error ? cause.message : "Could not connect X.");
    } finally {
      setConnectBusy(false);
    }
  }

  async function publish() {
    if (!draft || !imageReady || xStatus !== "connected" || inFlight.current) return;
    inFlight.current = true;
    setPosting(true);
    setPostPhase("image");
    setError("");
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Sign in again before posting.");
      const text = finalizePostText(copy, mint);
      if (!text.trim() || text.length > X_POST_LIMIT) throw new Error("Keep the post under 280 characters.");
      // Upload-Post runs outside this browser and cannot fetch localhost. Put
      // the exact variant on public R2 first, then publish that stable URL.
      const mediaResponse = await fetch("/api/share/x-media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mint, nonce: draft.nonce }),
      });
      const media = await mediaResponse.json().catch(() => ({})) as { ok?: boolean; url?: string; error?: string };
      if (!mediaResponse.ok || !media.ok || !media.url) throw new Error(media.error || "Could not host the share image for X.");
      setPostPhase("upload");
      const response = await fetch("/api/social/post", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: mint, platforms: ["x"], type: "photo", title: text, description: text, captionLocked: true, mediaUrls: [media.url] }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.posted?.includes("x")) {
        throw new Error(result.error || "X did not confirm the post. Check your connection and try again.");
      }
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post to X.");
    } finally {
      inFlight.current = false;
      setPosting(false);
      setPostPhase("idle");
    }
  }

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={openShare}
        className={`group inline-flex items-center justify-center gap-2 rounded-[10px] border border-white/25 bg-white/[0.12] font-semibold text-white backdrop-blur-xl transition-[background-color,border-color,transform] duration-300 hover:border-white/45 hover:bg-white/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_-8px_rgba(0,0,0,0.6)] ${compact ? "h-8 px-3 text-[11px]" : inline ? "h-10 min-w-0 flex-1 px-3 text-[13px]" : "mt-4 h-10 w-full text-[13px]"}`}
      >
        <svg viewBox="0 0 24 24" className={`fill-current transition-transform duration-300 group-hover:scale-110 ${compact ? "size-3" : "size-3.5"}`} aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        Share on X
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-2xl backdrop-saturate-150 sm:p-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(event) => { if (event.target === event.currentTarget && !posting) setOpen(false); }}
          >
            <motion.div
              role="dialog" aria-modal="true" aria-label={`Share ${name} on X`}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="relative my-auto w-full max-w-[880px] overflow-hidden rounded-[22px] border border-white/[0.09] bg-[linear-gradient(160deg,rgba(28,32,27,0.82),rgba(12,14,12,0.9))] font-sans text-white shadow-[0_40px_120px_-20px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl"
            >
              {/* soft lime bloom behind the header */}
              <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[70%] -translate-x-1/2 rounded-full bg-lime-300/[0.07] blur-3xl" />

              <div className="relative flex items-center justify-between gap-4 px-4 pt-4 sm:px-5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80">
                    <span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,242,100,0.8)]" />
                    Agent milestone
                  </p>
                  <h2 className="mt-1 truncate text-[17px] font-semibold tracking-[-0.02em] text-white sm:text-[19px]">Make some noise for {name}</h2>
                </div>
                <button type="button" onClick={() => setOpen(false)} disabled={posting} aria-label="Close share preview" className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-[17px] leading-none text-white/60 transition hover:bg-white/[0.1] hover:text-white active:scale-95 disabled:opacity-40">×</button>
              </div>

              <div className="relative grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_268px]">
                <div className="min-w-0">
                  <div className="relative aspect-[1200/675] overflow-hidden rounded-[14px] bg-[#0b0d0b] ring-1 ring-white/[0.08] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)]">
                    {draft ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={stillPath} src={previewPath} alt={`${name} share card showing ${draft.stats.views.toLocaleString()} views and recent clips`} className="size-full object-cover" onLoad={() => setImageReady(true)} onError={() => { if (previewPath === stillPath) { setImageReady(false); setError("The share image could not render. Try another design."); } else setGifState("failed"); }} />
                    ) : <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,#121512,#1a1f19,#101310)]" aria-hidden />}
                    <AnimatePresence>
                      {shownProgress < 100 && !error && (
                        <motion.div
                          key="progress"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.25 } }}
                          className={imageReady
                            ? "pointer-events-none absolute inset-x-2.5 bottom-2.5 rounded-lg border border-white/10 bg-black/60 px-3 py-2 backdrop-blur-md"
                            : "pointer-events-none absolute inset-0 grid place-items-center"}
                        >
                          <ShareProgress value={shownProgress} label={progressLabel} compact={imageReady} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button type="button" disabled={loading || posting} onClick={() => void prepare(String(Date.now()))} className={CHIP}>New design</button>
                    {draft && imageReady && <a href={cardPath} download={`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-vello-card.${cardExt}`} className={CHIP}>{gifState === "ready" || gifState === "failed" ? "Download" : "Download (animating…)"}</a>}
                    {draft && <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">{draft.stats.views.toLocaleString()} views</span>}
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                  <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <div className="flex items-center justify-between">
                      <label htmlFor="x-share-copy" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Your post</label>
                      <span className="font-mono text-[10px] tabular-nums text-white/30">{copy.length}/{X_POST_LIMIT}</span>
                    </div>
                    <textarea id="x-share-copy" value={copy} onChange={(event) => setCopy(event.target.value)} disabled={!draft || posting} rows={5} maxLength={X_POST_LIMIT} className="mt-2 min-h-[118px] w-full resize-none rounded-[10px] border border-white/[0.07] bg-black/30 p-2.5 text-[12.5px] leading-relaxed text-white/90 outline-none placeholder:text-white/30 focus:border-lime-300/40 focus:ring-2 focus:ring-lime-300/10 disabled:opacity-50" placeholder="Preparing your post..." />
                  </div>

                  <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-3">
                    <p className="text-[12.5px] font-semibold text-white">Post as the agent</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/45">Publishes from the agent&apos;s connected X account.</p>
                    {xStatus === "connected"
                      ? <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={() => void publish()} disabled={loading || posting || success || !imageReady || !copy.trim()} className={PRIMARY}>{postPhase === "image" ? "Preparing public image..." : postPhase === "upload" ? "Posting from agent..." : success ? "Posted from agent" : "Post from agent X"}</motion.button>
                      : xStatus === "checking" ? <div className="mt-2.5 h-9 animate-pulse rounded-full bg-white/[0.06]" aria-label="Checking agent X connection" />
                      : xStatus === "unavailable" ? <p className="mt-2.5 text-[11px] text-amber-200/70">Social posting is not configured on this server.</p>
                      : <button type="button" disabled={connectBusy} onClick={() => void connectX()} className={PRIMARY}>{connectBusy ? "Preparing secure connection..." : awaitingConnection ? "Reopen connection" : "Connect agent X"}</button>}
                    {connectUrl && xStatus !== "connected" && <a href={connectUrl} target="_blank" rel="noopener noreferrer" className={LINK}>Connection window blocked? Open here</a>}
                    {awaitingConnection && <p role="status" className="mt-2 text-[11px] text-white/50">Waiting for X. We check automatically, or <button type="button" onClick={() => void checkConnection()} className="font-semibold text-lime-200 underline underline-offset-2">check now</button>.</p>}
                    {xStatus === "error" && <button type="button" onClick={() => void checkConnection()} className={`${LINK} block`}>Retry connection check</button>}
                    {connectionError && <p role="alert" className="mt-2 text-[11px] leading-relaxed text-amber-200/80">{connectionError}</p>}

                    <div className="my-3 h-px bg-white/[0.07]" />
                    <button type="button" onClick={() => void shareFromBrowser()} disabled={loading || !imageReady || !copy.trim()} className={SECONDARY}>Share from my own X</button>
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/35">Opens the composer; the GIF downloads for you to attach.</p>
                    {browserShareNote && <p role="status" className="mt-1.5 text-[11px] leading-relaxed text-lime-200/80">{browserShareNote}</p>}
                    {browserShareUrl && <a href={browserShareUrl} target="_blank" rel="noopener noreferrer" className={LINK}>Composer blocked? Open X here</a>}
                  </div>

                  {error && <p role="alert" className="rounded-[10px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>}
                  {success && <p role="status" className="rounded-[10px] border border-lime-300/25 bg-lime-300/10 px-3 py-2 text-[11px] text-lime-100">Posted from the agent&apos;s X account. Your milestone is live.</p>}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
