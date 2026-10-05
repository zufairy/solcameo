"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { wiredMarketplaceSkillIds } from "@/components/builder/clipping-flow/lib/compile-graph";
import { clipSkillRunCostWithOverrides } from "@/lib/economy/servicePrices";
import { shouldWarnBeforeRun } from "@/lib/builder/connectGate";

// Stable empty-overrides ref so the estCost useMemo doesn't re-run every render
// while the effective-price query is still loading.
const NO_PRICE_OVERRIDES: Record<string, number> = {};
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  ChevronDown,
  StopCircle,
} from "lucide-react";

/** Collapsible step-by-step log of the current/last pipeline run. */
function RunLog() {
  const runLog = useClippingStore((s) => s.runLog);
  const running = useClippingStore((s) => s.runStatus === "running");
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-open while a run is live so live progress (download %, transcribe x/y,
  // clip i/N) is visible without a click. The user can still collapse it.
  useEffect(() => { if (running) setOpen(true); }, [running]);

  // Follow the newest line while the run is live.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runLog, open]);

  if (runLog.length === 0) return null;
  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="pointer-events-auto w-96 rounded-md border border-white/10 bg-[#15161c]/95 shadow">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:text-zinc-100"
      >
        <Terminal className="size-3" />
        Run log · {runLog.length} {running && <Loader2 className="size-3 animate-spin" />}
        <ChevronDown className={`ml-auto size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div ref={scrollRef} className="max-h-48 overflow-y-auto border-t border-white/10 px-2.5 py-1.5">
          {runLog.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex gap-2 font-mono text-[10px] leading-relaxed">
              <span className="shrink-0 text-zinc-500">{fmt(e.ts)}</span>
              <span className={e.line.startsWith("ERROR") ? "text-red-400" : "text-zinc-300"}>{e.line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({
  running,
  errored,
  status,
}: {
  running: boolean;
  errored: boolean;
  status: string;
}) {
  if (running)
    return (
      <span className="flex items-center gap-1 text-primary">
        <Loader2 className="size-3.5 animate-spin" />
        Running
      </span>
    );
  if (status === "done" && !errored)
    return (
      <span className="flex items-center gap-1" style={{ color: "var(--node-publish)" }}>
        <CheckCircle2 className="size-3.5" />
        Done
      </span>
    );
  if (status === "error" || errored)
    return (
      <span className="flex items-center gap-1 text-destructive">
        <AlertTriangle className="size-3.5" />
        Error
      </span>
    );
  return <span className="text-zinc-300">Idle</span>;
}

export function RunBar({
  onRun,
  onAbort,
  hint,
  connectedCount,
  onConnectAccount,
}: {
  /** Real-run handler (minted agents). Falls back to the local mock run. */
  onRun?: () => void | Promise<void>;
  /** Cleanly stop the in-flight run (aborts fetches + resets the canvas). */
  onAbort?: () => void;
  /** Small note shown under the bar (e.g. demo-mode / run errors). */
  hint?: string;
  /** Number of connected social platforms; `null`/undefined = UNKNOWN (not yet
   *  read / flaky / integration off). Drives the pre-run "connect first" gate —
   *  we warn ONLY when this is a hard 0, never on an unknown read. */
  connectedCount?: number | null;
  /** Jump to the Posting tab → Connections so the user can connect an account. */
  onConnectAccount?: () => void;
}) {
  const runStatus = useClippingStore((s) => s.runStatus);
  const startRun = useClippingStore((s) => s.startRun);
  const runProgress = useClippingStore((s) => s.runProgress);
  const total = useClippingStore((s) => s.nodes.length);
  const done = useClippingStore(
    (s) => s.nodes.filter((n) => n.data.status === "done").length
  );
  const errored = useClippingStore((s) =>
    s.nodes.some((n) => n.data.status === "error")
  );
  // Upload gate: don't let the pipeline run on a half-uploaded Source. Blocked
  // while an upload is in flight, OR while a Source is in "upload" mode but has no
  // resolved URL yet (file not finished / not picked). Clears the moment it's green.
  const sourceUploading = useClippingStore((s) => s.sourceUploading);
  const uploadIncomplete = useClippingStore((s) =>
    s.nodes.some((n) => {
      if (n.data.kind !== "source") return false;
      const cfg = n.data.config as { sourceMode?: string; sourceUrl?: string };
      return cfg.sourceMode === "upload" && !cfg.sourceUrl;
    })
  );
  const uploadBlocked = sourceUploading || uploadIncomplete;
  // Live cost estimate - sum of the wired priced skills, recomputed on every graph
  // edit. Uses the SAME helper + price table the run actually charges with
  // (compile-graph.wiredMarketplaceSkillIds + servicePrices), AND the admin price
  // overrides recordUsage bills against, so the badge can never disagree with the bill.
  const nodes = useClippingStore((s) => s.nodes);
  const edges = useClippingStore((s) => s.edges);
  const priceOverrides = (useQuery(api.adminPricing.effectiveSkillPrices, {}) as
    | { overrides: Record<string, number> } | undefined)?.overrides ?? NO_PRICE_OVERRIDES;
  const estCost = useMemo(
    () => clipSkillRunCostWithOverrides(wiredMarketplaceSkillIds(nodes, edges), priceOverrides),
    [nodes, edges, priceOverrides],
  );
  const running = runStatus === "running";
  // Campaign-sourced run? True iff a Source node picked its URL from a campaign
  // (Convex campaignId) or a Stage content_reward (contentRewardId). Used to make
  // the "connect first" warning stronger — a campaign run that can't post also
  // can't submit or earn.
  const isCampaignSource = useClippingStore((s) =>
    s.nodes.some((n) => {
      if (n.data.kind !== "source") return false;
      const cfg = n.data.config as { campaignId?: string; contentRewardId?: string };
      return !!(cfg.campaignId || cfg.contentRewardId);
    }),
  );
  // Fire the actual run (real cloud run, or the local mock for drafts).
  const doRun = () => { if (onRun) void onRun(); else void startRun(); };
  // Pre-run "connect a social first" gate. Once the user picks "Run anyway" we
  // remember it for the session (ref, survives re-renders) so we don't re-nag
  // every run. A reload clears it. `connectedCount` going ≥1 also clears the warn.
  const runAnywayDismissedRef = useRef(false);
  const [connectWarnOpen, setConnectWarnOpen] = useState(false);
  const handleRun = () => {
    if (
      shouldWarnBeforeRun({
        connectedCount: connectedCount ?? null,
        dismissedThisSession: runAnywayDismissedRef.current,
      })
    ) {
      setConnectWarnOpen(true);
      return;
    }
    doRun();
  };
  // Confirm-before-abort modal. The Abort button only opens it; the run is
  // stopped (onAbort) solely when the operator confirms.
  const [confirmAbort, setConfirmAbort] = useState(false);
  // Confirm-before-RUN - a run charges the agent wallet, so make it deliberate.
  const [confirmRun, setConfirmRun] = useState(false);

  return (
    <div className="pointer-events-none absolute top-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#15161c] p-1.5 pl-3 shadow-lg">
        <div className="flex items-center gap-2 pr-1 text-xs font-medium">
          <StatusPill running={running} errored={errored} status={runStatus} />
          <span className="tabular-nums text-zinc-300">
            {done}/{total}
          </span>
          <span
            className="tabular-nums text-[11px] text-zinc-400"
            title="Estimated cost of this run - the sum of the wired skills' per-run fees"
          >
            {estCost > 0 ? `~$${estCost.toFixed(2)}/run` : "Free"}
          </span>
        </div>
        <div className="h-5 w-px bg-border" />
        {running && onAbort && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmAbort(true)}
            title="Abort this run"
          >
            <StopCircle className="size-3.5" />
            Abort
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => setConfirmRun(true)}
          disabled={running || uploadBlocked}
          title={uploadBlocked ? (sourceUploading ? "Uploading… wait for it to finish" : "Finish uploading the Source file first") : undefined}
          className="bg-[#84cc16] font-semibold text-[#101a06] shadow-[0_6px_18px_-6px_rgba(132,204,22,0.85)] transition-colors hover:bg-[#9be51f] focus-visible:ring-2 focus-visible:ring-[#84cc16]/50 disabled:bg-[#84cc16]/40 disabled:text-[#101a06]/50"
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : sourceUploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {running ? "Running…" : sourceUploading ? "Uploading…" : "Run pipeline"}
        </Button>
      </div>

      {/* Subtle persistent nudge when we KNOW no social is connected, clicking it
          jumps to the connect UI. Hidden while running or on an unknown read. */}
      {connectedCount === 0 && !running && (
        <button
          type="button"
          onClick={() => onConnectAccount?.()}
          title="Connect a social account so your clips can auto-post"
          className="pointer-events-auto flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300/90 transition-colors hover:text-amber-200"
        >
          <AlertTriangle className="size-3" />
          No social account connected, clips won&apos;t auto-post
        </button>
      )}

      {/* Confirm-abort modal - reuses the shared Dialog primitive (Base UI). */}
      <Dialog open={confirmAbort} onOpenChange={setConfirmAbort}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Abort this run?</DialogTitle>
            <DialogDescription>
              Are you sure you want to abort this run? In-progress steps will stop.
              Clips that already finished are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep running</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmAbort(false);
                onAbort?.();
              }}
            >
              Abort run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-before-RUN modal - a run charges the agent wallet, so confirm first. */}
      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Run the pipeline?</DialogTitle>
            <DialogDescription>
              {estCost > 0
                ? `This downloads, transcribes and cuts your Source, and charges the agent wallet ~$${estCost.toFixed(2)} (the wired skills' per-run fees). Continue?`
                : "This downloads, transcribes and cuts your Source. No priced skills are wired, so it's free. Continue?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                setConfirmRun(false);
                handleRun();
              }}
            >
              {estCost > 0 ? `Run · ~$${estCost.toFixed(2)}` : "Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect-a-social gate, shown BEFORE a run when zero accounts are
          connected. Never hard-blocks: "Run anyway" always proceeds (download-only)
          and is remembered for the session. "Connect account" jumps to Posting. */}
      <Dialog open={connectWarnOpen} onOpenChange={setConnectWarnOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>No social account connected</DialogTitle>
            <DialogDescription>
              {isCampaignSource ? (
                <>
                  ⚠ You haven&apos;t connected a social account. Your clips will
                  render and download, but they <strong>can&apos;t auto-post</strong>{" "}
                 , and because this is a <strong>campaign</strong> run, they{" "}
                  <strong>won&apos;t be submitted to the campaign or earn</strong> -
                  until you connect an account.
                </>
              ) : (
                <>
                  ⚠ No social account connected. Your clips will render and
                  download, but they <strong>can&apos;t auto-post</strong> until you
                  connect an account.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                runAnywayDismissedRef.current = true;
                setConnectWarnOpen(false);
                doRun();
              }}
            >
              Run anyway
            </Button>
            <Button
              onClick={() => {
                setConnectWarnOpen(false);
                onConnectAccount?.();
              }}
            >
              Connect account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {running && runProgress && (
        <div className="pointer-events-none w-72 rounded-md border border-white/10 bg-[#15161c]/95 px-2.5 py-1.5 shadow">
          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-300">
            <span>{runProgress.label}</span>
            <span className="tabular-nums">{runProgress.pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${runProgress.pct}%` }}
            />
          </div>
        </div>
      )}
      {hint && (
        <div className="pointer-events-none rounded-md border border-white/10 bg-[#15161c]/95 px-2.5 py-1 text-[11px] text-zinc-300 shadow">
          {hint}
        </div>
      )}
      <RunLog />
    </div>
  );
}
