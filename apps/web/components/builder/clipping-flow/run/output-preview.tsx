"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { setClipStatus } from "@/components/builder/clipping-flow/lib/clipHistoryStorage";
import { DRIP_STAGGER_MS, computeScheduleTimes, existingPerDayFromRows } from "@/lib/builder/dripStagger";
import { browserTimeZone } from "@/lib/builder/timezone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, ImageIcon, Download, ArrowUp, ArrowDown, CalendarClock } from "lucide-react";
import type { NodeOutput } from "@/components/builder/clipping-flow/types/clipping";

type ClipItem = { clipUrl: string; title?: string; durationSeconds?: number; viralScore?: number; emotion?: string; captionText?: string };

/** Human-friendly post spacing, e.g. "2h", "45m", "1h 30m". */
function formatInterval(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Drip controls for a multi-clip run: reorder with ↑/↓, then "Start drip" -
 * clips queue into scheduledContent in the SHOWN order, one every 2h, and the
 * Convex cron posts them. Armed by the Publish node's "Drip-post" setting.
 */
function DripBar({ items, nodeId }: { items: ClipItem[]; nodeId: string }) {
  const drip = useClippingStore((s) => s.dripContext);
  // scheduledContent.schedule is now secret-gated - go through the authed,
  // ownership-scoped /api/schedule/create route with the operator's Privy token.
  const { getFreshToken } = useSupabaseAuth();
  // Live drip rows for this mint - seeds existingPerDay so a SECOND manual drip
  // fills the earliest free slots instead of colliding with the first drip's
  // already-queued clips (which would silently exceed maxPerDay). Mirrors the
  // canvas auto-scheduler's subscription in ClippingFlowCanvas.
  const scheduledRows = useQuery(
    api.scheduledContent.listByMint,
    drip?.mintAddress ? { mintAddress: drip.mintAddress } : "skip",
  ) as { scheduledFor?: number; status?: string }[] | undefined;
  const [state, setState] = useState<"idle" | "scheduling" | "done" | "error">("idle");
  if (!drip) return null;

  // Human-friendly cadence for the status copy - mirrors the spacing/cap actually
  // used by startDrip (computeScheduleTimes), so the UI never claims "every 2h"
  // when the operator configured a different cadence in the Posting tab.
  const cadenceLabel = `one every ${formatInterval(drip.postIntervalMs ?? DRIP_STAGGER_MS)}${
    (drip.maxPerDay ?? 0) > 0 ? `, max ${drip.maxPerDay}/day` : ""
  }`;

  const startDrip = async () => {
    setState("scheduling");
    try {
      const token = await getFreshToken();
      const authHeaders = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      // Spacing/cap come from the persisted clipConfig, threaded via dripContext.
      // Sharing computeScheduleTimes with the canvas auto-scheduler keeps the two
      // posting paths from drifting. existingPerDay is seeded from THIS mint's
      // live scheduledContent rows (not hardcoded empty) so a second manual drip
      // fills the earliest free slots and respects the daily cap instead of
      // re-using the first drip's slots.
      const nowMs = Date.now();
      const intervalMs = drip.postIntervalMs ?? DRIP_STAGGER_MS;
      const maxPerDay = drip.maxPerDay ?? 0;
      // Resolve the scheduling zone once and bucket the existing rows by it so the
      // cap seed lines up with the slots computeScheduleTimes hands out (same zone).
      const scheduleTz = drip.timezone ?? browserTimeZone();
      const existingPerDay = existingPerDayFromRows(scheduledRows, nowMs, scheduleTz);
      const times = computeScheduleTimes(items.length, {
        intervalMs,
        maxPerDay,
        ...(maxPerDay > 0 ? { existingPerDay } : {}),
        now: nowMs,
        // Honor the operator's chosen scheduling zone so the manual drip's real
        // scheduledFor matches the canvas auto-scheduler + calendar forecast.
        timeZone: scheduleTz,
        ...(drip.dailyStartHour !== undefined
          ? { dailyStartHour: drip.dailyStartHour, dailyStartMinute: drip.dailyStartMinute }
          : {}),
      });
      for (const [i, it] of items.entries()) {
        const res = await fetch("/api/schedule/create", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            mintAddress: drip.mintAddress!,
            sessionId: drip.sessionId,
            scheduledFor: times[i] ?? (Date.now() + (i + 1) * intervalMs),
            topic: it.title || "Clip",
            // The clip's OWN transcript-derived caption (never the "Clip N" title);
            // empty → bad source → post BARE (the drip drain sets skipAutoCaption).
            caption: drip.caption || it.captionText || "",
            // Publish node's chosen channels (empty = all connected); fall back to
            // the legacy single platform.
            platforms: drip.platforms ?? (drip.platform ? [drip.platform] : []),
            videoUrl: it.clipUrl,
            // Campaign Hunter: the drip cron forwards this to post_content, which
            // auto-submits the live post to the campaign.
            ...(drip.campaign ? { campaignId: drip.campaign.campaignId } : {}),
          }),
        });
        if (!res.ok) throw new Error(`schedule HTTP ${res.status}`);
        setClipStatus(drip.mintKey, it.clipUrl, "scheduled");
      }
      const cadence = `one every ${formatInterval(intervalMs)}${maxPerDay > 0 ? `, max ${maxPerDay}/day` : ""}`;
      useClippingStore.getState().appendRunLog(`Drip started - ${items.length} clip${items.length > 1 ? "s" : ""}, ${cadence}, in your order`);
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2">
      <div className="min-w-0 text-xs text-sky-200">
        {state === "done"
          ? `Drip scheduled ✓ - ${cadenceLabel} to ${drip.platform}${drip.campaign ? `, auto-submitting to "${drip.campaign.title}"` : ""}`
          : state === "error"
            ? "Scheduling failed - is the schedule backend deployed?"
            : `Order the clips below, then start the drip (${cadenceLabel} to ${drip.platform}).`}
        {drip.campaign && state !== "done" && (
          <span className="mt-1 flex w-fit items-center gap-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200">
            🎯 Auto-submits to &quot;{drip.campaign.title}&quot;
            <button
              type="button"
              title="Detach the campaign - drip only, no submission"
              onClick={() => useClippingStore.getState().setDripContext({ ...drip, campaign: undefined })}
              className="leading-none text-emerald-300/70 hover:text-emerald-100"
            >
              ×
            </button>
          </span>
        )}
      </div>
      {state !== "done" && (
        <Button size="sm" onClick={startDrip} disabled={state === "scheduling"} className="shrink-0 gap-1.5">
          <CalendarClock className="size-3.5" />
          {state === "scheduling" ? "Scheduling…" : `Start drip (${items.length})`}
        </Button>
      )}
    </div>
  );
}

/** Swap two clips in the publish node's output (the drip posts in this order). */
function useMoveClip(nodeId: string) {
  return (items: ClipItem[], index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    useClippingStore.setState((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId && n.data.output?.type === "clips"
          ? { ...n, data: { ...n.data, output: { type: "clips", items: next } } }
          : n
      ),
    }));
  };
}

function PostCard({ headline, gradient }: { headline: string; gradient: string }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex aspect-square items-end p-5" style={{ background: gradient }}>
        <div className="text-lg font-semibold text-white drop-shadow-md">
          {headline}
        </div>
      </div>
    </div>
  );
}

function TikTokPublished({ url, views }: { url: string; views: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div
        className="relative flex aspect-[9/16] w-40 items-end justify-center overflow-hidden rounded-2xl border"
        style={{ background: "linear-gradient(160deg,#db2777,#7c3aed,#2563eb)" }}
      >
        <div className="mb-4 rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur">
          ▶ {views} views
        </div>
      </div>
      <div
        className="flex items-center gap-1.5 text-sm font-medium"
        style={{ color: "var(--node-publish)" }}
      >
        <CheckCircle2 className="size-4" />
        Published to TikTok
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {url.replace("https://www.", "")}
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

function ClipResult({ clipUrl, title, durationSeconds }: { clipUrl: string; title?: string; durationSeconds?: number }) {
  const downloadHref = `/api/video/proxy-download?url=${encodeURIComponent(clipUrl)}&name=${encodeURIComponent(title || "vello-clip")}`;
  return (
    <div className="flex flex-col items-center gap-3">
      {title && <div className="text-sm font-medium text-foreground">{title}</div>}
      { }
      <video
        src={clipUrl}
        controls
        playsInline
        className="w-full max-w-[240px] rounded-2xl border bg-black"
        style={{ aspectRatio: "9 / 16" }}
      />
      {typeof durationSeconds === "number" && durationSeconds > 0 && (
        <div className="text-xs text-muted-foreground">{durationSeconds}s · 9:16 · ready to post</div>
      )}
      <a
        href={downloadHref}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        <Download className="size-4" />
        Download .mp4
      </a>
      <a
        href={clipUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Open in new tab
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

function OutputBody({ output, nodeId }: { output: NodeOutput; nodeId: string }) {
  const moveClip = useMoveClip(nodeId);
  switch (output.type) {
    case "files":
      return (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            {output.count} files pulled from Drive
          </div>
          <div className="grid grid-cols-4 gap-2">
            {output.sample.map((f) => (
              <div
                key={f}
                className="flex aspect-square items-center justify-center rounded-md border bg-muted/40"
                title={f}
              >
                <ImageIcon className="size-5 text-muted-foreground/60" />
              </div>
            ))}
          </div>
        </div>
      );
    case "post":
      return <PostCard headline={output.headline} gradient={output.gradient} />;
    case "caption":
      return (
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            {output.text}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {output.hashtags.map((h) => (
              <Badge key={h} variant="secondary">
                {h}
              </Badge>
            ))}
          </div>
        </div>
      );
    case "overlay":
      return (
        <div className="text-sm text-muted-foreground">
          Layered{" "}
          <span className="font-medium text-foreground">{output.clips}</span>{" "}
          b-roll clips from the{" "}
          <span className="font-medium text-foreground capitalize">
            {output.pack}
          </span>{" "}
          pack.
        </div>
      );
    case "crop":
      return (
        <div className="text-sm text-muted-foreground">
          Reframed to{" "}
          <span className="font-medium text-foreground">{output.ratio}</span>.
        </div>
      );
    case "publish":
      return <TikTokPublished url={output.url} views={output.views} />;
    case "clip":
      return (
        <div className="space-y-3">
          <DripBar items={[{ clipUrl: output.clipUrl, title: output.title, durationSeconds: output.durationSeconds, captionText: output.captionText }]} nodeId={nodeId} />
          <ClipResult clipUrl={output.clipUrl} title={output.title} durationSeconds={output.durationSeconds} />
        </div>
      );
    case "clips":
      return (
        <div className="space-y-3">
          <DripBar items={output.items} nodeId={nodeId} />
          <div className="max-h-[55vh] space-y-6 overflow-y-auto pr-1">
            {output.items.map((c, i) => (
              <div key={c.clipUrl} className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Clip {i + 1} of {output.items.length}</span>
                  {typeof c.viralScore === "number" && (
                    <Badge variant="secondary" className="gap-1 normal-case">
                      Virality {c.viralScore}/100
                      {c.emotion ? <span className="text-muted-foreground">· {c.emotion}</span> : null}
                    </Badge>
                  )}
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      title="Move up (posts earlier)"
                      onClick={() => moveClip(output.items, i, -1)}
                      disabled={i === 0}
                      className="rounded border border-border p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      title="Move down (posts later)"
                      onClick={() => moveClip(output.items, i, 1)}
                      disabled={i === output.items.length - 1}
                      className="rounded border border-border p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </span>
                </div>
                <ClipResult clipUrl={c.clipUrl} title={c.title} durationSeconds={c.durationSeconds} />
              </div>
            ))}
          </div>
        </div>
      );
  }
}

export function OutputPreview() {
  const previewId = useClippingStore((s) => s.previewId);
  const setPreview = useClippingStore((s) => s.setPreview);
  const node = useClippingStore(
    (s) => s.nodes.find((n) => n.id === s.previewId) ?? null
  );
  const open = !!previewId && !!node?.data.output;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPreview(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {node?.data.output?.type === "clip"
              ? "Your clip is ready"
              : node?.data.output?.type === "clips"
                ? `Your ${node.data.output.items.length} clips are ready`
                : `${node?.data.title} output`}
          </DialogTitle>
          <DialogDescription>
            {node?.data.output?.type === "clip" || node?.data.output?.type === "clips"
              ? "Preview below, then download the .mp4s - nothing is posted."
              : "Mock preview - no real media is generated in this prototype."}
          </DialogDescription>
        </DialogHeader>
        {node?.data.output && <OutputBody output={node.data.output} nodeId={node.id} />}
      </DialogContent>
    </Dialog>
  );
}
