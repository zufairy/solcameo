"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, RotateCw } from "lucide-react";

export function RepostVideoButton({ mintAddress, videoUrl, title = "Video", failed = true }: {
  mintAddress: string; videoUrl: string; title?: string; failed?: boolean;
}) {
  const { getAccessToken } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState(false);
  const [resultStatus, setResultStatus] = useState("");
  async function repost() {
    if (busy || queued) return;
    setBusy(true); setMessage("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/social/repost", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ mintAddress, videoUrl, title }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to repost. Please try again.");
      setQueued(true);
      setResultStatus(result.status);
      setMessage(result.status === "posted" ? "Already posted to X" : result.status === "posting" ? "Posting to X…" : "Queued for X. Posting starts shortly.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to repost."); }
    finally { setBusy(false); }
  }
  return <div className="mt-2" onClick={event => event.stopPropagation()}>
    <button type="button" disabled={busy || queued} onClick={() => void repost()} className="inline-flex items-center gap-1.5 rounded-md bg-lime-400/15 px-3 py-1.5 text-xs font-semibold text-lime-300 hover:bg-lime-400/25 disabled:opacity-60">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
      {busy ? "Queuing…" : queued ? resultStatus === "posted" ? "Posted" : resultStatus === "posting" ? "Posting…" : "Queued" : failed ? "Retry X post" : "Post to X"}
    </button>
    {message && <p role="status" className="mt-1 text-[11px] text-zinc-400">{message}</p>}
  </div>;
}
