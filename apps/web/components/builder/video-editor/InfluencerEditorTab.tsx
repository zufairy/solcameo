"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Clapperboard, Play, Sparkles } from "lucide-react";
import { VideoEditorTab } from "./VideoEditorTab";

/** One example clip bundled with the app so a brand-new influencer (zero
 *  generations yet) still has something real to open in the editor. */
const EXAMPLE_CLIP = { url: "/editor-example.mp4", title: "Example clip" };

/** Settled generations the Videos tab persisted — SAME localStorage key/shape
 *  it writes (`vello.videos.<mint>`, VideosTab.tsx), read-only here. `taskId`
 *  is the real agentTasks row (VideosTab's VideoAsset carries it) — needed so
 *  Apply can write the burned result back to the SAME record the Marketplace
 *  reads, instead of only updating this editor's local preview. */
type StoredVideo = { id: string; url?: string; prompt: string; createdAt: number; taskId?: string; rawUrl?: string };

function readRecentGenerations(mintAddress?: string): StoredVideo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`vello.videos.${mintAddress || "draft"}`);
    const all = raw ? (JSON.parse(raw) as StoredVideo[]) : [];
    return all.filter((v) => v.url).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  } catch {
    return [];
  }
}

function SidebarClip({ url, label, onOpen }: { url: string; label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      className="group relative block w-full overflow-hidden rounded-lg border border-white/10 bg-black/40 text-left transition-colors hover:border-white/25"
    >
      <video src={`${url}#t=0.001`} muted playsInline preload="metadata" className="aspect-[9/16] w-full object-cover opacity-90" />
      <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
        <span className="grid size-8 scale-90 place-items-center rounded-full bg-black/60 text-white opacity-0 ring-1 ring-white/25 transition-all group-hover:scale-100 group-hover:opacity-100">
          <Play className="size-3.5 translate-x-px fill-current" />
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-[10.5px] font-medium text-white/85">
        {label}
      </span>
    </button>
  );
}

/**
 * AI-Influencer flavor of the Editor tab: the full clip editor (captions,
 * style presets, hooks, framing — everything VideoEditorTab already does) with
 * an influencer-specific left rail: one bundled example clip to try, plus this
 * agent's recent Videos-tab generations, each one click away from the timeline.
 */
export function InfluencerEditorTab({ mintAddress, sessionId }: { mintAddress?: string; sessionId?: string }) {
  const [externalClip, setExternalClip] = useState<{ url: string; title: string; nonce: number; taskId?: string; sourceUrl?: string } | undefined>();
  const [stored, setStored] = useState<StoredVideo[]>([]);

  // localStorage is written by the Videos tab in the SAME AgentWorkspace — the
  // list refreshes on mount and whenever the operator returns to this tab (the
  // component remounts per tab switch, so mount-time read stays fresh).
  useEffect(() => setStored(readRecentGenerations(mintAddress)), [mintAddress]);

  // SERVER truth: every succeeded create_video task for this agent (same query
  // the profile's generations grid uses). localStorage alone is empty on any
  // other browser/device — this is why the rail looked blank despite real
  // generations existing. The two sources are merged and deduped by url.
  const serverGenerations = useQuery(
    api.agentTasks.listGenerations,
    mintAddress ? { mintAddress } : "skip",
  ) as FunctionReturnType<typeof api.agentTasks.listGenerations> | undefined;

  const recent = useMemo(() => {
    const out: StoredVideo[] = [];
    const seen = new Set<string>();
    const push = (v: StoredVideo) => {
      if (!v.url || seen.has(v.url)) return;
      seen.add(v.url);
      out.push(v);
    };
    for (const t of serverGenerations ?? []) {
      if (t.type !== "create_video" || !t.output) continue;
      try {
        const o = JSON.parse(t.output) as { videoUrl?: string; rawVideoUrl?: string; topic?: string; caption?: string };
        if (typeof o.videoUrl === "string" && o.videoUrl) {
          push({
            id: t._id, url: o.videoUrl, prompt: o.topic || o.caption || t.title || "Generated video", createdAt: t._creationTime, taskId: t._id,
            // The pre-overlay original (render-step persists it when overlays
            // were burned) — becomes the timeline item's sourceUrl so the
            // "Original" download and un-burn re-edits reach the raw file.
            ...(typeof o.rawVideoUrl === "string" && o.rawVideoUrl ? { rawUrl: o.rawVideoUrl } : {}),
          });
        }
      } catch { /* unparseable output, skip row */ }
    }
    stored.forEach(push);
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  }, [serverGenerations, stored]);

  const openClip = useMemo(
    () => (url: string, title: string, taskId?: string, sourceUrl?: string) => setExternalClip({ url, title, nonce: Date.now(), taskId, sourceUrl }),
    [],
  );

  // Auto-open the LATEST generation the moment the rail resolves, so the
  // Editor tab lands on something real instead of an empty canvas the
  // operator has to click into every time. Only once per mount, and only
  // while nothing's open yet — never yanks the operator off a clip they
  // already picked (e.g. once `recent` refetches with a newer video mid-session).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || externalClip || recent.length === 0) return;
    autoOpenedRef.current = true;
    const latest = recent[0];
    openClip(latest.url!, latest.prompt || "Generated video", latest.taskId, latest.rawUrl);
  }, [recent, externalClip, openClip]);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Influencer rail: example + recent generations ── */}
      <aside className="flex w-[248px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/10 bg-[#050506] p-4">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
            <Sparkles className="size-3.5" /> Try an example
          </div>
          <SidebarClip url={EXAMPLE_CLIP.url} label={EXAMPLE_CLIP.title} onOpen={() => openClip(EXAMPLE_CLIP.url, EXAMPLE_CLIP.title)} />
          <p className="mt-2 text-[11px] leading-snug text-white/40">
            Open the example, then add captions, hooks and styles from the toolbar.
          </p>
        </div>

        <div className="min-h-0">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
            <Clapperboard className="size-3.5" /> Recent generations
          </div>
          {recent.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 p-3 text-[11px] leading-snug text-white/40">
              Videos you generate in the Videos tab land here, open any of them to edit.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {recent.map((v) => (
                <SidebarClip key={v.id} url={v.url!} label={v.prompt || "Generated video"} onOpen={() => openClip(v.url!, v.prompt || "Generated video", v.taskId, v.rawUrl)} />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Full editor (captions + presets + hooks all included) ── */}
      <div className="min-w-0 flex-1">
        <VideoEditorTab
          mintAddress={mintAddress}
          sessionId={sessionId}
          externalClip={externalClip}
          extraVideos={recent.filter((v) => v.url).map((v) => ({ url: v.url!, title: v.prompt || "Generated video", taskId: v.taskId }))}
          clipLabel="Apply"
        />
      </div>
    </div>
  );
}
