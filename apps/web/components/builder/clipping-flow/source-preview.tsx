"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Film, Loader2, Play, RotateCcw } from "lucide-react";
import { driveFileIdentity } from "@/lib/client/driveFolder";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

export function youtubeThumbnail(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const id = host === "youtu.be" ? url.pathname.split("/")[1] :
      host === "youtube.com" || host === "m.youtube.com" ? url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] : null;
    return id && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
  } catch { return null; }
}

/** Lazy source thumbnail for a folder's many member videos. The Drive request is
 * authenticated and only starts when its row scrolls into view. */
export function VideoSourceThumbnail({ sourceUrl, className = "", accessToken }: { sourceUrl: string; className?: string; accessToken?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const youtube = youtubeThumbnail(sourceUrl);
  const drive = driveFileIdentity(sourceUrl) !== null;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setVisible(true); }, { rootMargin: "100px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !drive || !accessToken) return;
    let active = true;
    let objectUrl: string | undefined;
    void fetch(`/api/video/thumbnail?url=${encodeURIComponent(sourceUrl)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPoster(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, drive, sourceUrl, accessToken]);
  return <div ref={ref} className={`grid shrink-0 place-items-center overflow-hidden bg-zinc-800 ${className}`}>
    {(poster || youtube) ? (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated Drive Blob URL or YouTube CDN thumbnail.
      <img src={poster ?? youtube ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
    ) : <Film className="size-4 text-zinc-500" />}
  </div>;
}

/** A selected source's real first-ten-seconds preview. Preparing it is opt-in,
 * so opening a 100-file Drive folder never starts 100 downloads. */
export function SourcePreview(props: { sourceUrl: string; title?: string; mintAddress?: string }) {
  return <SourcePreviewContent key={props.sourceUrl} {...props} />;
}

function SourcePreviewContent({ sourceUrl, title, mintAddress }: { sourceUrl: string; title?: string; mintAddress?: string }) {
  const { accessToken } = useSupabaseAuth();
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drivePoster, setDrivePoster] = useState<string | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [stalled, setStalled] = useState(false);
  const job = useQuery(api.downloadJobs.get, jobId ? { id: jobId as Id<"downloadJobs"> } : "skip") as
    | { status: string; url?: string; error?: string; at?: number } | null | undefined;
  const poster = useMemo(() => youtubeThumbnail(sourceUrl), [sourceUrl]);
  const drive = driveFileIdentity(sourceUrl) !== null;

  useEffect(() => {
    if (!drive || !sourceUrl || !accessToken) return;
    let active = true;
    let objectUrl: string | null = null;
    void fetch(`/api/video/thumbnail?url=${encodeURIComponent(sourceUrl)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setDrivePoster(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [drive, sourceUrl, accessToken]);

  useEffect(() => {
    if (job?.status !== "downloading" || typeof job.at !== "number") return;
    const timer = window.setTimeout(() => setStalled(true), Math.max(0, job.at + 12 * 60_000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [job?.status, job?.at]);

  if (!sourceUrl || (!drive && !poster && !/^https?:\/\//.test(sourceUrl))) return null;
  const progress = (() => {
    if (job?.status !== "downloading" || !job.error) return null;
    try { return JSON.parse(job.error) as { pct?: number; stage?: string }; } catch { return null; }
  })();
  const failure = error ?? (job?.status === "error" ? job.error ?? "Preview failed" : null);
  const videoUrl = job?.status === "done" ? job.url : undefined;

  async function prepare() {
    if (!accessToken) { setError("Sign in to prepare this video preview."); return; }
    setPending(true);
    setError(null);
    setJobId(null);
    setStalled(false);
    try {
      const response = await fetch("/api/video/download-start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ sourceUrl, mintAddress, mode: "segment", section: { start: 0, end: 10 }, editorPreview: true }),
      });
      const data = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !data.jobId) throw new Error(data.error ?? `Could not prepare preview (HTTP ${response.status})`);
      setJobId(data.jobId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare preview");
    } finally { setPending(false); }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/80">
      <div className="relative aspect-video bg-gradient-to-br from-zinc-800 to-zinc-950">
        {videoUrl ? (
          <video key={videoUrl} src={videoUrl} poster={drivePoster ?? poster ?? undefined} controls playsInline preload="metadata"
            onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= 10) event.currentTarget.pause(); }}
            onError={() => setError("The preview could not play. Try preparing it again.")}
            className="h-full w-full object-contain" />
        ) : (drivePoster ?? poster) && !posterFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- Drive thumbnail is a short-lived authenticated Blob URL.
          <img src={drivePoster ?? poster ?? ""} alt={title ? `${title} thumbnail` : "Video thumbnail"} onError={() => setPosterFailed(true)} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center"><Film className="size-8 text-zinc-600" /></div>
        )}
        {!videoUrl && <button type="button" onClick={() => void prepare()} disabled={pending || job?.status === "downloading" && !stalled}
          className="absolute inset-0 flex items-center justify-center gap-2 bg-black/20 text-xs font-semibold text-white transition-colors hover:bg-black/35 disabled:cursor-wait">
          {pending || job?.status === "downloading" && !stalled ? <Loader2 className="size-5 animate-spin" /> : failure || stalled ? <RotateCcw className="size-5" /> : <Play className="size-5 fill-white" />}
          {pending || job?.status === "downloading" && !stalled ? "Preparing first 10 seconds" : failure || stalled ? "Retry preview" : "Preview first 10 seconds"}
        </button>}
      </div>
      <div className="space-y-1 px-3 py-2 text-[11px] text-zinc-400">
        <p className="truncate text-zinc-200">{title || (drive ? "Google Drive video" : "Source video")}</p>
        {job?.status === "downloading" && !stalled && <><p>{progress?.stage || "Preparing a playable preview…"} {typeof progress?.pct === "number" ? `${Math.round(progress.pct)}%` : ""}</p><div className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-lime-400 transition-all" style={{ width: `${Math.max(4, progress?.pct ?? 4)}%` }} /></div></>}
        {videoUrl && <p>First 10 seconds · ready to play</p>}
        {(failure || stalled) && <p role="alert" className="text-amber-300">{failure ?? "Preview stopped updating. Try again."}</p>}
      </div>
    </div>
  );
}
