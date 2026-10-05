"use client";

import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "convex/react";
import { X, Sparkles, Loader2, Link2, Wand2, ImagePlus, Wallet, AlertCircle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useWalletUsdc, sendUsdc } from "@/lib/client/usdcClient";
import MintCelebration from "@/components/builder/MintCelebration";
import { getVideoEngine, videoCreditsForLength, type VideoEngineId } from "@/lib/builder/agentTypes";
import {
  hireAgent,
  addGeneration,
  updateGeneration,
  type Generation,
} from "@/lib/client/hireStore";

const ME = {
  // Neutral surfaces via CSS vars → flips with the theme (see globals.css).
  bg: "var(--me-bg)",
  panel: "var(--me-panel)",
  card: "var(--me-card)",
  border: "var(--me-border)",
  borderLit: "var(--me-border-lit)",
  text: "var(--me-text)",
  sub: "var(--me-sub)",
  accent: "#ec4899",
  green: "#34d399",
};

const DEFAULT_COST = 1; // USDC — fallback when the agent hasn't set a per-video price

const EASE = [0.16, 1, 0.3, 1] as const;

export type HireAgentLite = {
  mint: string;
  name: string;
  avatarUrl: string;
  niche: string;
  agentType: string;
};

export default function HireGenerateModal({
  agent,
  onClose,
}: {
  agent: HireAgentLite;
  onClose: () => void;
}) {
  const [productUrl, setProductUrl] = useState("");
  // App mode: when on, the server headlessly screenshots the URL and uses those
  // captures as the product references — for businesses promoting a mobile/web
  // app that have no product photos to upload. Off = normal web-page scrape.
  const [appMode, setAppMode] = useState(false);
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<{ preview: string; url?: string; uploading: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Signature of a broadcast-but-unconfirmed payment. On retry we pass it to
  // sendUsdc, which checks the ledger and returns it (no second transfer) if it
  // actually landed — the double-pay guard for a confirmation timeout.
  const pendingPaySigRef = useRef<string | undefined>(undefined);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [mounted, setMounted] = useState(false);

  const uploading = images.some((im) => im.uploading);

  // Read a File as a base64 data URL.
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Upload reference photos to the PUBLIC Supabase bucket (via /api/upload-ref →
  // hostBase64ForKie). This yields a Kie-safe public `.png` URL that nano-banana-pro's
  // `image_input` accepts — Convex storage URLs are extensionless and get rejected
  // ("image not found"), which is the bug this fixes.
  async function handleFiles(fileList: FileList) {
    const room = 3 - images.length;
    const picked = Array.from(fileList).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    for (const file of picked) {
      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { preview, uploading: true }]);
      try {
        const base64 = await fileToBase64(file);
        const r = await fetch("/api/upload-ref", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64 }),
        });
        const { url } = (await r.json()) as { url?: string };
        setImages((prev) => prev.map((im) => im.preview === preview ? { ...im, url: url ?? undefined, uploading: false } : im));
      } catch {
        setImages((prev) => prev.map((im) => im.preview === preview ? { ...im, uploading: false } : im));
      }
    }
  }

  function removeImage(i: number) {
    setImages((prev) => {
      const t = prev[i];
      if (t) URL.revokeObjectURL(t.preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  // Privy-aware wallet: a Google login uses an embedded Privy wallet that never
  // shows up in wallet-adapter, so the legacy useWallet() left `connected` false
  // and the button stuck on "Connect wallet" even after login. The unified hook
  // resolves the active Privy/external wallet + a matching signer.
  const { connected, publicKey, signTransaction } = useUnifiedSolanaWallet();
  // Sign-In-With-Solana: the hire-generate route binds the on-chain payment to the
  // caller's SIWS-proven wallet, so we establish a session (one signature) BEFORE
  // paying — the same wallet that pays.
  const { ensureSiwsSession } = useSiwsSession();
  const { promptLogin } = useSupabaseAuth();
  const { usdc, refresh } = useWalletUsdc();

  // Per-agent price (USDC) + payout wallet from the "Charge Per Video" skill config.
  const doc = useQuery(api.influencers.getByMint, agent.mint ? { mintAddress: agent.mint } : "skip") as
    | {
        monetization?: { costPerVideo?: number; requirementPrompt?: string };
        agentWallet?: string;
        creatorWallet?: string;
        videoEngine?: string;
        videoConfig?: { minSeconds?: number; maxSeconds?: number };
      }
    | null
    | undefined;
  const GEN_COST = doc?.monetization?.costPerVideo && doc.monetization.costPerVideo > 0
    ? doc.monetization.costPerVideo
    : DEFAULT_COST;
  const payoutWallet = doc?.agentWallet || doc?.creatorWallet || "";

  // What the buyer is getting: which engine renders the video + its length range.
  const engine = getVideoEngine(doc?.videoEngine as VideoEngineId | undefined);
  const minS = doc?.videoConfig?.minSeconds ?? 16;
  const maxS = doc?.videoConfig?.maxSeconds ?? 32;
  const lengthLabel = minS === maxS ? `${minS}s` : `${minS}–${maxS}s`;
  const renderEstimateCredits = videoCreditsForLength(engine, Math.round((minS + maxS) / 2));

  // Portal target only exists on the client.
  useEffect(() => { setMounted(true); }, []);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // The celebration (confetti + chime) plays on a successful hire, then gracefully
  // blurs out after 3s — leaving the "Video Generating" panel behind it.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(false), 3000);
    return () => clearTimeout(t);
  }, [celebrate]);

  const canAfford = usdc != null && usdc >= GEN_COST;
  // The active Privy/linked wallet address (same one the payment spends from), so
  // the header shows exactly which wallet is connected — never a stale adapter one.
  const walletAddr = publicKey?.toBase58() ?? "";
  const walletShort = walletAddr ? `${walletAddr.slice(0, 4)}…${walletAddr.slice(-4)}` : "";

  const uploadedUrls = images.map((im) => im.url).filter((u): u is string => !!u);

  async function handleGenerate() {
    setError("");
    if (!productUrl.trim() && !description.trim() && uploadedUrls.length === 0) {
      setError("Add an instruction, a product image, or a URL.");
      return;
    }
    if (uploading) {
      setError("Wait for the images to finish uploading.");
      return;
    }
    if (!publicKey || !signTransaction) {
      promptLogin(); // open Privy login — wallet-adapter modal won't connect a Privy wallet
      return;
    }
    if (!payoutWallet) {
      setError("This agent has no payout wallet yet.");
      return;
    }
    if (usdc != null && usdc < GEN_COST) {
      setError(`Insufficient USDC. You have $${usdc.toFixed(2)}, this costs $${GEN_COST}.`);
      return;
    }

    setBusy(true);

    // 0) Establish a SIWS session up-front (signs only if one isn't already valid).
    //    hire-generate verifies THIS wallet funded the on-chain payment against its
    //    SIWS-proven identity, so signing here — before paying — keeps it to a single
    //    prompt and avoids a signature popup after the celebration. Bail (no payment)
    //    if the user can't/won't sign.
    try {
      const siws = await ensureSiwsSession();
      if (!siws) {
        setError("Sign in with your wallet to hire this agent.");
        setBusy(false);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet sign-in failed. Please try again.");
      setBusy(false);
      return;
    }

    // 1) Pay the agent on-chain in USDC (built on the app's configured network).
    //    priorSignature carries a prior timed-out attempt so sendUsdc can verify it
    //    landed instead of double-paying.
    const pay = await sendUsdc({
      publicKey,
      signTransaction,
      toPubkey: payoutWallet,
      amountUsdc: GEN_COST,
      priorSignature: pendingPaySigRef.current,
    });
    if (!pay.ok) {
      if (pay.unconfirmed) {
        // Broadcast but unconfirmed — remember the signature so the next click
        // re-checks the ledger (no second transfer) rather than paying again.
        pendingPaySigRef.current = pay.signature;
        setError(`${pay.error} Click Generate again to check.`);
      } else {
        // A definite failure (never landed / rejected) — safe to start fresh.
        pendingPaySigRef.current = undefined;
        setError(pay.error);
      }
      setBusy(false);
      return;
    }
    // Paid + confirmed. RETAIN the signature until the render actually STARTS, so a
    // transient render-kickoff failure can retry the SAME payment — sendUsdc detects
    // the already-landed sig and returns it WITHOUT charging again (never re-pay,
    // BUG-025b). Cleared only once a taskId comes back (render committed).
    pendingPaySigRef.current = pay.signature;
    refresh();

    // Record the agent as hired now that payment cleared.
    hireAgent({
      mint: agent.mint,
      name: agent.name,
      avatarUrl: agent.avatarUrl,
      niche: agent.niche,
      agentType: agent.agentType,
      hiredAt: Date.now(),
    });

    // Optimistic "generating" record so it shows up live on the Generations page.
    const id = `gen_${agent.mint}_${Date.now()}`;
    const base: Generation = {
      id,
      mint: agent.mint,
      agentName: agent.name,
      agentAvatar: agent.avatarUrl,
      productUrl: productUrl.trim(),
      description: description.trim(),
      type: "video",
      mediaUrl: "",
      posterUrl: uploadedUrls[0],
      cost: GEN_COST,
      status: "generating",
      createdAt: Date.now(),
    };
    addGeneration(base);

    // INSTANT: payment cleared, so flip straight to the "generating" celebration
    // (same burst + chime as the builder's mint) and stop the button spinner. We do
    // NOT block the UI on the render kickoff — KIE scraping/storyboard can take many
    // seconds; the render runs in the background and the Generations page polls it.
    setCelebrate(true);
    setDoneId(id);
    setBusy(false);

    // 2) Kick off the persona-driven render in the background. Retry the SAME
    //    signature a few times on a transient failure — the server verifies the
    //    already-landed payment and, on a render-dispatch failure, RELEASES the sig
    //    so the retry re-consumes it (never a second charge, BUG-025b). Clear the
    //    retained sig only once the render actually starts (taskId) or the server
    //    reports it already started (sig consumed for a live render).
    const renderBody = {
      mint: agent.mint,
      productUrl: productUrl.trim(),
      description: description.trim(),
      productImages: uploadedUrls,
      appMode,
      txSignature: pay.signature,
    };
    void (async () => {
      let lastErr = "Could not start the render";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
        try {
          const res = await fetch("/api/agents/hire-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(renderBody),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; taskId?: string; error?: string };
          if (res.ok && data.ok && data.taskId) {
            // Render runs async — store the taskId; the Generations page polls it.
            updateGeneration(id, { taskId: data.taskId });
            pendingPaySigRef.current = undefined; // render started — safe to clear
            return;
          }
          // The server already consumed this sig for a render that started (an
          // earlier attempt's response was lost): the video IS being made — treat
          // as success so we neither re-pay nor show a false failure.
          if (/already used for a render/i.test(data.error ?? "")) {
            pendingPaySigRef.current = undefined;
            return;
          }
          lastErr = data.error ?? `HTTP ${res.status}`;
        } catch (e) {
          lastErr = (e as Error).message;
        }
      }
      // Exhausted retries — KEEP the retained signature so the user can finish the
      // render by clicking Generate again; sendUsdc reuses it and never charges
      // twice (BUG-025b).
      updateGeneration(id, { status: "failed", error: `Paid — tap Generate to finish. You won't be charged again. (${lastErr})` });
    })();
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Premium loader + animated dots — gated for reduced motion. */}
      <style>{`
        .hire-loader {
          width: 52px; height: 52px; border-radius: 9999px;
          background: conic-gradient(from 0deg, transparent 0%, ${ME.accent} 92%, ${ME.accent} 100%);
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px));
          filter: drop-shadow(0 0 10px ${ME.accent}66);
        }
        .hire-dots::after { content: ""; }
        @media (prefers-reduced-motion: no-preference) {
          .hire-loader { animation: hire-spin 0.85s linear infinite; }
          .hire-dots::after { animation: hire-dots 1.4s steps(1,end) infinite; }
        }
        @keyframes hire-spin { to { transform: rotate(360deg); } }
        @keyframes hire-dots { 0%{content:"";} 25%{content:".";} 50%{content:"..";} 75%,100%{content:"...";} }
      `}</style>

      {/* Same celebratory burst + chime as the builder's mint notification. */}
      <MintCelebration active={celebrate} label="VIDEO GENERATING ✦" />

    <AnimatePresence>
      <motion.div
        key="hire-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="fixed inset-0 z-[70] grid place-items-center px-4"
        onClick={onClose}
      >
        {/* backdrop */}
        <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />

        {/* card — two columns: agent image on the left, form on the right */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.4, ease: EASE }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-3xl shadow-2xl"
          style={{ background: ME.panel, border: `1px solid ${ME.borderLit}` }}
        >
          {/* close */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3.5 top-3.5 z-20 grid size-8 place-items-center rounded-full bg-black/30 text-white/75 ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/55 hover:text-white"
          >
            <X className="size-4" />
          </button>

          {/* ── LEFT: big agent profile image ── */}
          <div className="relative hidden w-[42%] shrink-0 md:block" style={{ background: ME.bg }}>
            <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mint} className="absolute inset-0 size-full object-cover object-top" initialClassName="text-7xl" />
            {/* legibility + blend into the panel */}
            <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(7,9,12,0.10) 0%, rgba(7,9,12,0.12) 42%, rgba(7,9,12,0.94) 100%)" }} />
            <div aria-hidden className="absolute inset-y-0 right-0 w-20" style={{ background: `linear-gradient(90deg, transparent, ${ME.panel})` }} />

            {/* type badge — top */}
            <span className="absolute left-4 top-4 inline-flex items-center rounded-full bg-black/45 px-3 py-1 text-[10px] font-bold uppercase tracking-wide capitalize text-white ring-1 ring-white/15 backdrop-blur-md">
              {String(agent.agentType ?? "").replace("AI ", "") || "Agent"} Agent
            </span>

            {/* identity overlay — bottom */}
            <div className="absolute inset-x-0 bottom-0 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: ME.accent }}>Hire &amp; Generate</p>
              <p className="mt-1 text-[24px] font-extrabold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">{agent.name}</p>
              <p className="text-[12px] capitalize text-white/60">{agent.niche}</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15 backdrop-blur-md">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/55">Per video</span>
                <span className="text-[16px] font-extrabold tabular-nums text-white">${GEN_COST}</span>
                <span className="text-[10px] font-bold text-white/55">USDC</span>
              </div>
            </div>
          </div>

          {/* ── RIGHT: form ── */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            {/* glow */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28" style={{ background: `radial-gradient(90% 100% at 70% 0%, ${ME.accent}1f, transparent 70%)` }} />

            {/* header */}
            <div className="relative flex shrink-0 items-center gap-3 border-b px-5 py-4" style={{ borderColor: ME.border }}>
              {/* mobile identity (image column hidden < md) */}
              <AgentAvatar url={agent.avatarUrl} name={agent.name} seed={agent.mint} className="size-10 rounded-xl object-cover ring-1 ring-white/10 md:hidden" initialClassName="text-sm" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ME.accent }}>Hire &amp; Generate</p>
                <p className="truncate text-[15px] font-bold md:hidden" style={{ color: ME.text }}>{agent.name}</p>
                <p className="hidden truncate text-[13px] md:block" style={{ color: ME.sub }}>Commission a video from {agent.name}</p>
              </div>
              {/* Connected wallet (Privy/linked) + its USDC balance */}
              <div className="ml-auto shrink-0 rounded-lg px-2.5 py-1.5 text-right" style={{ background: ME.card, border: `1px solid ${ME.border}` }}>
                <p className="flex items-center justify-end gap-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: ME.sub }}>
                  <Wallet className="size-2.5" aria-hidden />
                  {connected ? walletShort : "Not connected"}
                </p>
                <p className="text-[14px] font-bold tabular-nums" style={{ color: !connected ? ME.sub : canAfford ? ME.green : ME.accent }}>
                  {!connected ? "—" : usdc == null ? "···" : `$${usdc.toFixed(2)} USDC`}
                </p>
              </div>
            </div>

            {/* body (scrolls) */}
            <div className="relative min-h-0 flex-1 overflow-y-auto p-5">

            {doneId ? (
              /* ── success / generating state ── */
              <div className="mt-6 flex flex-col items-center gap-3 text-center">
                {/* Premium dual-ring loader (built in CSS — no external asset) */}
                <span className="hire-loader" role="status" aria-label="Video generating" />
                <p className="text-[16px] font-extrabold tracking-tight" style={{ color: ME.text }}>
                  Video Generating<span className="hire-dots" aria-hidden />
                </p>
                <p className="text-[12px]" style={{ color: ME.sub }}>
                  {agent.name} is producing your video (~2–5 min). Track it live under <span style={{ color: ME.text }}>Generations</span>.
                </p>
                <div className="mt-2 flex w-full gap-2">
                  <a
                    href="/generations"
                    className="flex-1 rounded-xl py-2.5 text-center text-[13px] font-bold transition-all hover:brightness-110"
                    style={{ background: ME.accent, color: "#fff" }}
                  >
                    View Generations
                  </a>
                  <button
                    type="button"
                    onClick={() => { setDoneId(null); setProductUrl(""); setDescription(""); setImages([]); }}
                    className="flex-1 rounded-xl py-2.5 text-[13px] font-bold transition-colors"
                    style={{ background: ME.card, border: `1px solid ${ME.border}`, color: ME.text }}
                  >
                    Generate Another
                  </button>
                </div>
              </div>
            ) : (
              /* ── form state ── */
              <>
                <div className="mt-5 space-y-3.5">
                  {/* Product images — up to 3 square slots, uploaded to storage */}
                  <div>
                    <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: ME.sub }}>
                      <ImagePlus className="size-3.5" /> Product images
                      <span className="font-normal text-white/35">· up to 3 · used as references</span>
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {images.map((im, i) => (
                        <div key={im.preview} className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-white/10" style={{ background: ME.card }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.preview} alt={`Product ${i + 1}`} className="size-full object-cover" />
                          {im.uploading && (
                            <div className="absolute inset-0 grid place-items-center bg-black/55">
                              <Loader2 className="size-5 animate-spin text-white/80" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => removeImage(i)}
                            aria-label="Remove image"
                            className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/65 text-white/90 ring-1 ring-white/20 transition-colors hover:bg-black/85"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                      {images.length < 3 && (
                        <label
                          className="grid aspect-square cursor-pointer place-items-center rounded-xl border border-dashed transition-colors hover:border-white/30"
                          style={{ borderColor: ME.borderLit, background: ME.card }}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }}
                          />
                          <div className="flex flex-col items-center gap-1 text-white/40">
                            <ImagePlus className="size-5" />
                            <span className="text-[10px] font-medium">Add</span>
                          </div>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Product URL — with an App/Web toggle. In App mode the server
                      auto-screenshots the URL and uses those captures as references. */}
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: ME.sub }}>
                      <Link2 className="size-3.5" /> Product URL
                      {/* iOS-style switch — Web (off) / App (on) */}
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-[11px] font-semibold" style={{ color: appMode ? ME.sub : ME.text }}>Web</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={appMode}
                          aria-label="Toggle App mode — auto-screenshot the URL"
                          onClick={() => setAppMode((v) => !v)}
                          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2"
                          style={{ background: appMode ? ME.accent : ME.borderLit }}
                        >
                          <span
                            className="inline-block size-4 rounded-full bg-white shadow-sm transition-transform"
                            style={{ transform: appMode ? "translateX(18px)" : "translateX(2px)" }}
                          />
                        </button>
                        <span className="text-[11px] font-semibold" style={{ color: appMode ? ME.text : ME.sub }}>App</span>
                      </span>
                    </span>
                    <input
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      value={productUrl}
                      onChange={(e) => setProductUrl(e.target.value)}
                      placeholder={appMode ? "https://apps.apple.com/… or your app's site" : "https://yourstore.com/product"}
                      className="w-full rounded-xl px-3.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-white/25 focus:ring-2"
                      style={{ background: ME.card, border: `1px solid ${ME.border}`, color: ME.text }}
                    />
                    {appMode && (
                      <span className="mt-1.5 block text-[11px]" style={{ color: ME.sub }}>
                        We&apos;ll auto-screenshot this app/site and use the captures as references in your video.
                      </span>
                    )}
                  </label>

                  {/* Instruction — the creative brief the agent makes the video from */}
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: ME.sub }}>
                      <Wand2 className="size-3.5" /> Instruction
                      <span className="font-normal text-white/35">· tell {agent.name} what video to make</span>
                    </span>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      placeholder={`e.g. "Make a punchy 20s review hyping this product to my audience — show it in use, end with a strong CTA." ${agent.name} writes & films it in their own persona.`}
                      className="w-full resize-none rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-white/25 focus:ring-2"
                      style={{ background: ME.card, border: `1px solid ${ME.border}`, color: ME.text }}
                    />
                  </label>
                </div>

                {/* what you get — engine + length spec */}
                <div
                  className="mt-4 grid grid-cols-2 gap-2 rounded-xl p-2.5"
                  style={{ background: ME.card, border: `1px solid ${ME.border}` }}
                >
                  <div className="flex flex-col gap-0.5 px-1">
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: ME.sub }}>Engine</span>
                    <span className="truncate text-[13px] font-bold" style={{ color: ME.text }}>{engine.label}</span>
                    <span className="font-mono text-[10px]" style={{ color: ME.sub }}>{Math.round(engine.pricePerMaxClipUsdc * 100)} credits / {engine.maxClipSeconds}s</span>
                  </div>
                  <div className="flex flex-col gap-0.5 border-l px-3" style={{ borderColor: ME.border }}>
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: ME.sub }}>Length</span>
                    <span className="text-[13px] font-bold tabular-nums" style={{ color: ME.text }}>{lengthLabel}</span>
                    <span className="font-mono text-[10px]" style={{ color: ME.sub }}>≈ {renderEstimateCredits.toLocaleString()} render credits</span>
                  </div>
                </div>

                {/* cost + error */}
                <div className="mt-3 flex items-center justify-between text-[12px]">
                  <span style={{ color: ME.sub }}>Pay {agent.name}</span>
                  <span className="font-bold tabular-nums" style={{ color: ME.text }}>${GEN_COST} USDC</span>
                </div>
                {connected && !canAfford && usdc != null && (
                  <p className="mt-2 text-[11.5px]" style={{ color: ME.accent }}>
                    Not enough USDC — you have ${usdc.toFixed(2)}.
                  </p>
                )}

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 flex items-start gap-2 overflow-hidden rounded-lg px-3 py-2"
                      style={{ background: "rgba(236,72,153,0.10)", border: `1px solid ${ME.accent}33` }}
                    >
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" style={{ color: ME.accent }} />
                      <span className="text-[11px]" style={{ color: "#f9a8d4" }}>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* actions */}
                <div className="mt-5 flex gap-2.5">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="rounded-xl px-5 py-3 text-[13px] font-bold transition-colors disabled:opacity-50"
                    style={{ background: ME.card, border: `1px solid ${ME.border}`, color: ME.text }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={busy || uploading || !(productUrl.trim() || description.trim() || uploadedUrls.length > 0) || (connected && (!canAfford || !payoutWallet))}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-extrabold uppercase tracking-wide transition-all enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: ME.accent, color: "#fff", boxShadow: `0 8px 24px -8px ${ME.accent}` }}
                  >
                    {uploading ? (
                      <><Loader2 className="size-4 animate-spin" /> Uploading&hellip;</>
                    ) : busy ? (
                      <><Loader2 className="size-4 animate-spin" /> Paying &amp; rendering&hellip;</>
                    ) : !connected ? (
                      <><Wallet className="size-4" /> Connect wallet</>
                    ) : !canAfford ? (
                      <><Wallet className="size-4" /> Low USDC</>
                    ) : (
                      <><Sparkles className="size-4" /> Pay ${GEN_COST} &amp; Generate</>
                    )}
                  </button>
                </div>
              </>
            )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
    </>,
    document.body,
  );
}
