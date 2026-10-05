"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

export default function ClipsQueue({ mintAddress }: { mintAddress: string }) {
  const clips = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") ?? [];
  // clipJobs.setClip is now secret-gated — go through the authed, ownership-scoped
  // /api/clips/skip route with the operator's Privy token.
  const { getFreshToken } = useSupabaseAuth();
  const [err, setErr] = useState<string | null>(null);
  const skipClip = async (clipId: string) => {
    setErr(null);
    try {
      const token = await getFreshToken();
      const res = await fetch("/api/clips/skip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clipId, mintAddress }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to skip clip");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    }
  };
  if (!clips.length) return <p className="text-[12px] text-zinc-500">No clips yet, paste a video URL or join a Clipping campaign.</p>;
  return (
    <div className="space-y-2">
      {err && <p className="text-[11px] text-rose-700">{err}</p>}
      {clips.map((c: Doc<"clips">) => (
        <div key={c._id} className="border border-zinc-300 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-serif font-bold text-[13px] truncate flex items-center gap-1.5 min-w-0">
              <span className="truncate">{c.title}</span>
              {/* Provenance badge (variationLabel): "Cross-video fill" for a short-source
                  stitch, or "Moment 3 · v2" for a per-moment variation. Data-only until now. */}
              {c.variationLabel && (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide bg-indigo-100 text-indigo-700 rounded px-1 py-0.5">
                  {c.variationLabel}
                </span>
              )}
            </span>
            <span
              className={`font-mono text-[10px] uppercase tracking-wide ${c.status === "failed" ? "text-rose-600" : "text-zinc-500"}`}
              title={c.status === "failed" ? c.failReason : undefined}
            >
              {c.status} · {c.viralScore}
            </span>
          </div>
          {c.clipUrl && <video src={c.clipUrl} controls className="mt-2 w-full max-h-72 rounded" />}
          {/* Surface the captured render-failure reason (set by clipJobs.process) so a
              failed clip shows WHY instead of a bare "FAILED". Full text on hover above. */}
          {c.status === "failed" && c.failReason && (
            <p className="text-[11px] text-rose-700 mt-1 line-clamp-2" title={c.failReason}>{c.failReason}</p>
          )}
          <p className="text-[11px] text-zinc-600 mt-1 truncate">{c.captionText || c.reason}</p>
          <div className="flex gap-2 mt-2">
            {c.postUrl && <a href={c.postUrl} target="_blank" rel="noreferrer" className="text-[11px] underline">view post</a>}
            {c.status === "ready" && <button onClick={() => void skipClip(c._id)} className="text-[11px] text-zinc-500">skip</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
