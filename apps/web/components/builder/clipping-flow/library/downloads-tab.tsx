"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, AudioLines, Scissors, Film, X, FileText, Play } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LazyVideo } from "@/components/ui/lazy-video";
import { SourcePreview, youtubeThumbnail } from "@/components/builder/clipping-flow/source-preview";
import { driveFileIdentity } from "@/lib/client/driveFolder";

function DownloadPoster({ sourceUrl, videoUrl }: { sourceUrl: string; videoUrl: string }) {
  const drive = driveFileIdentity(sourceUrl) !== null;
  const youtubePoster = youtubeThumbnail(sourceUrl);
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    if (!drive) return;
    let active = true;
    let objectUrl: string | undefined;
    void fetch(`/api/video/thumbnail?url=${encodeURIComponent(sourceUrl)}`)
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setPoster(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [drive, sourceUrl]);
  if (drive) return poster ? (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated Google thumbnail Blob URL.
    <img src={poster} alt="Google Drive video thumbnail" className="h-16 w-11 shrink-0 rounded-md border border-zinc-900/10 bg-zinc-100 object-cover" />
  ) : <div className="grid h-16 w-11 shrink-0 place-items-center rounded-md border border-zinc-900/10 bg-zinc-100"><Film className="size-4 text-zinc-400" /></div>;
  if (youtubePoster) return (
    // eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumbnail needs no image optimizer round trip.
    <img src={youtubePoster} alt="YouTube video thumbnail" className="h-16 w-11 shrink-0 rounded-md border border-zinc-900/10 bg-zinc-100 object-cover" />
  );
  return <LazyVideo src={videoUrl} muted preload="metadata" className="h-16 w-11 shrink-0 rounded-md border border-zinc-900/10 bg-zinc-100 object-cover" />;
}

function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const MODE_LABEL: Record<string, string> = { full: "Full video", audio: "Audio (transcription)", segment: "Clip segment" };
const MODE_ICON: Record<string, typeof Film> = { full: Film, audio: AudioLines, segment: Scissors };

type ClipJobRow = { sourceUrl: string; transcript?: string; clipsTotal?: number; clipsReady?: number; createdAt: number };

/** Modal — full transcript for one source, plus how many clips came out of it. */
function TranscriptModal({ sourceUrl, transcript, clipCount, onClose }: { sourceUrl: string; transcript: string; clipCount: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border-2 border-zinc-900/15 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-900/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <FileText className="size-3.5" /> Transcript
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-900" title={sourceUrl}>{sourceUrl}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{clipCount} clip{clipCount === 1 ? "" : "s"} generated from this source</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-sm leading-relaxed text-zinc-700 whitespace-pre-wrap">
          {transcript}
        </div>
      </div>
    </div>
  );
}

/**
 * Builder "Downloads" tab - every source video this agent has pulled from a
 * pasted link, backed by the downloadCache table (lib/server/ytDownload.ts).
 * Re-pasting a URL already listed here reuses this stored file instead of
 * downloading again. Each row joins against clipJobs (by sourceUrl) to show
 * how many clips came from that source, and to open the full transcript.
 */
export function DownloadsTab({ mintAddress }: { mintAddress?: string }) {
  const rows =
    (useQuery(api.downloadCache.listByMint, mintAddress ? { mintAddress } : "skip") as
      | { _id: string; sourceUrl: string; url: string; mode?: string; durationSeconds?: number; createdAt: number }[]
      | undefined) ?? [];

  const queriedJobs = useQuery(api.clipJobs.listJobsByMint, mintAddress ? { mintAddress } : "skip") as ClipJobRow[] | undefined;
  const jobs = useMemo(() => queriedJobs ?? [], [queriedJobs]);

  // sourceUrl -> aggregated clip count (across every run against that source) +
  // the most complete transcript any of those runs captured.
  const bySource = useMemo(() => {
    const map = new Map<string, { clipCount: number; transcript: string | null }>();
    for (const j of jobs) {
      const prev = map.get(j.sourceUrl) ?? { clipCount: 0, transcript: null };
      const clipCount = prev.clipCount + (j.clipsReady ?? 0);
      const transcript = j.transcript && j.transcript.length > (prev.transcript?.length ?? 0) ? j.transcript : prev.transcript;
      map.set(j.sourceUrl, { clipCount, transcript });
    }
    return map;
  }, [jobs]);

  const [openTranscript, setOpenTranscript] = useState<{ sourceUrl: string; transcript: string; clipCount: number } | null>(null);
  const [previewSource, setPreviewSource] = useState<string | null>(null);

  if (!mintAddress) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="text-sm text-zinc-600">Mint the agent to start tracking downloads.</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <Download className="mx-auto size-7 text-zinc-400" />
          <div className="mt-3 font-serif text-xl font-bold text-zinc-900">No downloads yet</div>
          <div className="mt-1 text-sm text-zinc-600">
            Paste a video link into the Clipping canvas - the downloaded source will show up here.
            Pasting the same link again reuses the stored file instead of downloading it twice.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#ece5d6] px-8 py-10" style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <h2 className="font-serif text-2xl font-bold text-zinc-900">Downloads</h2>
      <p className="mt-1 text-sm text-zinc-600">
        {rows.length} source video{rows.length === 1 ? "" : "s"} downloaded for this agent. Re-pasting a link below reuses the stored file - no re-download.
      </p>
      <div className="mt-6 space-y-3">
        {rows.map((d) => {
          const mode = d.mode ?? "full";
          const ModeIcon = MODE_ICON[mode] ?? Film;
          const joined = bySource.get(d.sourceUrl);
          const clipCount = joined?.clipCount ?? 0;
          const hasTranscript = !!joined?.transcript;
          return (
          <div
            key={d._id}
            role={hasTranscript ? "button" : undefined}
            tabIndex={hasTranscript ? 0 : undefined}
            onClick={() => hasTranscript && setOpenTranscript({ sourceUrl: d.sourceUrl, transcript: joined!.transcript!, clipCount })}
            onKeyDown={(e) => { if (hasTranscript && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpenTranscript({ sourceUrl: d.sourceUrl, transcript: joined!.transcript!, clipCount }); } }}
            className={`flex items-center gap-4 rounded-xl border-2 border-zinc-900/15 bg-white p-3 shadow-[0_2px_0_0_rgba(0,0,0,0.06)] transition-colors ${hasTranscript ? "cursor-pointer hover:border-zinc-900/30 hover:bg-zinc-50" : ""}`}
          >
            {mode === "audio" ? (
              <div className="grid h-16 w-11 shrink-0 place-items-center rounded-md border border-zinc-900/10 bg-zinc-100">
                <AudioLines className="size-4 text-zinc-400" />
              </div>
            ) : (
              <DownloadPoster sourceUrl={d.sourceUrl} videoUrl={d.url} />
            )}
            <div className="min-w-0 flex-1">
              <a
                href={d.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 truncate text-sm font-semibold text-zinc-900 hover:underline"
                title={d.sourceUrl}
              >
                <span className="truncate">{d.sourceUrl}</span>
                <ExternalLink className="size-3 shrink-0 text-zinc-400" />
              </a>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                <ModeIcon className="size-3 shrink-0" />
                {MODE_LABEL[mode] ?? mode} · {fmtDuration(d.durationSeconds)} · downloaded {fmtDate(d.createdAt)}
                {clipCount > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <Scissors className="size-3 shrink-0" />
                    {clipCount} clip{clipCount === 1 ? "" : "s"}
                  </>
                )}
                {hasTranscript && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1 text-zinc-600">
                      <FileText className="size-3 shrink-0" /> View transcript
                    </span>
                  </>
                )}
              </div>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewSource(d.sourceUrl); }}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">
              <Play className="size-3.5" /> Preview
            </button>
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              <Download className="size-3.5" />
              Open
            </a>
          </div>
          );
        })}
      </div>

      {openTranscript && (
        <TranscriptModal
          sourceUrl={openTranscript.sourceUrl}
          transcript={openTranscript.transcript}
          clipCount={openTranscript.clipCount}
          onClose={() => setOpenTranscript(null)}
        />
      )}
      {previewSource && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewSource(null)}>
          <div className="w-full max-w-xl space-y-3 rounded-2xl border border-white/15 bg-zinc-950 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between text-sm font-semibold text-white"><span>Source preview</span><button type="button" aria-label="Close preview" onClick={() => setPreviewSource(null)}><X className="size-4" /></button></div>
            <SourcePreview sourceUrl={previewSource} mintAddress={mintAddress} />
          </div>
        </div>
      )}
    </div>
  );
}
