"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X } from "lucide-react";
import SocialConnectionsPanel from "./SocialConnectionsPanel";

const DISMISS_MS = 24 * 60 * 60_000; // reappear after 1 day if still missing a required platform

function dismissKey(mintAddress: string) {
  return `vello:connect-socials-dismissed:${mintAddress}`;
}

/** Whether the nudge was dismissed for this mint within the last day. */
export function isConnectPromptDismissed(mintAddress: string): boolean {
  if (typeof window === "undefined" || !mintAddress) return false;
  try {
    const raw = window.localStorage.getItem(dismissKey(mintAddress));
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function dismiss(mintAddress: string) {
  if (typeof window === "undefined" || !mintAddress) return;
  try {
    window.localStorage.setItem(dismissKey(mintAddress), String(Date.now()));
  } catch {
    // best-effort only
  }
}

interface Props {
  open: boolean;
  mintAddress: string;
  agentName: string;
  /** Drives the copy — clippers post existing footage, influencers post original UGC. */
  agentType: "clipping" | "influencer";
  tiktokConnected: boolean;
  youtubeConnected: boolean;
  onClose: () => void;
  /** Jump the parent workspace to the full Schedule/Posting tab. */
  onOpenSchedule: () => void;
}

/**
 * Nudge shown while a minted agent is missing TikTok or YouTube — the two
 * required distribution targets. Hides ONLY once both are connected. Connects
 * INLINE (embeds SocialConnectionsPanel) instead of just linking away, so
 * "guide to connect" ends in a completed connection right here. Minimal glass
 * surface, sharp corners — no icon, no "minted" chrome, just the task.
 */
export default function ConnectSocialsPrompt({
  open, mintAddress, agentName, agentType, tiktokConnected, youtubeConnected, onClose, onOpenSchedule,
}: Props) {
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);

  const close = () => { dismiss(mintAddress); onClose(); };

  if (!portalReady) return null;

  const verb = agentType === "clipping" ? "post its clips" : "publish its content";
  const count = Number(tiktokConnected) + Number(youtubeConnected);
  const allDone = count === 2;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "radial-gradient(60% 50% at 50% 38%, rgba(163,230,53,0.10), transparent 70%), rgba(5,7,6,0.62)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", fontFamily: "var(--font-inter)" }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Connect ${agentName}'s socials`}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="relative w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/[0.14] p-6 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.14)]"
            style={{
              background: "linear-gradient(155deg, rgba(255,255,255,0.10), rgba(255,255,255,0.025) 55%, rgba(163,230,53,0.04))",
              backdropFilter: "blur(32px) saturate(160%)",
              WebkitBackdropFilter: "blur(32px) saturate(160%)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-lime-300/15 blur-3xl" />

            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-white/[0.06] text-white/50 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <X className="size-4" />
            </button>

            <div className="relative">
              <div className="flex items-center gap-1.5" aria-label={`${count} of 2 connected`}>
                {[0, 1].map((i) => (
                  <motion.span key={i} layout className={`h-1 rounded-full transition-colors duration-500 ${i < count ? "w-8 bg-lime-300" : "w-5 bg-white/20"}`} />
                ))}
                <span className="ml-1.5 text-[11px] font-medium tabular-nums text-white/45">{count} of 2</span>
              </div>
              <h2 className="mt-4 pr-8 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-white">
                {allDone ? `${agentName} is ready to post` : `Connect ${agentName}\u2019s socials`}
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/50">
                {allDone ? "Both accounts are linked. You can change them any time in the Schedule tab." : `TikTok and YouTube are required before ${agentName} can ${verb}.`}
              </p>
            </div>

            <div className="relative mt-5">
              <SocialConnectionsPanel username={mintAddress} variant="glass" only={["tiktok", "youtube"]} />
            </div>

            <div className="relative mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => { onOpenSchedule(); close(); }}
                className="text-[12.5px] font-medium text-white/40 underline-offset-4 transition-colors hover:text-white/80 hover:underline"
              >
                Manage in Schedule
              </button>
              <button
                type="button"
                onClick={close}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-[13px] font-semibold transition-all active:scale-[0.97] ${allDone ? "bg-lime-300 text-[#11180d] hover:bg-lime-200" : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white"}`}
              >
                {allDone && <Check className="size-4" strokeWidth={3} />}
                {allDone ? "Done" : "Later"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
