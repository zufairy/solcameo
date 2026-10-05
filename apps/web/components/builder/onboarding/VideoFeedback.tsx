"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Thumbs up/down taste-feedback control for a rendered video.
//
// Self-contained state machine: idle → (👍 sent → "done") | (👎 → 5 reason
// chips → sent → "done"). Posts to the owner-authed POST /api/agents/video-feedback
// (Task 1) — Owner auth (Privy Bearer + X-Siws-Session) is auto-attached by the
// global fetch interceptor, same pattern as the other /api/agents/* call sites
// in AgentWorkspace.tsx. Errors fail quiet (console.warn) and revert to idle so
// a flaky request never strands the control on a spinner.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

type Verdict = "up" | "down";
type Reason = "style" | "pace" | "topic" | "voice" | "length";
const REASONS: { id: Reason; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "pace", label: "Pace" },
  { id: "topic", label: "Topic" },
  { id: "voice", label: "Voice" },
  { id: "length", label: "Length" },
];

type Phase = "idle" | "reasons" | "sending" | "done";

export function VideoFeedback({
  mintAddress,
  videoTitle,
  formatId,
  compact,
}: {
  mintAddress: string;
  videoTitle?: string;
  formatId?: string;
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");

  const send = async (verdict: Verdict, reason?: Reason) => {
    setPhase("sending");
    try {
      const res = await fetch("/api/agents/video-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, verdict, formatId, reason, videoTitle }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Feedback failed");
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; weightChange?: string };
      const base = verdict === "up" ? "Noted 👍" : "Got it, less of that";
      setMessage(data.weightChange ? `${base} (${data.weightChange})` : base);
      setPhase("done");
    } catch (e) {
      console.warn("[VideoFeedback] failed:", e);
      setPhase("idle");
    }
  };

  const thumbUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (phase !== "idle") return;
    void send("up");
  };

  const thumbDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (phase !== "idle") return;
    setPhase("reasons");
  };

  const pickReason = (e: React.MouseEvent, reason: Reason) => {
    e.stopPropagation();
    void send("down", reason);
  };

  const iconSize = compact ? "size-3.5" : "size-4";
  const btnPad = compact ? "p-1.5" : "px-2.5 py-1.5";

  if (phase === "done") {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className={`rounded-full bg-black/60 px-2.5 py-1.5 text-[11px] font-medium text-white/85 ring-1 ring-white/15 backdrop-blur-sm ${compact ? "" : "inline-block"}`}
      >
        {message}
      </div>
    );
  }

  if (phase === "reasons") {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-wrap items-center gap-1.5 rounded-full bg-black/60 px-2 py-1.5 ring-1 ring-white/15 backdrop-blur-sm"
      >
        {REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={(e) => pickReason(e, r.id)}
            className="rounded-full bg-white/10 px-2 py-1 text-[10.5px] font-medium text-white/85 transition-colors hover:bg-white/20 hover:text-white"
          >
            {r.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 rounded-full bg-black/60 p-0.5 ring-1 ring-white/15 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={thumbUp}
        disabled={phase === "sending"}
        aria-label="Good clip"
        title="Good clip"
        className={`${btnPad} rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-50`}
      >
        <ThumbsUp className={iconSize} />
      </button>
      <button
        type="button"
        onClick={thumbDown}
        disabled={phase === "sending"}
        aria-label="Bad clip"
        title="Bad clip"
        className={`${btnPad} rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-50`}
      >
        <ThumbsDown className={iconSize} />
      </button>
    </div>
  );
}
