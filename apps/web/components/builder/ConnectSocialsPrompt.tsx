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
          style={{ background: "rgba(8,10,14,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", fontFamily: "var(--font-inter)" }}
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
            className="relative w-full max-w-[360px] overflow-hidden rounded-3xl border border-white/[0.18] p-5 shadow-[0_30px_90px_-25px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.22)]"
            style={{
              background: "linear-gradient(150deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.07))",
              backdropFilter: "blur(28px) saturate(170%)",
              WebkitBackdropFilter: "blur(28px) saturate(170%)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />

            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-3.5 top-3.5 grid size-7 place-items-center rounded-full border border-white/10 bg-white/[0.07] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <X className="size-4" />
            </button>

            <div className="relative">
              <div className="flex items-center gap-1.5" aria-label={`${count} of 2 connected`}>
                {[0, 1].map((i) => (
                  <motion.span key={i} layout className={`h-1 rounded-full transition-colors duration-500 ${i < count ? "w-7 bg-white" : "w-4 bg-white/20"}`} />
                ))}
                <span className="ml-1.5 text-[11px] font-medium tabular-nums text-white/45">{count} of 2</span>
              </div>
              <h2 className="mt-3 pr-8 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-white">
                {allDone ? `${agentName} is ready to post` : `Connect ${agentName}\u2019s socials`}
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-white/50">
                {allDone ? "Both accounts are linked. You can change them any time in the Schedule tab." : `TikTok and YouTube are required before ${agentName} can ${verb}.`}
              </p>
            </div>

            <div className="relative mt-4">
              <SocialConnectionsPanel username={mintAddress} variant="glass" only={["tiktok", "youtube"]} />
            </div>

            <div className="relative mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => { onOpenSchedule(); close(); }}
                className="text-[12px] font-medium text-white/40 underline-offset-4 transition-colors hover:text-white/80 hover:underline"
              >
                Manage in Schedule
              </button>
              <button
                type="button"
                onClick={close}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 px-4 text-[12.5px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl transition-all active:scale-[0.97] ${allDone ? "bg-white/[0.25] hover:bg-white/[0.32]" : "bg-white/[0.08] text-white/80 hover:bg-white/[0.15] hover:text-white"}`}
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
