"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, X, Copy, Check, MessageCircle, RefreshCw } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1] as const;
const VELLO_X = "https://x.com/velloagents";
const LINK = "velloagents.com/agents";

type StatItem = { label: string; value: string };

/**
 * Engaging, HUMAN-sounding share posts. Written to read like a real creator
 * hyping something they found (UGC), not an auto-generated stats dump. No
 * em-dashes anywhere. Each variant optionally weaves in ONE live stat for
 * credibility and degrades gracefully when it's missing. The modal picks one at
 * random on open and cycles on Regenerate, so the copy never looks templated.
 */
const POST_VARIANTS: ((get: (label: string) => string | undefined) => string)[] = [
  (get) => {
    const owners = get("Owners");
    return [
      "ok this is kinda wild.",
      "",
      "AI influencers on Vello film their own videos, post every single day, and earn while you sleep 😴",
      owners ? `${owners} people already own a piece of one.` : "people are already cashing in.",
      "",
      `you can spin up your own in like 5 minutes 👉 ${LINK}`,
    ].join("\n");
  },
  (get) => {
    const vol = get("24h Vol");
    return [
      "imagine an influencer that never sleeps, posts daily, and actually pays YOU back.",
      "",
      "that is what Vello agents do.",
      vol ? `${vol} already moved in the last 24h.` : "and it is only getting louder.",
      "",
      `get in early before everyone else does 👉 ${LINK}`,
    ].join("\n");
  },
  () =>
    [
      "spent 5 minutes building an AI influencer on Vello.",
      "",
      "it has been filming, captioning and posting on its own ever since. i just watch the numbers go up.",
      "",
      `wild that this is real now. try it 👉 ${LINK}`,
    ].join("\n"),
  (get) => {
    const listed = get("Listed / Supply");
    return [
      "the creator economy is quietly getting taken over by AI agents that film, post and earn on autopilot 🤯",
      listed ? `${listed} of them are already live on Vello.` : "and they are multiplying fast.",
      "",
      `do not sleep on this one 👉 ${LINK}`,
    ].join("\n");
  },
  () =>
    [
      "brands are hiring AI influencers now??",
      "",
      "yeah. Vello agents make the content, post it, and you pay per video. no shoots, no editing, no waiting.",
      "",
      `this is the future of content fr 👉 ${LINK}`,
    ].join("\n"),
];

/** Pick one human-sounding variant by index (wraps). */
function buildStatsPost(items: StatItem[], variant: number): string {
  const get = (label: string) => items.find((i) => i.label === label)?.value;
  const idx = ((variant % POST_VARIANTS.length) + POST_VARIANTS.length) % POST_VARIANTS.length;
  return POST_VARIANTS[idx](get);
}

export function HeroActions({
  statItems,
  headerBtn,
  iconBtn,
  colors,
}: {
  statItems: StatItem[];
  headerBtn: string;
  iconBtn: string;
  colors: { text: string; sub: string; border: string; card: string; accent: string };
}) {
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5 mt-1.5">
        {/* ── Share Stats — opens a compose-and-post popup ── */}
        <button type="button" onClick={() => setShareOpen(true)} className={headerBtn} style={{ background: colors.card, color: colors.text, border: `1px solid ${colors.border}` }}>
          Share Stats <Share2 className="size-3" />
        </button>

        {/* Social links */}
        <span className="mx-0.5 hidden h-4 w-px self-center sm:block" style={{ background: colors.border }} />
        <span className="hidden items-center gap-1.5 sm:flex">
          {/* Chat → opens the site-wide live chat widget */}
          <button
            type="button"
            className={iconBtn}
            aria-label="Live chat"
            onClick={() => window.dispatchEvent(new Event("vello:open-live-chat"))}
          >
            <MessageCircle className="size-4" />
          </button>
          {/* X → Vello's official profile */}
          <a href={VELLO_X} target="_blank" rel="noreferrer" className={iconBtn} aria-label="Vello on X">
            <span className="text-[14px] font-bold leading-none">𝕏</span>
          </a>
        </span>
      </div>

      <ShareStatsModal open={shareOpen} onClose={() => setShareOpen(false)} statItems={statItems} colors={colors} />
    </>
  );
}

/* ── Share-stats popup: generated post + one-tap post to X / Threads ─────────── */
function ShareStatsModal({
  open, onClose, statItems, colors,
}: {
  open: boolean;
  onClose: () => void;
  statItems: StatItem[];
  colors: { text: string; sub: string; border: string; card: string; accent: string };
}) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  // Which human-copy variant to show. Picked at random each time the modal opens,
  // and advanced on Regenerate, so the post never looks templated.
  const [variant, setVariant] = useState(0);
  // Portal target only exists on the client — gate so SSR doesn't touch document.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setVariant(Math.floor(Math.random() * POST_VARIANTS.length));
      setText(""); // reset any prior edit so the fresh variant shows
      setCopied(false);
    }
  }, [open]);

  // Lock body scroll + Escape-to-close while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  const generated = useMemo(() => buildStatsPost(statItems, variant), [statItems, variant]);
  const shown = text || generated;

  const postTo = (kind: "x" | "threads") => {
    const t = encodeURIComponent(shown);
    const url =
      kind === "x"
        ? `https://twitter.com/intent/tweet?text=${t}`
        : `https://www.threads.net/intent/post?text=${t}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(shown); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          // z above the sticky tabs / search AND portaled to <body> so no ancestor
          // stacking context can render those on top of the modal.
          className="fixed inset-0 z-[200] grid place-items-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          {/* Backdrop — blurs IN on open and OUT on close (animated, not a static
              pre-blurred layer) so every element behind it recedes smoothly. */}
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: EASE }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75"
          />
          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.34, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg overflow-hidden rounded-3xl border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
            style={{ background: "#0c0d11", borderColor: colors.border }}
          >
            {/* Accent glow header band */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-28"
              style={{ background: `radial-gradient(60% 120% at 50% -20%, ${colors.accent}22, transparent 70%)` }}
            />
            <div className="relative flex items-start justify-between gap-3 px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl" style={{ background: `${colors.accent}1f`, color: colors.accent }}>
                  <Share2 className="size-[18px]" />
                </span>
                <div>
                  <p className="text-[15px] font-extrabold tracking-tight" style={{ color: colors.text }}>Share Vello</p>
                  <p className="text-[11.5px]" style={{ color: colors.sub }}>A fresh, human-sounding post. Tweak it, then send.</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-xl transition-colors hover:bg-white/5" style={{ color: colors.sub }}>
                <X className="size-4" />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-3.5">
              {/* Editable post */}
              <textarea
                value={shown}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                className="w-full resize-none rounded-2xl px-4 py-3.5 text-[13.5px] leading-relaxed outline-none transition-colors focus:border-white/25"
                style={{ background: colors.card, color: colors.text, border: `1px solid ${colors.border}` }}
              />
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setVariant((v) => v + 1); setText(""); }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-semibold transition-colors hover:bg-white/5"
                  style={{ color: colors.text }}
                >
                  <RefreshCw className="size-3.5" /> New caption
                </button>
                <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-white/5" style={{ color: colors.sub }}>
                  {copied ? <><Check className="size-3.5" style={{ color: "#34d399" }} /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
                </button>
              </div>

              {/* Post targets */}
              <div className="grid grid-cols-2 gap-2.5 pt-0.5">
                <button
                  onClick={() => postTo("x")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[13px] font-bold text-white shadow-lg shadow-black/40 transition-transform active:scale-[0.98]"
                  style={{ background: "#000", border: `1px solid ${colors.border}` }}
                >
                  <span className="text-[16px] font-bold leading-none">𝕏</span> Post to X
                </button>
                <button
                  onClick={() => postTo("threads")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[13px] font-bold text-white shadow-lg shadow-black/40 transition-transform active:scale-[0.98]"
                  style={{ background: "#161616", border: `1px solid ${colors.border}` }}
                >
                  <MessageCircle className="size-4" /> Post to Threads
                </button>
              </div>
              <p className="text-center text-[10.5px]" style={{ color: colors.sub }}>
                Opens the composer pre-filled. Review, then publish from your account.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
