"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, CheckCircle2, ChevronDown, Loader2, Trash2, Upload } from "lucide-react";
import TabPageHeader from "./TabPageHeader";

/* ── Learn tab (influencer) ────────────────────────────────────────────────
   Upload EXAMPLE videos → the agent studies each one (transcript + vision →
   detailed style profile). Ticked examples are live style references: their
   profile rides every render prompt and a sampled frame goes along as a
   visual reference, so the next videos come out in the same style. */

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function LearnTab({ mintAddress, sessionId }: { mintAddress?: string; sessionId?: string }) {
  const { accessToken } = useSupabaseAuth();
  const mintKey = mintAddress || sessionId || "draft";

  const rows = useQuery(api.agentStyleReferences.listByKey, { mintKey }) as Doc<"agentStyleReferences">[] | undefined;
  const createRef = useMutation(api.agentStyleReferences.create);
  const setSelected = useMutation(api.agentStyleReferences.setSelected);
  const removeRef = useMutation(api.agentStyleReferences.remove);
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openProfile, setOpenProfile] = useState<string | null>(null);

  const selectedCount = useMemo(() => (rows ?? []).filter((r) => r.selected && r.status === "ready").length, [rows]);

  const startAnalysis = useCallback(async (refId: Id<"agentStyleReferences">, videoUrl: string) => {
    // Fire-and-forget — Convex reactivity flips the card analyzing → ready.
    void fetch("/api/agents/learn-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ refId, videoUrl }),
    }).catch(() => {});
  }, [accessToken]);

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) { setError("Pick a video file."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(`Video is ${(file.size / 1048576).toFixed(0)}MB, keep it under 200MB.`); return; }
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
      const { storageId } = (await res.json()) as { storageId: string };
      const url = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string | null;
      if (!url) throw new Error("could not resolve the uploaded video URL");
      const refId = (await createRef({ mintKey, videoUrl: url, title: file.name.replace(/\.[a-z0-9]+$/i, "") })) as Id<"agentStyleReferences">;
      await startAnalysis(refId, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, [generateUploadUrl, resolveStorageUrl, createRef, mintKey, startAnalysis]);

  return (
    <div className="min-h-full px-8 py-8" style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <div className="mx-auto max-w-[900px]">
        <TabPageHeader
          icon={BookOpen}
          title="Learn"
          blurb="Upload videos you love. The agent copies their style."
          right={
            <span className="rounded-full border border-lime-400/30 bg-lime-400/10 px-3 py-1.5 text-[11.5px] font-semibold text-lime-300">
              {selectedCount} in use
            </span>
          }
        />

        {/* Upload well */}
        <input ref={fileInputRef} type="file" accept="video/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ""; }} />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="group mx-auto mt-6 flex w-full max-w-[420px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center transition-colors hover:border-lime-400/30 hover:bg-white/[0.05] disabled:cursor-not-allowed"
        >
          {/* Three fanned portrait video cards, the middle one leading, so it
              reads instantly as "short vertical videos go here". */}
          <span className="relative h-[74px] w-[92px]">
            <span aria-hidden className="absolute left-1 top-2 h-[62px] w-[36px] -rotate-[10deg] rounded-md border border-white/15 bg-gradient-to-b from-white/[0.10] to-white/[0.02]" />
            <span aria-hidden className="absolute right-1 top-2 h-[62px] w-[36px] rotate-[10deg] rounded-md border border-white/15 bg-gradient-to-b from-white/[0.10] to-white/[0.02]" />
            <span className="absolute left-1/2 top-0 grid h-[70px] w-[40px] -translate-x-1/2 place-items-center rounded-md border border-lime-400/40 bg-gradient-to-b from-lime-400/[0.16] to-white/[0.03] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.7)] transition-transform group-hover:-translate-y-0.5">
              {uploading ? (
                <Loader2 className="size-4 animate-spin text-lime-300" />
              ) : (
                <Upload className="size-4 text-lime-300" />
              )}
            </span>
          </span>
          <span className="text-[14.5px] font-medium text-white">{uploading ? "Uploading…" : "Upload an example video"}</span>
          <span className="text-[12px] leading-relaxed text-white/40">
            Portrait, up to 1 minute.
          </span>
        </button>
        {error && <p className="mt-2 text-[12.5px] text-red-400">{error}</p>}

        {/* Examples */}
        <div className="mt-7 space-y-3">
          <AnimatePresence initial={false}>
            {(rows ?? []).map((r) => (
              <motion.div key={r._id} layout
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className={`rounded-xl border p-3 transition-colors ${r.selected && r.status === "ready" ? "border-lime-400/40 bg-lime-400/[0.04]" : "border-white/10 bg-white/[0.03]"}`}
              >
                <div className="flex items-start gap-3">
                  <video src={`${r.videoUrl}#t=0.001`} muted playsInline preload="metadata"
                    className="aspect-[9/16] w-[72px] shrink-0 rounded-lg bg-black object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-white">{r.title}</p>
                      {r.status === "analyzing" && (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-300">
                          <Loader2 className="size-3 animate-spin" /> Studying…
                        </span>
                      )}
                      {r.status === "failed" && (
                        <span className="shrink-0 rounded-full bg-red-400/10 px-2 py-0.5 text-[10.5px] font-semibold text-red-300" title={r.error}>
                          Failed
                        </span>
                      )}
                      {r.status === "ready" && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lime-400/10 px-2 py-0.5 text-[10.5px] font-semibold text-lime-300">
                          <CheckCircle2 className="size-3" /> Learned
                        </span>
                      )}
                    </div>

                    {r.status === "ready" && r.styleProfile && (
                      <>
                        <p className={`mt-1.5 text-[12px] leading-relaxed text-zinc-400 ${openProfile === r._id ? "" : "line-clamp-2"}`}>
                          {r.styleProfile}
                        </p>
                        <button type="button" onClick={() => setOpenProfile(openProfile === r._id ? null : r._id)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300">
                          <ChevronDown className={`size-3 transition-transform ${openProfile === r._id ? "rotate-180" : ""}`} />
                          {openProfile === r._id ? "Less" : "Full style profile"}
                        </button>
                      </>
                    )}
                    {r.status === "failed" && r.error && (
                      <p className="mt-1.5 text-[12px] text-red-400/80">{r.error}</p>
                    )}
                    {r.status === "ready" && r.transcript && openProfile === r._id && (
                      <p className="mt-2 rounded-lg bg-black/30 p-2.5 text-[11.5px] leading-relaxed text-zinc-500">
                        <span className="font-semibold text-zinc-400">Transcript: </span>{r.transcript.slice(0, 600)}{r.transcript.length > 600 ? "…" : ""}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2.5">
                    {/* Use-as-reference toggle, realtime saved via Convex */}
                    <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${r.selected ? "border-lime-400/50 bg-lime-400/15 text-lime-300" : "border-white/15 bg-white/[0.04] text-zinc-400 hover:bg-white/10"} ${r.status !== "ready" ? "opacity-50" : ""}`}>
                      <input type="checkbox" className="hidden" checked={r.selected} disabled={r.status !== "ready"}
                        onChange={(e) => void setSelected({ id: r._id, selected: e.target.checked })} />
                      {r.selected ? "Using as reference" : "Use as reference"}
                    </label>
                    <button type="button" onClick={() => void removeRef({ id: r._id })}
                      title="Remove example" className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-white/5 hover:text-red-400">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {rows !== undefined && rows.length === 0 && (
            <div className="py-12 text-center">
              <span className="relative mx-auto grid size-14 place-items-center">
                <span aria-hidden className="absolute inset-0 rounded-2xl bg-lime-400/10" />
                <BookOpen className="relative size-6 text-lime-300/80" />
              </span>
              <p className="mt-4 text-[15px] font-semibold text-white">Nothing learned yet</p>
              <p className="mx-auto mt-1 max-w-[340px] text-[12.5px] leading-relaxed text-zinc-500">
                Upload a video you love and the agent learns its style.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
