"use client";

import { useState } from "react";
import { Scissors, Loader2 } from "lucide-react";

/**
 * Paste-a-video-URL box for the clipping canvas — starts a clip job directly
 * (same path as the chat: run-task → clipJobs), so the operator doesn't have to
 * go through the chat. Progress shows in the live monitor + Clips queue below.
 */
export default function ClipUrlInput({ mintAddress }: { mintAddress: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justQueued, setJustQueued] = useState(false);
  const valid = /^https?:\/\/[^\s]+$/i.test(url.trim());

  async function submit() {
    if (!valid || busy || !mintAddress) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          taskType: "clip_source",
          title: `Clip: ${url.trim().slice(0, 60)}`,
          input: { sourceUrl: url.trim() },
          triggeredBy: "clip_canvas",
        }),
      });
      if (!res.ok) throw new Error(`Failed to start (${res.status})`);
      setUrl("");
      setJustQueued(true);
      setTimeout(() => setJustQueued(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start clipping");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-2xl border-2 border-zinc-900/15 bg-white p-4 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
      <p className="mb-2 font-serif text-[14px] font-bold text-zinc-900">Clip a video</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Paste a YouTube / TikTok / direct .mp4 link…"
          className="min-h-[44px] flex-1 rounded-xl border border-zinc-900/20 bg-[#fbfaf6] px-3.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-lime-500/70"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!valid || busy}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-lime-500 px-5 text-[13px] font-bold text-zinc-950 transition-all hover:bg-lime-400 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
          {busy ? "Starting…" : "Clip it"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
      {justQueued && <p className="mt-2 text-[11px] font-medium text-lime-700">✓ Clip job started, watch the progress below.</p>}
    </div>
  );
}
