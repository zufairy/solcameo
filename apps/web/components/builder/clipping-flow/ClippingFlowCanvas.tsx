"use client";

import "@/components/builder/clipping-flow/clipping-flow.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, PanelRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { clipPhaseState, isClipActive } from "@/lib/builder/clipPhase";
import { NodePalette } from "@/components/builder/clipping-flow/palette/node-palette";
import { InspectorPanel } from "@/components/builder/clipping-flow/inspector/inspector-panel";
import { RunBar } from "@/components/builder/clipping-flow/run/run-bar";
import { OutputPreview } from "@/components/builder/clipping-flow/run/output-preview";
import { FlowCanvas } from "@/components/builder/clipping-flow/canvas/flow-canvas";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { saveGraph, loadGraph, sanitizeLoadedNodes } from "@/components/builder/clipping-flow/lib/clipGraphStorage";
import { compileGraph, reachableFromSource, wiredMarketplaceSkillIds } from "@/components/builder/clipping-flow/lib/compile-graph";
import { addClipToHistory } from "@/components/builder/clipping-flow/lib/clipHistoryStorage";
import { CLIP_SKILL_BY_ID, isClipSkillId, isAppOnlySkill, DEFAULT_CLIP_SKILL_IDS } from "@/lib/builder/clipSkillsCatalog";
import { CLIP_GENRE_BY_ID } from "@/lib/builder/clipGenres";
import { isCaptionPresetId } from "@/lib/builder/captionPresets";
import { TemplatePicker } from "@/components/builder/clipping-flow/palette/template-picker";
import { TEMPLATE_BY_ID, type ClipTemplate } from "@/components/builder/clipping-flow/data/templates";
import type { NodeStatus, NodeKind, VelloNode, VelloEdge } from "@/components/builder/clipping-flow/types/clipping";
import { evaluateCampaignEligibility, preferredPostPlatform } from "@/lib/builder/campaignEligibility";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { DRIP_STAGGER_MS, computeScheduleTimes, existingPerDayFromRows, orderClips, type PostOrder } from "@/lib/builder/dripStagger";
import { browserTimeZone } from "@/lib/builder/timezone";
import { explainClipFailure, explainClipFailureLine } from "@/lib/clip/failure";
import type { SourceConfig } from "@/components/builder/clipping-flow/types/clipping";

const CLIP_CLOUD_FORCE = process.env.NEXT_PUBLIC_CLIP_CLOUD === "1";
/**
 * Whether the resumable, server-orchestrated CLOUD clip path can be used. The cloud
 * job (convex/clipJobs.process) calls back into the public /api/video/* routes, so
 * it needs a public (https, non-localhost) origin - true in prod (Railway), false on
 * pure-localhost dev (Convex can't reach localhost, so the browser-orchestrated
 * runLocalDemo must be used). Replaces the old build-time-only NEXT_PUBLIC_CLIP_CLOUD
 * gate so a minted prod run defaults to the resumable path WITHOUT a special build
 * flag; NEXT_PUBLIC_CLIP_CLOUD=1 stays as an explicit force-on (e.g. dev vs a tunnel).
 */
function cloudClipAvailable(): boolean {
  if (CLIP_CLOUD_FORCE) return true;
  const u = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (/^https:\/\//i.test(u) && !/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(u)) return true;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    return window.location.protocol === "https:" && h !== "localhost" && h !== "127.0.0.1" && h !== "0.0.0.0";
  }
  return false;
}

/** Skills whose on-video PLACEMENT the Editor tab can set by dragging. */
const PLACEMENT_SKILLS = ["clip.hook", "clip.captions"] as const;

/** The placement-bearing fields of a hook/caption config, as a stable key. */
function placementKey(skillId: string, cfg: Record<string, unknown>): string {
  const custom = (cfg.hookCustomDesign && typeof cfg.hookCustomDesign === "object" ? cfg.hookCustomDesign : {}) as Record<string, unknown>;
  const pick: Record<string, unknown> = skillId === "clip.hook"
    ? { t: cfg.hookTemplateId, p: cfg.hookPosition, d: cfg.hookDurationSec, a: cfg.hookAlwaysOn, y: custom.yPct, f: custom.fontSize }
    : { pr: cfg.captionPreset, al: cfg.captionAlign, y: cfg.captionYPct };
  for (const k of Object.keys(pick)) if (pick[k] === undefined || pick[k] === null) delete pick[k];
  return JSON.stringify(pick);
}

/** Node config with the cloud row's placement fields applied (other fields kept). */
function adoptPlacement(skillId: string, node: Record<string, unknown>, cloud: Record<string, unknown>): Record<string, unknown> {
  const set = (o: Record<string, unknown>, k: string, v: unknown) => { if (v === undefined) delete o[k]; else o[k] = v; };
  if (skillId === "clip.hook") {
    const out: Record<string, unknown> = {};
    for (const k of ["hookTemplateId", "hookPosition", "hookDurationSec", "hookAlwaysOn"]) set(out, k, cloud[k]);
    const nodeCustom = (node.hookCustomDesign && typeof node.hookCustomDesign === "object" ? node.hookCustomDesign : {}) as Record<string, unknown>;
    const cloudCustom = (cloud.hookCustomDesign && typeof cloud.hookCustomDesign === "object" ? cloud.hookCustomDesign : {}) as Record<string, unknown>;
    const custom = { ...nodeCustom };
    set(custom, "yPct", cloudCustom.yPct);
    set(custom, "fontSize", cloudCustom.fontSize);
    out.hookCustomDesign = custom;
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of ["captionPreset", "captionAlign", "captionYPct"]) set(out, k, cloud[k]);
  return out;
}

/** Per-skill cloud-relevant config synced onto the agentSkillFiles row (the only
 *  per-skill store the CLOUD render reads). Returns {} (not null) for the
 *  config-bearing skills even when empty, so CLEARING a value propagates
 *  (overwrites the row); null = the skill has nothing to sync. */
function extractCloudSkillConfig(skillId: string, cfg: Record<string, unknown>): Record<string, unknown> | null {
  if (skillId === "clip.captions") return { ...(cfg.captionPreset ? { captionPreset: cfg.captionPreset } : {}), ...(cfg.captionAlign ? { captionAlign: cfg.captionAlign } : {}), ...(typeof cfg.captionYPct === "number" ? { captionYPct: cfg.captionYPct } : {}), ...(cfg.captionPrompt ? { captionPrompt: cfg.captionPrompt } : {}) };
  if (skillId === "clip.captionstyle") {
    return {
      ...(cfg.captionPrompt ? { captionPrompt: cfg.captionPrompt } : {}),
      ...(typeof cfg.descFromCaption === "boolean" ? { descFromCaption: cfg.descFromCaption } : {}),
      ...(cfg.descriptionPrompt ? { descriptionPrompt: cfg.descriptionPrompt } : {}),
    };
  }
  // Video POOL apps: the uploads ARE the config. Synced so the CLOUD render can
  // read them off the skill row even when the persisted clipConfig predates the
  // upload (a pool added after the last graph compile would otherwise render
  // with no hook and no main video — exactly the "app installed but nothing
  // happens" failure).
  if (skillId === "clip.hookvideos") {
    return { videoUrls: Array.isArray(cfg.videoUrls) ? cfg.videoUrls : [] };
  }
  if (skillId === "clip.maincontent") {
    // Always sync mainOnly as an explicit boolean so mergePoolConfig can tell
    // "unchecked" from "not synced yet" and setConfig replaces the whole row.
    return {
      videoUrls: Array.isArray(cfg.videoUrls) ? cfg.videoUrls : [],
      mainOnly: cfg.mainOnly === true,
    };
  }
  if (skillId === "clip.facetrack") return cfg.framingMode ? { framingMode: cfg.framingMode } : {};
  if (skillId === "clip.zoom") return cfg.zoomStyle ? { zoomStyle: cfg.zoomStyle } : {};
  if (skillId === "clip.brainrot") {
    const c: Record<string, unknown> = {};
    if (cfg.bgLayout) c.bgLayout = cfg.bgLayout;
    if (cfg.bgId) c.bgId = cfg.bgId;
    return c;
  }
  if (skillId === "clip.memeaudio") {
    const c: Record<string, unknown> = {};
    if (cfg.audioUrl) c.audioUrl = cfg.audioUrl;
    if (cfg.audioId) c.audioId = cfg.audioId;
    if (cfg.sfxId) c.sfxId = cfg.sfxId; // curated reaction SFX (merged into this node)
    if (cfg.sfxPackId) c.sfxPackId = cfg.sfxPackId; // chosen reaction-SFX pack (AI still picks the sting)
    if (typeof cfg.gainDb === "number") c.gainDb = cfg.gainDb;
    return c;
  }
  if (skillId === "clip.trendingaudio") {
    const c: Record<string, unknown> = {};
    if (cfg.musicTrackId) c.musicTrackId = cfg.musicTrackId;
    if (typeof cfg.autoMusic === "boolean") c.autoMusic = cfg.autoMusic; // boolean → sync false too
    if (typeof cfg.gainDb === "number") c.gainDb = cfg.gainDb;
    if (cfg.customAudioUrl) c.customAudioUrl = cfg.customAudioUrl;
    return c;
  }
  if (skillId === "clip.sticker") {
    const c: Record<string, unknown> = {};
    if (cfg.stickerStyleId) c.stickerStyleId = cfg.stickerStyleId;
    if (cfg.stickerPosition) c.stickerPosition = cfg.stickerPosition;
    if (cfg.stickerPrompt) c.stickerPrompt = cfg.stickerPrompt;
    return c;
  }
  if (skillId === "clip.overlayimage") {
    const c: Record<string, unknown> = {};
    if (cfg.overlayImageUrl) c.overlayImageUrl = cfg.overlayImageUrl;
    if (cfg.overlayMode) c.overlayMode = cfg.overlayMode;
    if (cfg.overlayPosition) c.overlayPosition = cfg.overlayPosition;
    if (typeof cfg.overlayOpacity === "number") c.overlayOpacity = cfg.overlayOpacity;
    if (typeof cfg.overlayScale === "number") c.overlayScale = cfg.overlayScale;
    return c;
  }
  if (skillId === "clip.filters") {
    const c: Record<string, unknown> = {};
    if (cfg.filterPreset) c.filterPreset = cfg.filterPreset;
    if (typeof cfg.filterSaturation === "number") c.filterSaturation = cfg.filterSaturation;
    if (typeof cfg.filterBrightness === "number") c.filterBrightness = cfg.filterBrightness;
    return c;
  }
  if (skillId === "clip.hook") {
    const c: Record<string, unknown> = {};
    if (cfg.hookDurationSec !== undefined) c.hookDurationSec = cfg.hookDurationSec;
    if (typeof cfg.hookAlwaysOn === "boolean") c.hookAlwaysOn = cfg.hookAlwaysOn;
    if (cfg.hookTemplateId) c.hookTemplateId = cfg.hookTemplateId;
    if (cfg.hookPosition) c.hookPosition = cfg.hookPosition;
    if (cfg.hookCustomDesign && typeof cfg.hookCustomDesign === "object") c.hookCustomDesign = cfg.hookCustomDesign;
    if (cfg.hookPrompt) c.hookPrompt = cfg.hookPrompt;
    return c;
  }
  if (skillId === "clip.title") {
    const c: Record<string, unknown> = {};
    if (cfg.titleTemplateId) c.titleTemplateId = cfg.titleTemplateId;
    if (cfg.titleDurationSec !== undefined) c.titleDurationSec = cfg.titleDurationSec;
    if (cfg.titlePrompt) c.titlePrompt = cfg.titlePrompt;
    return c;
  }
  return null;
}

/**
 * The clipping Flow canvas (builder Studio "Clipping" tab). The node palette is
 * collapsed behind a "+" at the bottom-right. On Run, a MINTED agent compiles
 * its graph to a real ClipConfig + source URL and runs the live clipJobs
 * pipeline (node statuses driven by Convex job state); a draft agent falls back
 * to the local mock run.
 */
export function ClippingFlowCanvas({
  mintKey,
  mintAddress,
  sessionId,
  onNavigateToPosting,
}: {
  mintKey: string;
  mintAddress?: string;
  sessionId?: string;
  /** Jump the workspace to the Posting tab - the single owner of auto-post
   *  settings the Publish node mirrors. Provided by AgentWorkspace. */
  onNavigateToPosting?: () => void;
}) {
  const nodes = useClippingStore((s) => s.nodes);
  const edges = useClippingStore((s) => s.edges);
  const loadGraphAction = useClippingStore((s) => s.loadGraph);
  const resetRun = useClippingStore((s) => s.resetRun);
  const hydrated = useRef(false);
  const hasRun = useRef(false);
  // _creationTime of the newest clip job that existed when the current cloud run
  // started. The reflect effect ignores any job not strictly newer - so the
  // PREVIOUS completed job (still jobs[0] in the window before the new job lands
  // in the reactive query) can't briefly drive the canvas to "done". Compares
  // two server timestamps, so client/server clock skew is irrelevant.
  const runBaselineRef = useRef(0);
  const latestJobTimeRef = useRef(0);
  // Per-run AbortController. Created at run start, cleared at run end. Its
  // signal is threaded into every network call the run makes (download /
  // transcribe / plan / clip) so an Abort actually cancels in-flight fetches,
  // and the loop checks `.signal.aborted` between steps to bail out cleanly.
  const runAbortRef = useRef<AbortController | null>(null);

  // Campaign Scout: load the marketplace only when a scout node is on canvas.
  const scoutWired = nodes.some(
    (n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === "clip.campaignscout",
  );
  const campaignsList = useQuery(api.campaigns.list, scoutWired ? {} : "skip") as
    | { _id: string; title: string; brief?: string; status?: string; targetNiche?: string[]; platforms?: string[] }[]
    | undefined;
  const campaignsRef = useRef(campaignsList);
  campaignsRef.current = campaignsList;
  const { accessToken } = useSupabaseAuth();
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const convex = useConvex();
  const runError = useClippingStore((s) => s.runError);
  const setRunError = useCallback((error: string | null) => useClippingStore.setState({ runError: error }), []);
  // Right inspector is HIDDEN by default and slides in. It auto-reveals whenever a
  // node gets selected, and can be minimized back out via the header/edge toggle.
  // Selection lives in the store; we reveal the panel by adjusting state during
  // render on a selection *transition* (React's "you might not need an effect"
  // pattern) so a fresh click on a node always re-opens a minimized inspector.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const selectedId = useClippingStore((s) => s.selectedId);
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    // Reveal on select, auto-minimize the moment the selection is cleared
    // (clicking empty canvas) — the panel slides back out on its own.
    setInspectorOpen(Boolean(selectedId));
  }
  // Transient one-skill-per-category banner (toast substitute, no dependency).
  const skillNotice = useClippingStore((s) => s.skillNotice);
  useEffect(() => {
    if (!skillNotice) return;
    const t = setTimeout(() => useClippingStore.getState().setSkillNotice(null), 3500);
    return () => clearTimeout(t);
  }, [skillNotice]);
  // Bumped by the F5 re-attach to force the status-reflect effect to re-run (its
  // deps don't change on a fresh mount, so priming the refs alone wouldn't paint).
  const [reattachTick, setReattachTick] = useState(0);
  const paletteWrapRef = useRef<HTMLDivElement | null>(null);
  const paletteFabRef = useRef<HTMLButtonElement | null>(null);

  // Collapse the palette on any click/tap outside it. The FAB is excluded so
  // its own onClick toggle doesn't immediately reopen/close twice. Drags FROM
  // the palette start inside it, so dragging a node onto the canvas keeps it open.
  useEffect(() => {
    if (!paletteOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (paletteWrapRef.current?.contains(t) || paletteFabRef.current?.contains(t)) return;
      setPaletteOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [paletteOpen]);

  const isMinted = !!mintAddress;

  // Load this agent's saved graph once on mount / when the agent changes.
  // hydratedTick mirrors the ref as state so effects gated on hydration
  // (e.g. the chat-op drain) re-run once hydration completes - a ref flip
  // alone never re-triggers them.
  const [hydratedTick, setHydratedTick] = useState(0);
  // SERVER-PERSISTED graph (mint-preferred, sessionId fallback). Source of truth
  // so the pipeline survives across devices/browsers and is the SAME for anyone
  // viewing the agent - the localStorage copy is only a fast/offline cache.
  // `undefined` = still loading; `null` = nothing saved yet.
  const canRemote = !!(mintAddress || sessionId);
  const remoteGraph = useQuery(
    api.clipGraphs.getByKey,
    canRemote ? { mintAddress, sessionId: sessionId ?? "" } : "skip",
  ) as { nodes: VelloNode[]; edges: VelloEdge[]; updatedAt: number } | null | undefined;
  const remoteLoading = canRemote && remoteGraph === undefined;
  const saveGraphRemote = useMutation(api.clipGraphs.save);

  useEffect(() => {
    // Same agent remounting (tab switch): the global store already holds the
    // live graph - and possibly a RUNNING pipeline. Reloading from storage
    // here used to reset runStatus/node spinners and release the run lock.
    if (useClippingStore.getState().hydratedKey === mintKey) {
      hydrated.current = true;
      setHydratedTick((t) => t + 1);
      return;
    }
    // Wait for the Convex query to resolve before hydrating - otherwise we'd
    // hydrate from the (possibly empty) localStorage cache first and the server
    // graph would clobber it a tick later (flash) or lose unsaved server edits.
    if (remoteLoading) return;
    hydrated.current = false;
    const remote = canRemote ? remoteGraph : null;
    if (remote && Array.isArray(remote.nodes) && remote.nodes.length) {
      // Server graph wins (cross-device source of truth). Strip run-scoped state.
      const cleaned = sanitizeLoadedNodes(remote.nodes);
      const edgesIn = Array.isArray(remote.edges) ? remote.edges : [];
      loadGraphAction(cleaned, edgesIn, mintKey);
      saveGraph(mintKey, { nodes: cleaned, edges: edgesIn }); // refresh offline cache
    } else {
      // No server graph yet → one-time migration from the localStorage cache
      // (the pre-Convex storage). Push it up so it's shared from now on.
      const local = loadGraph(mintKey);
      if (local) {
        loadGraphAction(local.nodes, local.edges, mintKey);
        if (canRemote) {
          saveGraphRemote({ mintAddress, sessionId: sessionId ?? "", nodes: local.nodes, edges: local.edges }).catch(() => {});
        }
      } else {
        useClippingStore.setState({ hydratedKey: mintKey });
      }
    }
    Promise.resolve().then(() => {
      hydrated.current = true;
      setHydratedTick((t) => t + 1);
    });
  }, [mintKey, remoteLoading, remoteGraph, canRemote, loadGraphAction, saveGraphRemote, mintAddress, sessionId]);

  // Persist edits (debounced) once hydrated - to BOTH the localStorage cache and
  // Convex. The remote write is skipped while a pipeline runs (the graph is
  // locked during a run, so only node STATUS churns - structure is unchanged and
  // status is stripped on load anyway), avoiding a burst of writes per run.
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => {
      saveGraph(mintKey, { nodes, edges });
      if (canRemote && useClippingStore.getState().runStatus !== "running") {
        saveGraphRemote({ mintAddress, sessionId: sessionId ?? "", nodes, edges }).catch(() => {});
      }
    }, 600);
    return () => clearTimeout(t);
  }, [mintKey, nodes, edges, canRemote, mintAddress, sessionId, saveGraphRemote]);

  // Live clip-job state (real runs). Newest job is first.
  const jobs = useQuery(api.clipJobs.listJobsByMint, mintAddress ? { mintAddress } : "skip");
  const runJobId = useClippingStore((s) => s.runJobId);
  const activeJob = jobs?.find((job) => job._id === runJobId) ?? (jobs as Doc<"clipJobs">[] | undefined)?.[0];
  latestJobTimeRef.current = activeJob?._creationTime ?? latestJobTimeRef.current;

  // PERSISTED per-agent auto-post toggle (source of truth for the run gate). Read
  // the RAW stored clipConfig.autoPost - NOT through normalizeClipConfig, whose
  // DEFAULT_CLIP_CONFIG.autoPost=true would flip a brand-new clipper ON. An unset
  // field stays undefined -> autoPostOn=false, so download-only is the default.
  // Mirrored via a ref so runLocalDemo's stable closure reads the latest value.
  const agentDoc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip");
  const savedClipConfigRef = useRef<Record<string, unknown> | undefined>(undefined);
  savedClipConfigRef.current = (agentDoc?.clipConfig as Record<string, unknown> | undefined) ?? undefined;
  const autoPostOn = !!(agentDoc?.clipConfig as { autoPost?: boolean } | undefined)?.autoPost;
  const autoPostOnRef = useRef(autoPostOn);
  autoPostOnRef.current = autoPostOn;

  // Pre-run "connect a social first" gate — mirror the PostingTab /
  // SocialConnectionsPanel status call (GET /api/social/status) so the RunBar can
  // warn BEFORE a run that would render clips but silently fail to auto-post (and,
  // for a campaign source, never submit or earn). `null` = UNKNOWN (not yet read /
  // transient error / integration unconfigured) → the gate never false-blocks;
  // only a clean 200 that reports zero connected sets a hard 0.
  const socialStatusUser = mintAddress || sessionId || "";
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  useEffect(() => {
    if (!socialStatusUser || !accessToken) {
      setConnectedCount(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(
          `/api/social/status?username=${encodeURIComponent(socialStatusUser)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) return; // transient (502/limit), keep last known, never force 0
        const json = (await res.json()) as {
          ok?: boolean;
          configured?: boolean;
          connected?: Record<string, unknown>;
        };
        if (json.ok === false) return; // route-level error, don't clobber to 0
        if (json.configured === false) return; // integration off → leave UNKNOWN
        const conn = json.connected ?? {};
        if (!cancelled) setConnectedCount(Object.values(conn).filter(Boolean).length);
      } catch {
        // Network blip — keep the last known count so the gate can't flap.
      }
    };
    void refresh();
    // Connecting happens in a popup/tab; re-poll on return so we don't warn on a
    // stale "0 connected" after the user just linked an account.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [socialStatusUser, accessToken]);

  // Existing drip rows for this agent - the auto-post idempotency source. Reading
  // this (public, mint-scoped) lets the scheduler skip any clipUrl already queued
  // so a re-fired run never double-schedules (/api/schedule/create has no dedup).
  // Ref-mirrored for runLocalDemo's stable closure.
  const scheduledRows = useQuery(api.scheduledContent.listByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoUrl?: string; status?: string }[]
    | undefined;
  const scheduledRowsRef = useRef(scheduledRows);
  scheduledRowsRef.current = scheduledRows;

  // Installed clipping skills (the Library) → available as canvas skill nodes.
  const setAvailableSkills = useClippingStore((s) => s.setAvailableSkills);
  const ownedByMint = useQuery(api.agentSkillFiles.listByMint, mintAddress ? { mintAddress } : "skip") as
    | { skillId: string; title: string; markdown: string; config?: unknown }[]
    | undefined;
  const ownedBySession = useQuery(
    api.agentSkillFiles.listBySession,
    !mintAddress && sessionId ? { sessionId } : "skip",
  ) as { skillId: string; title: string; markdown: string; config?: unknown }[] | undefined;
  useEffect(() => {
    const files = (mintAddress ? ownedByMint : ownedBySession) ?? [];
    setAvailableSkills(
      files
        .filter((f) => isClipSkillId(f.skillId) && !isAppOnlySkill(f.skillId))
        .map((f) => {
          const meta = CLIP_SKILL_BY_ID[f.skillId];
          return {
            skillId: f.skillId,
            // Prefer the CANONICAL catalog name over the stored title so the palette
            // label always matches the skillId it adds (a stale/mislabelled title
            // could otherwise show "Captions" on a row that actually adds another
            // skill, opening the wrong inspector).
            name: meta?.name || f.title || f.skillId,
            icon: meta?.icon ?? "✨",
            instructions: f.markdown.replace(/^---[\s\S]*?---\s*/, "").trim(),
          };
        }),
    );
  }, [mintAddress, ownedByMint, ownedBySession, setAvailableSkills]);

  // Raw (unfiltered) installed-skill ids - the campaign eligibility gate needs
  // vello.campaigns / social.uploadpost, which the clip-only availableSkills
  // filter drops. Ref-mirrored so runLocalDemo's closure stays stable.
  const installedSkillIdsRef = useRef<string[]>([]);
  installedSkillIdsRef.current = ((mintAddress ? ownedByMint : ownedBySession) ?? []).map((f) => f.skillId);

  const upsertSkillFile = useMutation(api.agentSkillFiles.upsert);
  // clipStorage.deleteStorage is secret-gated server-side (it can delete ANY
  // object by id), so route the transient source-blob GC through an authed Next
  // endpoint instead of calling the Convex mutation from the browser. Best-effort.
  const deleteSourceBlob = useCallback(async (storageId: string) => {
    const token = accessTokenRef.current;
    await fetch("/api/clip-storage/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ storageId }),
    });
  }, []);

  // Sync each configured clip-skill node's inspector config to agentSkillFiles so
  // the CLOUD auto-clip path (clipJobs.process) applies the SAME caption/hook
  // styling the canvas Run does. The graph itself is localStorage-only, so this
  // row is the only cloud-visible per-skill store. Debounced + deduped against the
  // last write so non-config node changes (drag/select) don't write.
  const setSkillConfig = useMutation(api.agentSkillFiles.setConfig);
  const lastSkillCfgRef = useRef<string>("");

  // ── Placement reconcile (canvas node ⇄ cloud skill row) ──
  // The Editor tab saves where the operator DRAGGED the hook/caption onto the
  // agent's cloud skill row; the canvas keeps its own node config and pushes it
  // to that same row. Without this, the canvas's stale node config overwrote the
  // dragged spot (and canvas runs never saw it), so clips burned the hook/caption
  // somewhere other than where the preview showed it. A cloud placement the
  // canvas hasn't seen before is adopted into the node; the canvas's own edits
  // still push as before. The push below waits until this has run once.
  const updateNodeConfig = useClippingStore((s) => s.updateNodeConfig);
  const seenPlacementRef = useRef<Map<string, Set<string>>>(new Map());
  // Effects run in declaration order, so once the cloud rows are loaded the
  // reconcile below always runs before the (debounced) push — and any node it
  // updates restarts that push's timer with the adopted placement.
  const placementReconciled = (mintAddress ? ownedByMint : ownedBySession) !== undefined;
  useEffect(() => {
    const rows = mintAddress ? ownedByMint : ownedBySession;
    if (!rows) return; // cloud rows not loaded yet — don't guess
    for (const skillId of PLACEMENT_SKILLS) {
      const row = rows.find((r) => r.skillId === skillId);
      const cloudCfg = (row?.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>;
      const cloudKey = placementKey(skillId, cloudCfg);
      const skillNodes = nodes.filter((n) => {
        const c = n.data.config as { variant?: string; skillId?: string };
        return n.data.kind === "skill" && c.variant === "marketplace" && c.skillId === skillId;
      });
      if (!skillNodes.length) continue;
      const seen = seenPlacementRef.current.get(skillId) ?? new Set<string>();
      seenPlacementRef.current.set(skillId, seen);
      for (const n of skillNodes) seen.add(placementKey(skillId, n.data.config as Record<string, unknown>));
      if (cloudKey === "{}" || seen.has(cloudKey)) continue;
      // New placement from elsewhere (the Editor) → adopt it on every node of the skill.
      seen.add(cloudKey);
      for (const n of skillNodes) updateNodeConfig(n.id, adoptPlacement(skillId, n.data.config as Record<string, unknown>, cloudCfg) as never);
    }
  }, [mintAddress, ownedByMint, ownedBySession, nodes, updateNodeConfig]);

  useEffect(() => {
    if (!sessionId || !placementReconciled) return;
    const map = new Map<string, Record<string, unknown>>();
    for (const n of nodes) {
      if (n.data.kind !== "skill") continue;
      const cfg = n.data.config as { variant?: string; skillId?: string } & Record<string, unknown>;
      if (cfg.variant !== "marketplace" || !cfg.skillId) continue;
      const c = extractCloudSkillConfig(cfg.skillId, cfg);
      if (c) map.set(cfg.skillId, c); // last node of a skill wins
    }
    if (map.size === 0) return;
    const serialized = JSON.stringify([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    if (serialized === lastSkillCfgRef.current) return;
    const t = setTimeout(() => {
      lastSkillCfgRef.current = serialized;
      for (const [skillId, config] of map) {
        setSkillConfig({ sessionId, skillId, config, ...(mintAddress ? { mintAddress } : {}) }).catch(() => {});
      }
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, sessionId, mintAddress, setSkillConfig, placementReconciled]);

  // Sync each INSTALLED clip skill's `wired` flag to agentSkillFiles: true when a
  // marketplace skill NODE for that skillId exists on the graph, false otherwise.
  // The Library/Marketplace own row existence (install/uninstall); this flag only
  // mirrors canvas presence so the CLOUD render skips skills that were installed
  // but have no node wired (the skill-leak-divergence bug). Debounced + deduped
  // by serialized snapshot so non-structural changes (drag/select) don't write.
  const setSkillWired = useMutation(api.agentSkillFiles.setWired);
  const lastWiredRef = useRef<string>("");
  useEffect(() => {
    if (!sessionId) return;
    const installed = ((mintAddress ? ownedByMint : ownedBySession) ?? [])
      .filter((f) => isClipSkillId(f.skillId))
      .map((f) => f.skillId);
    if (installed.length === 0) return;
    const wiredIds = new Set(
      nodes
        .filter(
          (n) =>
            n.data.kind === "skill" &&
            (n.data.config as { variant?: string }).variant === "marketplace",
        )
        .map((n) => (n.data.config as { skillId?: string }).skillId)
        .filter((id): id is string => !!id),
    );
    const desired = installed
      .map((id) => [id, wiredIds.has(id)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    const serialized = JSON.stringify(desired);
    if (serialized === lastWiredRef.current) return;
    const t = setTimeout(() => {
      lastWiredRef.current = serialized;
      for (const [skillId, wired] of desired) {
        setSkillWired({
          sessionId,
          skillId,
          wired,
          ...(mintAddress ? { mintAddress } : {}),
        }).catch(() => {});
      }
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, ownedByMint, ownedBySession, mintAddress, sessionId, setSkillWired]);

  // Synchronous twin of the two debounced syncs above, awaited by runReal right
  // before the cloud job starts. Ops queued from the Editor's "Clip" button edit the
  // graph and fire the run in the SAME tick, so the 900ms-debounced writes hadn't
  // landed yet — the cloud job read stale rows (a removed Zoom Punch still wired,
  // the previous hook position). Also installs a row for any wired skill that has
  // none yet (the cloud only renders skills that have a row).
  const ownedRowsRef = useRef<{ skillId: string }[]>([]);
  ownedRowsRef.current = ((mintAddress ? ownedByMint : ownedBySession) ?? []) as { skillId: string }[];
  const flushSkillRows = useCallback(async () => {
    if (!sessionId) return;
    const key = { sessionId, ...(mintAddress ? { mintAddress } : {}) };
    const graph = useClippingStore.getState().nodes.filter(
      (n) => n.data.kind === "skill" && (n.data.config as { variant?: string }).variant === "marketplace",
    );
    const onGraph = new Map<string, Record<string, unknown>>();
    for (const n of graph) {
      const cfg = n.data.config as { skillId?: string } & Record<string, unknown>;
      if (cfg.skillId) onGraph.set(cfg.skillId, cfg); // last node of a skill wins
    }
    const owned = new Set(ownedRowsRef.current.map((r) => r.skillId));
    const writes: Promise<unknown>[] = [];
    for (const [skillId, cfg] of onGraph) {
      if (!isClipSkillId(skillId)) continue;
      writes.push((async () => {
        if (!owned.has(skillId)) {
          const meta = CLIP_SKILL_BY_ID[skillId];
          if (!meta) return;
          await upsertSkillFile({ ...key, skillId, title: meta.name, markdown: meta.markdownTemplate });
        }
        const c = extractCloudSkillConfig(skillId, cfg);
        if (c) await setSkillConfig({ ...key, skillId, config: c });
        await setSkillWired({ ...key, skillId, wired: true });
      })());
    }
    for (const skillId of owned) {
      if (isClipSkillId(skillId) && !onGraph.has(skillId)) writes.push(setSkillWired({ ...key, skillId, wired: false }));
    }
    await Promise.allSettled(writes);
  }, [sessionId, mintAddress, upsertSkillFile, setSkillConfig, setSkillWired]);

  // Auto-install DEFAULT_CLIP_SKILL_IDS (currently just Smart Captions / Dynamic
  // Captions) the first time we see this session/mint's owned-skills list, so
  // best-post captioning is on out of the box - same "installed" row the
  // Marketplace Get button writes, no canvas node required since these skills
  // read straight off the agentSkillFiles row at publish/render time.
  const didAutoInstallRef = useRef(false);
  useEffect(() => {
    const owned = mintAddress ? ownedByMint : ownedBySession;
    if (owned === undefined) return; // still loading
    if (didAutoInstallRef.current) return;
    didAutoInstallRef.current = true;
    const sessionKey = sessionId ?? mintAddress;
    if (!sessionKey) return;
    const ownedIds = new Set(owned.map((f) => f.skillId));
    for (const skillId of DEFAULT_CLIP_SKILL_IDS) {
      if (ownedIds.has(skillId)) continue;
      const meta = CLIP_SKILL_BY_ID[skillId];
      if (!meta) continue;
      void upsertSkillFile({
        sessionId: sessionKey,
        skillId,
        title: meta.name,
        markdown: meta.markdownTemplate,
        ...(mintAddress ? { mintAddress } : {}),
      });
    }
  }, [mintAddress, sessionId, ownedByMint, ownedBySession, upsertSkillFile]);

  // "Pick a template and hit go": replace the graph with a pre-wired pipeline,
  // auto-install its marketplace skills into the Library (free), and open the
  // Source inspector so the only manual step left is pasting the video URL.
  const applyTemplate = useCallback((t: ClipTemplate) => {
    const st = useClippingStore.getState();
    if (st.runStatus === "running") return;
    if (st.nodes.length > 0 && !window.confirm(`Replace the current graph with "${t.name}"? Your current pipeline (and undo history) will be overwritten.`)) return;
    const { nodes: tplNodes, edges: tplEdges } = t.build();
    // No key arg: hydratedKey stays intact, and the debounced persist effect
    // saves the new graph to clipGraphStorage automatically.
    st.loadGraph(tplNodes, tplEdges);
    const src = tplNodes.find((n) => n.data.kind === "source");
    if (src) useClippingStore.setState({ selectedId: src.id });
    // Auto-install missing skills (same pattern as the Marketplace Get button).
    const sessionKey = sessionId ?? mintAddress;
    if (sessionKey) {
      const owned = new Set(((mintAddress ? ownedByMint : ownedBySession) ?? []).map((f) => f.skillId));
      for (const skillId of t.skillIds) {
        if (owned.has(skillId)) continue;
        const meta = CLIP_SKILL_BY_ID[skillId];
        if (!meta) continue;
        void upsertSkillFile({
          sessionId: sessionKey,
          skillId,
          title: meta.name,
          markdown: meta.markdownTemplate,
          ...(mintAddress ? { mintAddress } : {}),
        });
      }
    }
  }, [sessionId, mintAddress, ownedByMint, ownedBySession, upsertSkillFile]);

  // User-initiated abort: aborts the in-flight fetches (so the network stops),
  // then resets the canvas to a clean idle state - node spinners cleared, run
  // bar back to Idle. This is NOT a failed run, so runStatus goes to "idle"
  // (never "error") and no runError is set. Clips already persisted to History /
  // the clips library before the abort are kept (those writes are independent).
  // We don't call resetRun() here because it wipes the run log too - instead we
  // clear the spinner/progress state in place and keep the log so the
  // "Run aborted by user" line stays visible.
  const abortRun = useCallback(() => {
    if (useClippingStore.getState().runStatus !== "running") return;
    runAbortRef.current?.abort();
    // The cloud job keeps running server-side after a client abort, so mark it
    // "stale" (advance the baseline past it) - the activeJob + error-log effects
    // both ignore jobs whose _creationTime <= runBaselineRef, so its late status
    // (e.g. an "upstream error" that lands 48s after the operator aborted) no
    // longer pops the run red or re-lights the nodes.
    runBaselineRef.current = Date.now();
    useClippingStore.getState().appendRunLog("Run aborted by user");
    useClippingStore.setState((s) => ({
      runStatus: "idle",
      runProgress: null,
      // Clear running/spinner node states without marking anything errored.
      // "done" nodes (steps that already finished) stay done; in-flight nodes
      // drop back to idle.
      nodes: s.nodes.map((n) =>
        n.data.status === "running" ? { ...n, data: { ...n.data, status: "idle" } } : n,
      ),
      edges: s.edges.map((e) => ({ ...e, animated: false })),
    }));
    setRunError(null);
  }, [setRunError]);

  // Last cloud phase narrated into the run log, so each stage logs exactly once
  // (-1 = nothing logged yet for this run; 99 = the terminal "complete" line).
  const loggedPhaseRef = useRef<number>(-1);

  // Reflect the live job's status onto the canvas nodes - only after a run we
  // started this session, so a stale completed job doesn't light up on mount.
  useEffect(() => {
    if (!hasRun.current || !activeJob) return;
    // Ignore a job that isn't strictly newer than the run's baseline - that's a
    // stale completed job lingering at jobs[0] before the new one lands.
    if (activeJob._creationTime <= runBaselineRef.current) return;
    const status = activeJob.status;
    // Surface the job's failure reason in the RunBar hint (otherwise a cloud run
    // just goes red with no "why" - download failed / no transcript / fee denied / …).
    if (status === "error") setRunError(activeJob.error ?? "Clip run failed");
    const ps = clipPhaseState(status); // [Download, Transcribe, Find moments, Cut, Post]
    const toStatus = (st: "done" | "active" | "pending"): NodeStatus =>
      st === "done" ? "done" : st === "active" ? "running" : "idle";
    // Source now covers the whole ingest phase - Download + Transcribe + Find
    // moments (Compose node removed) - so it stays lit through the slow part.
    const sourceStatus: NodeStatus =
      status === "completed" ? "done"
      : ps[0].state === "active" || ps[1].state === "active" || ps[2].state === "active" ? "running"
      : ps[2].state === "done" ? "done"
      : "idle";
    const byKind: Record<NodeKind, NodeStatus> = {
      source: status === "error" ? "error" : sourceStatus,
      // Compose is a transparent passthrough hub - mirror the ingest phase so it
      // lights up alongside the Source it fronts.
      compose: status === "error" ? "error" : sourceStatus,
      skill: status === "error" ? "idle" : toStatus(ps[3].state),
      publish: status === "error" ? "idle" : toStatus(ps[4].state),
    };
    // Coarse % progress bar for the CLOUD run. The fine-grained bar only exists on
    // the local-demo path (setRunProgress at the download poll), so a cloud run
    // otherwise shows no bar at all. Derive it from the phase: each completed phase
    // is a full step, the active one counts as half. Cleared on a terminal status.
    const PHASE_LABELS = ["Downloading source", "Transcribing", "Finding moments", "Cutting clips", "Publishing"];
    const donePhases = ps.filter((p) => p.state === "done").length;
    const activePhase = ps.findIndex((p) => p.state === "active");
    // Prefer the REAL server progress (clipJobs.appendLog → progressPct/progressNote:
    // live download %, transcribe window x/y, clip i/N) when present; fall back to the
    // coarse phase-derived bar for older rows / the local-demo path.
    const aj = activeJob as { progressPct?: number; progressNote?: string; log?: unknown[] };
    const hasServerLog = (aj.log?.length ?? 0) > 0;
    const cloudProgress =
      status === "completed" || status === "error"
        ? null
        : aj.progressPct != null
          ? { pct: Math.min(99, Math.max(1, Math.round(aj.progressPct))), label: aj.progressNote ?? "Working…" }
          : {
              pct: Math.min(99, Math.max(5, Math.round(((donePhases + (activePhase >= 0 ? 0.5 : 0)) / ps.length) * 100))),
              label: activePhase >= 0 ? PHASE_LABELS[activePhase] : "Working…",
            };
    // Narrate each cloud stage into the run log. When the server writes a granular
    // log (clipJobs.log), a dedicated effect streams it verbatim - so skip the coarse
    // one-line-per-phase narration here to avoid duplicates. Older rows with no
    // server log keep the coarse narration as a fallback.
    if (!hasServerLog) {
      if (status === "completed") {
        if (loggedPhaseRef.current !== 99) { loggedPhaseRef.current = 99; useClippingStore.getState().appendRunLog("✓ Clipping complete"); }
      } else if (status !== "error" && activePhase >= 0 && activePhase !== loggedPhaseRef.current) {
        loggedPhaseRef.current = activePhase;
        useClippingStore.getState().appendRunLog(`${PHASE_LABELS[activePhase]}…`);
      }
    }
    useClippingStore.setState((s) => ({
      runStatus:
        status === "completed" ? "done"
        : status === "error" ? "error"
        : isClipActive(status) ? "running"
        : s.runStatus,
      nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, status: byKind[n.data.kind] } })),
      runProgress: cloudProgress,
    }));
    // include progressPct/log length so the bar advances on each server heartbeat,
    // not only on a coarse status change.
  }, [activeJob, reattachTick, setRunError]);

  // Stream the server's granular run log (clipJobs.log) into the run-log box. The
  // reflect effect above is keyed on status and won't re-fire as the log grows, so
  // this dedicated effect diffs new entries in. Cursor resets when a new run's row
  // appears (log shrinks/clears).
  // Cursor by TIMESTAMP, not array index: clipJobs.log is bounded (sliced to the
  // last N), so once it caps, indices shift and length stops growing - an index
  // cursor would freeze (this caused the "run log stuck at Cut 4/30" desync). Track
  // the last-streamed ts and append only strictly-newer entries; the dep includes
  // the last entry's ts so this re-fires on every new line even at the cap.
  const lastLogTsRef = useRef(0);
  useEffect(() => {
    if (!hasRun.current || !activeJob || activeJob._creationTime <= runBaselineRef.current) return;
    const log = (activeJob as { log?: { ts: number; note: string }[] }).log ?? [];
    if (log.length === 0) { lastLogTsRef.current = 0; return; } // new run / cleared row
    const store = useClippingStore.getState();
    for (const e of log) {
      if (e.ts > lastLogTsRef.current) { store.appendRunLog(e.note); lastLogTsRef.current = e.ts; }
    }
  }, [
    activeJob?._id,
    (activeJob as { log?: unknown[] } | null)?.log?.length,
    (activeJob as { log?: { ts: number }[] } | null)?.log?.slice(-1)[0]?.ts,
  ]);

  // Surface campaign-submit outcomes (stamped on the job's marker log) into the run
  // log: a "submitted to campaign ✓" on success, a "dropped earning" warning on
  // failure. Without this, the auto-submit result is invisible on the canvas.
  const loggedJobErrorRef = useRef<string>("");
  useEffect(() => {
    const err = activeJob?.error;
    if (!hasRun.current || !err || !activeJob || activeJob._creationTime <= runBaselineRef.current) return;
    if (err === loggedJobErrorRef.current) return;
    loggedJobErrorRef.current = err;
    err.split("\n").forEach((l: string) => {
      if (l.includes("submitted to "))
        useClippingStore.getState().appendRunLog(`✓ Submitted to ${l.replace(/^submitted to /, "")}`);
      else if (l.includes("dropped earning"))
        useClippingStore.getState().appendRunLog(`⚠ Campaign submit failed - ${l.replace(/^dropped earning:\s*/, "")}`);
      else if (activeJob.status === "error" && l.trim())
        // Genuine pipeline failure - surface the ACTIONABLE reason in the run log
        // (map the raw error to an operator fix; lib/clip/failure preserves an
        // already-mapped "…Fix:…"/hinted line via its fallback).
        useClippingStore.getState().appendRunLog(`✗ Clip run failed - ${explainClipFailure(l.trim()).message}`);
    });
  }, [activeJob?.error, activeJob?._id]);

  // REFRESH RE-ATTACH: a cloud run persists as a clipJobs row, so after an F5 we can
  // resume it. On the FIRST reactive jobs result, if the newest job is still in-flight
  // (and not stale), prime the same refs runReal does so the reflect + error effects
  // take over and the canvas shows the live run. One-shot (reattachedRef) so the
  // new-array-every-push `jobs` dep can't re-prime mid-run. Inert in dev (no cloud
  // job exists) and for the local-demo path.
  const reattachedRef = useRef(false);
  useEffect(() => {
    if (reattachedRef.current || jobs === undefined) return;
    reattachedRef.current = true;
    const job = (jobs as Doc<"clipJobs">[])[0];
    if (!job || !isClipActive(job.status)) return;
    const stamp = job.updatedAt ?? job._creationTime;
    const STALE_MS = 15 * 60_000; // matches the server reaper budget
    if (Date.now() - stamp > STALE_MS) {
      // Crashed/evicted process() - don't spin forever; the server reaper will also
      // flip it to error and free enqueue's dedup so it can be re-run.
      useClippingStore.setState({ runStatus: "error" });
      setRunError("The previous clip run stalled (no progress for several minutes). Run it again.");
      return;
    }
    runBaselineRef.current = job._creationTime - 1; // admit THIS row through the >baseline gate
    latestJobTimeRef.current = job._creationTime;
    hasRun.current = true; // ungate the reflect + error effects
    loggedJobErrorRef.current = "";
    useClippingStore.setState({ runStatus: "running" });
    loggedPhaseRef.current = -1; // re-attach → narrate stages from the current one
    useClippingStore.getState().appendRunLog("Reattached to an in-progress cloud clip run");
    setReattachTick((t) => t + 1); // force the reflect effect to re-run now (its deps didn't change on mount)
  }, [jobs, setRunError]);

  // CLOUD run: compile the graph → persist ClipConfig → enqueue the clip job.
  // This is the path for when the app is deployed behind a public URL (the
  // Convex cloud action calls back into the Next /api/video/* routes, which it
  // can't do against localhost). Gated behind NEXT_PUBLIC_CLIP_CLOUD; the Flow
  // tab defaults to runLocalDemo below.
  const runReal = useCallback(async () => {
    if (!mintAddress) return;
    setRunError(null);
    const { sourceUrl: compiledSource, clipConfig, clipFeel, genre, autoPlan } = compileGraph(useClippingStore.getState().nodes, useClippingStore.getState().edges);
    const sourceWatermark = (useClippingStore.getState().nodes.find((n) => n.data.kind === "source")?.data.config as Partial<SourceConfig> | undefined)?.velloWatermark;
    clipConfig.velloWatermark = sourceWatermark ?? (savedClipConfigRef.current?.velloWatermark !== false);
    // UGC RUN ("No clip / UGC needed" on the Main Content app): the operator supplied
    // the footage, so a Source node is not required — there is nothing to clip FROM.
    // The first upload stands in as the job's sourceUrl so provenance, dedup and the
    // enqueue validators all keep working unchanged; the pipeline never pulls it.
    const poolCfg = clipConfig as { mainOnly?: boolean; mainVideos?: string[] };
    const ugcRun = poolCfg.mainOnly === true && (poolCfg.mainVideos?.length ?? 0) > 0;
    const sourceUrl = /^https?:\/\/[^\s]+$/i.test(compiledSource)
      ? compiledSource
      : (ugcRun ? poolCfg.mainVideos![0] : compiledSource);
    if (!/^https?:\/\/[^\s]+$/i.test(sourceUrl)) {
      setRunError("Add a video URL to the Source node first.");
      return;
    }
    // Campaign provenance: if the Source node feeding this run was picked from a
    // campaign, forward its id so the enqueued clip job auto-submits a posted clip
    // back to that campaign. A Source carries at most ONE - contentRewardId (Stage
    // Supabase reward → content_rewards_submissions) XOR campaignId (Convex campaign
    // → submissions). Match by the compiled URL (mirrors how the source was chosen).
    // ALSO read the Master Videos "clip all" opt-in off the same Source node: when the
    // operator turned it on for an expanded folder/channel, send the COLLECTION url +
    // clipAll:true so run-task re-expands it and fans out one clip job per member (capped).
    const { contentRewardId, campaignId, clipAll, collectionUrl } = (() => {
      for (const n of useClippingStore.getState().nodes) {
        if (n.data.kind !== "source") continue;
        const cfg = n.data.config as Partial<SourceConfig>;
        if (String(cfg.sourceUrl ?? "").trim() === sourceUrl) {
          return {
            contentRewardId: cfg.contentRewardId,
            campaignId: cfg.campaignId,
            // A Convex campaign's "clip all" re-expands its single sourceCollectionUrl;
            // a Stage (Supabase) reward has no single collection url — its videos come
            // from merging EVERY link on the reward — so clipAll there is gated on
            // contentRewardId instead (run-task re-resolves by rewardId server-side).
            clipAll: cfg.clipAll === true && (!!cfg.sourceCollectionUrl || !!cfg.contentRewardId),
            collectionUrl: cfg.sourceCollectionUrl,
          };
        }
      }
      return { contentRewardId: undefined as string | undefined, campaignId: undefined as string | undefined, clipAll: false, collectionUrl: undefined as string | undefined };
    })();
    hasRun.current = true;
    reattachedRef.current = true; // this session OWNS the run - the F5 re-attach one-shot must not claim it
    // Baseline: the newest job that exists right now. Only a job created AFTER
    // this drives the canvas - see runBaselineRef.
    runBaselineRef.current = latestJobTimeRef.current;
    loggedPhaseRef.current = -1; // fresh run → narrate its stages from the top
    resetRun();
    // Fresh AbortController for this run - Abort cancels the in-flight kickoff.
    const ac = new AbortController();
    runAbortRef.current = ac;
    useClippingStore.setState({ runStatus: "running", runMode: "cloud", runProgress: { pct: 1, label: "Saving clip settings…" } });
    // RICH run-start context so the log shows WHAT is running (source kind + identity,
    // wired skills, plan), not just generic phase words. resetRun() cleared the log, so
    // these land first.
    {
      const startLog = (s: string) => useClippingStore.getState().appendRunLog(s);
      const srcKind = ugcRun
        ? `your uploads (${poolCfg.mainVideos!.length} video${poolCfg.mainVideos!.length === 1 ? "" : "s"}, no clipping)`
        : contentRewardId ? "campaign (Stage reward)" : campaignId ? "campaign" : "pasted URL";
      const effects = useClippingStore.getState().nodes
        .filter((n) => !["source", "compose", "publish"].includes(n.data.kind))
        .map((n) => (n.data.config as { skillName?: string }).skillName || n.data.title);
      const cc = clipConfig as { maxClipsPerSource?: number; captionsOn?: boolean };
      startLog(`▶ Run started - source: ${srcKind}${clipAll ? " · clip ALL folder videos" : ""}`);
      if (!ugcRun) startLog(`   ${sourceUrl.length > 78 ? sourceUrl.slice(0, 78) + "…" : sourceUrl}`);
      if (effects.length) startLog(`   Skills: ${effects.join(", ")}`);
      startLog(
        `   Plan: ${ugcRun && autoPlan ? `${poolCfg.mainVideos!.length} post(s), one per upload` : autoPlan ? "AI-decided clip count" : `${cc.maxClipsPerSource ?? 1} ${ugcRun ? "post" : "clip"}(s)`}` +
          `${cc.captionsOn ? ", captions on" : ""}` +
          `${genre && genre !== "auto" ? `, genre: ${genre}` : ""}` +
          `${clipFeel && clipFeel !== "any" ? `, feel: ${clipFeel}` : ""}`,
      );
    }
    try {
      // Persist the compiled ClipConfig - but NEVER let the compiled autoPost
      // (default true from the publish node) clobber the user's saved toggle.
      // The persisted toggle (Posting tab) is the source of truth for auto-post;
      // a graph save must preserve it. If unset, fall back to the compiled value.
      const saved = savedClipConfigRef.current as { autoPost?: boolean; platforms?: string[] } | undefined;
      // Persist the compiled ClipConfig through the SIWS-owner-gated route - the
      // influencers.setClipConfig mutation is now secret-gated and can't be called
      // from the browser. Auth (Privy Bearer + X-Siws-Session) is auto-attached by
      // the global fetch interceptor; ac.signal lets Abort cancel this too.
      const cfgRes = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessTokenRef.current ? { Authorization: `Bearer ${accessTokenRef.current}` } : {}) },
        body: JSON.stringify({
          mintAddress,
          kind: "clip",
          payload: {
            ...clipConfig,
            autoPost: saved?.autoPost ?? clipConfig.autoPost,
            // The Posting tab owns channels (clipConfig.platforms) - a graph compile
            // must never clobber the operator's saved choice (incl. an explicit []=all).
            platforms: Array.isArray(saved?.platforms) ? saved!.platforms : clipConfig.platforms,
            // Persist the Source node's Clip Feel + Genre so the CLOUD path
            // (clipJobs.process) re-weights + reorders moments exactly like the local
            // run. compileGraph returns these OUTSIDE clipConfig, so the cloud job -
            // which only sees the persisted clipConfig - had no other channel for them.
            ...(genre && genre !== "auto" ? { genre } : {}),
            ...(clipFeel && clipFeel !== "any" ? { clipFeel } : {}),
            // autoPlan ("Let AI decide") lives OUTSIDE clipConfig too - persist it so
            // the CLOUD path lifts its clip cap to the analyzer's natural count
            // (mirrors the local run). Without it the cloud capped at maxClipsPerSource
            // (=1 when autoPlan hides the manual slider) → only 1 clip from a long video.
            autoPlan: autoPlan === true,
          },
        }),
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(60_000)]),
      });
      if (!cfgRes.ok) {
        const j = (await cfgRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Couldn't save clip config (${cfgRes.status})`);
      }
      await flushSkillRows();
      useClippingStore.getState().setRunProgress({ pct: 2, label: "Starting the clipping worker…" });
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessTokenRef.current ? { Authorization: `Bearer ${accessTokenRef.current}` } : {}) },
        body: JSON.stringify({
          mintAddress,
          taskType: "clip_source",
          title: `Clip: ${sourceUrl.slice(0, 60)}`,
          // contentRewardId / campaignId (when set) ride through clip_source →
          // clipJobs.enqueue → the matching auto-submit branch. Omitted for a plain
          // user source (the handler treats undefined as a no-op).
          // Master Videos "clip all": send the COLLECTION url + clipAll so run-task
          // re-expands it and fans out one clip job per member (capped); otherwise the
          // single picked video URL (unchanged single-video default).
          input: {
            sourceUrl: clipAll && collectionUrl ? collectionUrl : sourceUrl,
            ...(clipAll ? { clipAll: true } : {}),
            ...(contentRewardId ? { contentRewardId } : {}),
            ...(campaignId ? { campaignId } : {}),
          },
          triggeredBy: "clip_canvas",
        }),
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(120_000)]),
      });
      const result = await res.json() as { ok?: boolean; error?: string; output?: { status?: string; note?: string; jobIds?: string[] } };
      if (!res.ok || result.ok === false || result.output?.status === "error") {
        throw new Error(result.error || result.output?.note || `Failed to start (${res.status})`);
      }
      const jobId = result.output?.jobIds?.[0];
      if (jobId) {
        useClippingStore.setState({ runJobId: jobId });
        // enqueue may return an EXISTING job. Admit it through the baseline gate.
        runBaselineRef.current = 0;
        setReattachTick((tick) => tick + 1);
      }
    } catch (e) {
      // An abort is an intentional stop, not a failed run - abortRun already
      // reset the UI, so don't mark it errored here.
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      useClippingStore.setState({ runStatus: "error" });
      setRunError(e instanceof Error ? e.message : "Couldn't start clipping");
    } finally {
      if (runAbortRef.current === ac) runAbortRef.current = null;
    }
  }, [mintAddress, resetRun, setRunError, flushSkillRows]);

  // LOCAL demo run: orchestrate the real /api/video/* routes straight from the
  // browser (same-origin, so no Convex-cloud→localhost round-trip and no
  // self-signed-cert snag), driving node statuses as each step lands and
  // surfacing ONE downloadable clip on the Publish node. No social upload.
  const runLocalDemo = useCallback(async () => {
    // In-flight guard: a second Run click (or a chat auto-trigger) while a run
    // is active would race the same nodes and double-bill the agent. Claim
    // "running" up front - BEFORE the awaited precheck - so any concurrent
    // entry bounces here. Early-return paths below reset it to "idle".
    if (useClippingStore.getState().runStatus === "running") return;
    useClippingStore.setState({ runStatus: "running", runMode: "local", runError: null, runProgress: { pct: 1, label: "Checking clip settings and account…" } });
    // Fresh AbortController for this run. Its signal is threaded into every
    // fetch the run makes; abortRun() calls ac.abort() to cancel in-flight
    // requests, and the loop checks ac.signal.aborted between steps to bail.
    const ac = new AbortController();
    runAbortRef.current = ac;
    setRunError(null);
    const { sourceUrls, clipFeel, genre, autoPlan, clipConfig, width, height } = compileGraph(useClippingStore.getState().nodes, useClippingStore.getState().edges);
    if (sourceUrls.length === 0) {
      setRunError("Add a video URL to the Source node first.");
      useClippingStore.setState({ runStatus: "idle" });
      runAbortRef.current = null;
      return;
    }
    // Multi-source: every Source node with a URL contributes; cap to keep a
    // single run sane (each source = a download + transcribe).
    const sources = sourceUrls.slice(0, 3);
    // Feature E caching: map each source URL → whether it came from a clipping
    // CAMPAIGN's contentLinks (Convex campaignId set) OR a Stage content_reward
    // (Supabase contentRewardId set). Only these PROVENANCE sources cache the
    // transcript; user-pasted/uploaded URLs never do. Keyed by the trimmed URL so
    // each transcribe call can tag campaignSource by provenance. rewardByUrl is
    // tracked separately so the cloud run can also set contentRewardId on the job.
    const campaignByUrl = new Map<string, string>();
    const rewardByUrl = new Map<string, string>();
    for (const n of useClippingStore.getState().nodes) {
      if (n.data.kind !== "source") continue;
      const cfg = n.data.config as Partial<SourceConfig>;
      const u = String(cfg.sourceUrl ?? "").trim();
      if (!u) continue;
      if (cfg.campaignId) campaignByUrl.set(u, cfg.campaignId);
      if (cfg.contentRewardId) rewardByUrl.set(u, cfg.contentRewardId);
    }
    // One id per run - the routes derive idempotency keys from it so a retry
    // of any step never double-bills the agent.
    const runId = crypto.randomUUID();

    // Skills-only pricing: the run is charged once per WIRED marketplace skill
    // (compute is absorbed). Compute the wired skill ids up front so the precheck
    // can both ESTIMATE and CHARGE them. Deduped; same set the run applies below.
    const nodesNow = useClippingStore.getState().nodes;
    // Single source of truth shared with the RunBar cost estimate (compile-graph).
    const wiredSkillIds = wiredMarketplaceSkillIds(nodesNow, useClippingStore.getState().edges);

    const setKind = (kind: NodeKind, status: NodeStatus) =>
      useClippingStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.data.kind === kind ? { ...n, data: { ...n.data, status } } : n)),
      }));
    // signal defaults to this run's AbortController so an Abort cancels the
    // in-flight request; callers can pass an explicit one (e.g. a poll loop).
    const postJSON = async (
      path: string,
      payload: unknown,
      opts?: { signal?: AbortSignal },
    ): Promise<Record<string, unknown>> => {
      const token = accessTokenRef.current;
      const r = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Auth for the metered video routes (requireInternalOrUserAuth):
          // Supabase Bearer when signed in; dev bypass covers localhost.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: opts?.signal ?? ac.signal,
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (r.status === 402) {
        // Billing denial - stop the run with an ACCURATE reason, not a generic
        // "needs funding" (telling the owner of a suspended agent to top up is
        // wrong). The per-clip catch below aborts the whole pool on any of these.
        const reason = (j.error as string) || "needs_funding";
        throw new Error(
          reason === "daily_cap"
            ? "Daily spend cap reached for this agent - try again tomorrow or raise VELLO_DAILY_SPEND_CAP_USDC."
            : reason === "suspended"
              ? "This agent is suspended - runs are blocked."
              : "Agent needs funding - top up its wallet with USDC to keep clipping.");
      }
      if (!r.ok || j.ok === false) throw new Error((j.error as string) || `${path} failed (${r.status})`);
      return j;
    };

    // ── Billing pre-check (minted agents): don't do the work then fail to
    // bill. Reconciles the wallet mirror server-side, then verifies balance +
    // daily headroom against the price table. Draft agents skip (free tier).
    if (mintAddress || sessionId) {
      try {
        const token = accessTokenRef.current;
        const pre = await fetch("/api/economy/clip-precheck", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          // Skills-only pricing: the precheck estimates AND charges the wired
          // skills' per-run fees for this runId (idempotent).
          body: JSON.stringify({ mintAddress, sessionId, runId, skillIds: wiredSkillIds }),
          signal: AbortSignal.any([ac.signal, AbortSignal.timeout(60_000)]),
        });
        const pj = (await pre.json().catch(() => ({}))) as { ok?: boolean; reason?: string; estCostUsdc?: number; spendableUsdc?: number; dailyRemainingUsdc?: number; runsToday?: number; capRuns?: number };
        // Treat ANY non-ok verdict as a block. The precheck returns 503 +
        // reason:"precheck_unavailable" when it can't verify funds / meter the
        // run (money gate fails CLOSED), so !pre.ok must stop the run too -
        // don't fall through to "route-level gates still protect" and start
        // unmetered work.
        if (!pre.ok || pj.ok === false) {
          const est = pj.estCostUsdc?.toFixed(2) ?? "?";
          setRunError(
            pj.reason === "daily_cap"
              ? `Daily spend cap reached ($${pj.dailyRemainingUsdc?.toFixed(2) ?? "0"} headroom left, run needs ~$${est}).`
              : pj.reason === "suspended"
                ? "This agent is suspended - runs are blocked."
                : pj.reason === "free_tier_limit"
                  ? `Free tier limit reached (${pj.runsToday}/${pj.capRuns} runs today) - mint the agent to keep clipping.`
                  : pj.reason === "precheck_unavailable"
                    ? "Couldn't verify the agent's funds right now (billing service unavailable). Please try again in a moment."
                    : `Agent needs funding - $${pj.spendableUsdc?.toFixed(2) ?? "0"} spendable, this run needs ~$${est}. Top up the agent wallet with devnet USDC.`,
          );
          useClippingStore.setState({ runStatus: "idle" });
          runAbortRef.current = null;
          return;
        }
      } catch (e) {
        // Precheck transport failure. For a MINTED agent this is the sole billing
        // chokepoint (the wired skills' per-run fees are charged here), so failing
        // OPEN would let a priced run execute free. Fail CLOSED - same as the
        // precheck_unavailable verdict. A draft (sessionId-only) run is free-tier,
        // so it may proceed. A user abort during the fetch just stops cleanly.
        if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) { runAbortRef.current = null; return; }
        if (mintAddress) {
          setRunError("Couldn't verify the agent's funds right now (billing service unavailable). Please try again in a moment.");
          useClippingStore.setState({ runStatus: "idle" });
          runAbortRef.current = null;
          return;
        }
      }
    }

    // Aborted during the precheck → abortRun already reset the UI; stop here.
    if (ac.signal.aborted) { runAbortRef.current = null; return; }

    let activeKind: NodeKind = "source";
    resetRun();
    useClippingStore.setState({ runStatus: "running", runMode: "local" });
    const log = (line: string) => useClippingStore.getState().appendRunLog(line);
    const progress = (pct: number, label: string) => {
      useClippingStore.getState().setRunProgress({ pct, label });
      log(label);
    };
    // Delete the transient uploaded source blobs (their storageId lives on the
    // Source node config). Called on BOTH a clean finish and a FAILED run so a
    // crash mid-pipeline never strands the upload in storage forever. Each id is
    // cleared after delete so a re-run can't double-delete a gone blob. NOT called
    // on user abort - the upload is kept so the run can be retried without re-upload.
    const cleanupUploadedSources = (): number => {
      const ids = useClippingStore.getState().nodes
        .filter((n) => n.data.kind === "source")
        .map((n) => (n.data.config as { sourceStorageId?: string }).sourceStorageId)
        .filter((id): id is string => !!id);
      for (const sid of ids) {
        void deleteSourceBlob(sid).then(() => {
          // Clear BOTH the storageId and the (now-dead) sourceUrl. Leaving the URL
          // would make a retry fetch a deleted blob → a confusing 404; clearing it
          // resets the node to an empty upload so the retry skips it / re-prompts.
          useClippingStore.setState((s) => ({
            nodes: s.nodes.map((n) =>
              n.data.kind === "source" && (n.data.config as { sourceStorageId?: string }).sourceStorageId === sid
                ? { ...n, data: { ...n.data, config: { ...n.data.config, sourceStorageId: undefined, sourceUrl: "" } } }
                : n,
            ),
          }));
        }).catch(() => {});
      }
      return ids.length;
    };
    try {
      type Seg = { start: number; end: number; text: string };
      type Word = { word: string; start: number; end: number };
      type PlanMoment = { startSeconds: number; endSeconds: number; title?: string; viralScore?: number; emotion?: string; reason?: string; captionText?: string };
      // segmentMode: source was pulled audio-first (social URL) - the video for
      // each clip is downloaded per-segment at cut time, so srcUrl (the audio)
      // isn't the cut source. Direct/Drive links stay full-download (srcUrl =
      // the whole video, cut with absolute timestamps).
      type SourcedPlan = { moment: PlanMoment; ops: unknown; srcUrl: string; srcOriginal: string; words: Word[]; segmentMode: boolean };
      // Match by HOSTNAME (anchored) - MUST stay in sync with SOCIAL_HOSTS in
      // lib/server/downloader.ts. An unanchored substring match wrongly flags
      // direct .mp4 links whose host/path merely contains a social keyword (e.g.
      // "x.com" inside "cdn.box.com", or "youtube.com" in a path), which would
      // route them down the audio-first/segment path that the server's
      // directFetch ignores → the whole video gets returned as a broken "clip".
      const isSocialUrl = (u: string) => {
        try {
          return /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com)$/i.test(new URL(u).hostname);
        } catch {
          return false;
        }
      };
      // Drive sources aren't one-off blobs we minted - never GC them (matches
      // the server-side skip in convex/clipJobs.ts). Anchored-hostname match.
      const isDriveUrl = (u: string) => {
        try {
          return /(^|\.)(drive|docs)\.google\.com$/i.test(new URL(u).hostname);
        } catch {
          return false;
        }
      };
      // An uploaded file's source URL is ALREADY a Convex storage object - it
      // doesn't need download-start (which would re-fetch the blob and re-store a
      // SECOND, leaked copy). transcribe + clip read this URL directly.
      const isConvexStorageUrl = (u: string) => {
        try {
          return /(^|\.)convex\.(cloud|site)$/i.test(new URL(u).hostname);
        } catch {
          return false;
        }
      };

      // Collect the installed-skill MDs from the graph's skill nodes ONCE - the
      // same skills apply to every source. Only nodes wired downstream of a
      // Source participate.
      const graphNodes = useClippingStore.getState().nodes;
      const owned = useClippingStore.getState().availableSkills;
      const wired = reachableFromSource(graphNodes, useClippingStore.getState().edges);
      const skills = graphNodes
        .filter((n) => wired.has(n.id))
        .filter((n) => n.data.kind === "skill" && (n.data.config as { variant?: string }).variant === "marketplace")
        .map((n) => {
          const cfg = n.data.config as { skillId: string; skillName?: string; prompt?: string; captionPreset?: string; captionAlign?: "top" | "center" | "bottom"; captionYPct?: number; captionPrompt?: string; hookDurationSec?: number; hookAlwaysOn?: boolean; hookTemplateId?: string; hookPosition?: "top" | "center" | "bottom"; hookCustomDesign?: { font?: string; fontColor?: string; fontSize?: number; position?: "top" | "center" | "bottom"; yPct?: number; boxColor?: string | null; allCaps?: boolean }; hookPrompt?: string; hookLanguage?: string; titleTemplateId?: string; titleDurationSec?: number; titlePrompt?: string; framingMode?: string; zoomStyle?: string; stickerStyleId?: string; stickerPosition?: string; stickerPrompt?: string; bgLayout?: string; bgId?: string; audioUrl?: string; audioId?: string; gainDb?: number; filterPreset?: "vintage" | "warm" | "cool" | "bw" | "vivid"; filterSaturation?: number; filterBrightness?: number; sfxId?: string; sfxPackId?: string; sfxAtSec?: number; musicTrackId?: string; autoMusic?: boolean; customAudioUrl?: string; overlayImageUrl?: string; overlayMode?: string; overlayPosition?: string; overlayOpacity?: number; overlayScale?: number };
          const meta = owned.find((s) => s.skillId === cfg.skillId);
          return {
            skillId: cfg.skillId, // forwarded so the server can apply the skill's deterministic floor
            // Dynamic Captions: the preset picked in the inspector (server
            // resolves it to the full caption render spec).
            ...(cfg.skillId === "clip.captions" && cfg.captionPreset ? { captionPreset: cfg.captionPreset } : {}),
            ...(cfg.skillId === "clip.captions" && cfg.captionAlign ? { captionAlign: cfg.captionAlign } : {}),
            ...(cfg.skillId === "clip.captions" && typeof cfg.captionYPct === "number" ? { captionYPct: cfg.captionYPct } : {}),
            // Dynamic Captions owns the ON-VIDEO caption text instruction (language /
            // casing / emojis). clip.captionstyle still carries it as a legacy fallback.
            ...(cfg.skillId === "clip.captions" && cfg.captionPrompt ? { captionPrompt: cfg.captionPrompt } : {}),
            ...(cfg.skillId === "clip.captionstyle" && cfg.captionPrompt ? { captionPrompt: cfg.captionPrompt } : {}),
            // Smart Framing: the chosen reframe mode (auto/pan/zoom/full).
            ...(cfg.skillId === "clip.facetrack" && cfg.framingMode ? { framingMode: cfg.framingMode } : {}),
            ...(cfg.skillId === "clip.zoom" && cfg.zoomStyle ? { zoomStyle: cfg.zoomStyle } : {}),
            // Viral Sticker: box style + position + optional text steer.
            ...(cfg.skillId === "clip.sticker"
              ? {
                  ...(cfg.stickerStyleId ? { stickerStyleId: cfg.stickerStyleId } : {}),
                  ...(cfg.stickerPosition ? { stickerPosition: cfg.stickerPosition } : {}),
                  ...(cfg.stickerPrompt ? { stickerPrompt: cfg.stickerPrompt } : {}),
                }
              : {}),
            // Brain Rot: gameplay layout + bg id (incl. "random"). Without this the
            // floor's config.bgId is never populated and the composite never fires.
            ...(cfg.skillId === "clip.brainrot"
              ? {
                  ...(cfg.bgLayout ? { bgLayout: cfg.bgLayout } : {}),
                  ...(cfg.bgId ? { bgId: cfg.bgId } : {}),
                }
              : {}),
            // Meme & Reaction SFX: a trending sound (audioUrl) OR a curated SFX (sfxId) + gain.
            // sfxPackId picks the reaction-SFX PACK; the AI still auto-picks the sting by emotion.
            ...(cfg.skillId === "clip.memeaudio"
              ? {
                  ...(cfg.audioUrl ? { audioUrl: cfg.audioUrl } : {}),
                  ...(cfg.audioId ? { audioId: cfg.audioId } : {}),
                  ...(cfg.sfxId ? { sfxId: cfg.sfxId } : {}),
                  ...(cfg.sfxPackId ? { sfxPackId: cfg.sfxPackId } : {}),
                  ...(typeof cfg.gainDb === "number" ? { gainDb: cfg.gainDb } : {}),
                }
              : {}),
            // Trending Audio: picked track + auto-by-mood flag + bed gain (floor emits
            // audio_overlay). autoMusic synced as a boolean so an explicit OFF persists.
            ...(cfg.skillId === "clip.trendingaudio"
              ? {
                  ...(cfg.musicTrackId ? { musicTrackId: cfg.musicTrackId } : {}),
                  ...(typeof cfg.autoMusic === "boolean" ? { autoMusic: cfg.autoMusic } : {}),
                  ...(typeof cfg.gainDb === "number" ? { gainDb: cfg.gainDb } : {}),
                  ...(cfg.customAudioUrl ? { customAudioUrl: cfg.customAudioUrl } : {}),
                }
              : {}),
            // Overlay Image: the operator's uploaded image + placement (floor emits
            // image_overlay). A bare node with no image stays inert.
            ...(cfg.skillId === "clip.overlayimage"
              ? {
                  ...(cfg.overlayImageUrl ? { overlayImageUrl: cfg.overlayImageUrl } : {}),
                  ...(cfg.overlayMode === "overlay" || cfg.overlayMode === "frame" ? { overlayMode: cfg.overlayMode } : {}),
                  ...(cfg.overlayPosition === "overlay" || cfg.overlayPosition === "top" || cfg.overlayPosition === "bottom"
                    ? { overlayPosition: cfg.overlayPosition }
                    : {}),
                  ...(typeof cfg.overlayOpacity === "number" ? { overlayOpacity: cfg.overlayOpacity } : {}),
                  ...(typeof cfg.overlayScale === "number" ? { overlayScale: cfg.overlayScale } : {}),
                }
              : {}),
            // Video Filters: preset + saturation/brightness (floor emits color_filter).
            ...(cfg.skillId === "clip.filters"
              ? {
                  ...(cfg.filterPreset ? { filterPreset: cfg.filterPreset } : {}),
                  ...(typeof cfg.filterSaturation === "number" ? { filterSaturation: cfg.filterSaturation } : {}),
                  ...(typeof cfg.filterBrightness === "number" ? { filterBrightness: cfg.filterBrightness } : {}),
                }
              : {}),
            // Auto Hook: the duration + design template picked in the inspector
            // (server's buildSkillFloor/applyHookStyle burn it onto the hook).
            ...(cfg.skillId === "clip.hook"
              ? {
                  ...(cfg.hookDurationSec !== undefined ? { hookDurationSec: cfg.hookDurationSec } : {}),
                  ...(cfg.hookAlwaysOn === true ? { hookAlwaysOn: true } : {}),
                  ...(cfg.hookTemplateId ? { hookTemplateId: cfg.hookTemplateId } : {}),
                  ...(cfg.hookPosition ? { hookPosition: cfg.hookPosition } : {}),
                  ...(cfg.hookCustomDesign && typeof cfg.hookCustomDesign === "object" ? { hookCustomDesign: cfg.hookCustomDesign } : {}),
                  ...(cfg.hookPrompt ? { hookPrompt: cfg.hookPrompt } : {}),
                  ...(cfg.hookLanguage ? { hookLanguage: cfg.hookLanguage } : {}),
                }
              : {}),
            // Hook Title Card: the slate design template + hold duration picked in
            // the inspector (server's applyTitleStyle burns it onto the title_card).
            ...(cfg.skillId === "clip.title"
              ? {
                  ...(cfg.titleTemplateId ? { titleTemplateId: cfg.titleTemplateId } : {}),
                  ...(cfg.titleDurationSec !== undefined ? { titleDurationSec: cfg.titleDurationSec } : {}),
                  ...(cfg.titlePrompt ? { titlePrompt: cfg.titlePrompt } : {}),
                }
              : {}),
            name: cfg.skillName || meta?.name || cfg.skillId,
            // Prompt-to-Clip carries the OPERATOR'S prompt (typed in the node
            // inspector) instead of skill markdown - it steers moment selection.
            instructions:
              cfg.skillId === "clip.prompt"
                ? (cfg.prompt ?? "").trim()
                : meta?.instructions || CLIP_SKILL_BY_ID[cfg.skillId]?.markdownTemplate || "",
          };
        })
        .filter((s) => s.instructions);
      if (skills.length > 0) log(`Skills wired in: ${skills.map((s) => s.name).join(", ")}`);
      const promptSkill = skills.find((s) => s.skillId === "clip.prompt");
      if (promptSkill) log(`Prompt targeting: "${promptSkill.instructions.slice(0, 80)}"`);
      if (clipFeel !== "any") log(`Clip feel: ${clipFeel} - matching moments rank first`);
      if (genre !== "auto") log(`Genre: ${genre} - virality scores re-weighted for this content type`);
      if (autoPlan) log("Let AI decide - using the analyzer's natural windows + moment count");
      if (sources.length > 1) log(`Multi-source run - ${sources.length} videos`);

      // 1-2. Per source: download → transcribe → plan. Plans from every source
      // are pooled, then the best clips across ALL sources are rendered.
      const allPlans: SourcedPlan[] = [];
      // One-off source blobs minted this run (audio-first + segment downloads) -
      // deleted at run end once all clips are rendered. Drive sources are skipped
      // (not ours); the direct-.mp4 async path's storageId isn't available
      // client-side, so those aren't collected here (known deferred leak).
      const downloadedSourceIds: string[] = [];
      const transcriptTexts: string[] = []; // pooled text for Campaign Scout matching
      const perSrc = 60 / sources.length;
      for (const [si, sourceUrl] of sources.entries()) {
        // Aborted between sources → stop pooling more sources.
        if (ac.signal.aborted) throw new DOMException("Run aborted", "AbortError");
        try {
        const base = 5 + si * perSrc;
        setKind("source", "running");
        log(`Source ${si + 1}/${sources.length} - ${sourceUrl.slice(0, 70)}`);
        const cachedVideo = await convex.query(api.downloadCache.getByKey, { sourceUrl, mode: "full", sectionKey: "" }).catch(() => null);
        const social = isSocialUrl(sourceUrl) && !cachedVideo?.url;
        let dl: Record<string, unknown> = {};

        if (cachedVideo?.url) {
          dl = { url: cachedVideo.url, durationSeconds: cachedVideo.durationSeconds ?? 0 };
          progress(Math.round(base), `Using your downloaded video — source ${si + 1}/${sources.length}`);
        } else if (isConvexStorageUrl(sourceUrl)) {
          // ── UPLOADED FILE: the source is already a Convex storage object. Skip
          // download-start entirely - re-fetching it just to re-store a second
          // (leaked) copy is pure waste. transcribe-clip reads this URL directly.
          // durationSeconds is unknown here (0) → the transcript-timeline rescale
          // guard (realDur > 10) is skipped, which is fine for a real STT pass.
          progress(Math.round(base), `Source ${si + 1}/${sources.length} - uploaded file (already stored)…`);
          dl = { url: sourceUrl, durationSeconds: 0 };
          log("  uploaded source - already in Convex storage; skipping re-download");
        } else if (social) {
          // ── AUDIO-FIRST (social URLs): clip-worthiness is decided purely from
          // the transcript, so pull only the audio (a few MB even for an hour)
          // now and download each chosen clip's VIDEO segment later. ~10× less
          // data than the whole video → no proxy timeouts.
          progress(Math.round(base), `Downloading audio - source ${si + 1}/${sources.length}…`);
          log("  audio-first: pulling audio only (fast); clip video segments come after moment selection");
          const aud = await postJSON("/api/video/download", { sourceUrl, mode: "audio", ...(mintAddress ? { mintAddress } : {}) });
          dl = { url: aud.url, durationSeconds: aud.durationSeconds };
          // GC the one-off source blob at run end (not Drive - those aren't ours).
          if (aud.storageId && !isDriveUrl(sourceUrl)) downloadedSourceIds.push(String(aud.storageId));
          log(`  audio ready - ${Math.round(Number(dl.durationSeconds) || 0)}s`);
          // Fire-and-forget full-video pull, purely so the Editor's Videos tab
          // (and re-runs) have a real cached video to preview/select — the
          // audio-first algorithm above is untouched and never waits on this.
          // downloadAndStore dedupes on [sourceUrl, mode] server-side, so a
          // second run against the same source is a cheap cache-hit, not a
          // re-download. Never surfaces as a run error either way.
          if (!isDriveUrl(sourceUrl)) {
            void postJSON("/api/video/download-start", { sourceUrl, mode: "full", ...(mintAddress ? { mintAddress } : {}) }).catch(() => {});
          }
        } else {
        progress(Math.round(base), `Downloading source ${si + 1}/${sources.length}…`);
        // Async download: long YouTube videos through the residential proxy
        // exceed a single request's timeout, so kick it off and poll. The rest
        // of the pipeline runs on the fast Convex storage URL.
        const startRes = await postJSON("/api/video/download-start", { sourceUrl, ...(mintAddress ? { mintAddress } : {}) });
        const dlJobId = String(startRes.jobId ?? "");
        // No jobId → the async kickoff failed; polling status with an empty id
        // would 400 for the full 30-min ceiling. Fail fast instead.
        if (!dlJobId) throw new Error("download-start returned no jobId - async download unavailable");
        const token = accessTokenRef.current;
        const POLL_MS = 4000;
        const MAX_POLLS = 600; // ~40 min hard ceiling (stall detection ends a dead proxy far sooner)
        const STALL_POLLS = 25; // ~100s with no % movement while downloading → give up
        const fmtMB = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1);
        let lastPct = -1;
        let stalled = 0;
        for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
          // Aborted mid-download → stop polling. (DOMException AbortError is
          // treated as an intentional stop by the catch below, like a fetch abort.)
          if (ac.signal.aborted) throw new DOMException("Run aborted", "AbortError");
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (ac.signal.aborted) throw new DOMException("Run aborted", "AbortError");
          const sres = await fetch(`/api/video/download-status?jobId=${encodeURIComponent(dlJobId)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: ac.signal,
          });
          const sj = (await sres.json().catch(() => ({}))) as { status?: string; url?: string; durationSeconds?: number; error?: string; progress?: { pct: number; downloadedBytes: number; totalBytes: number; speed?: string } };
          if (sj.status === "done") { dl = { url: sj.url, durationSeconds: sj.durationSeconds }; break; }
          if (sj.status === "error") throw new Error(`download failed: ${sj.error ?? "unknown"}`);
          const pr = sj.progress;
          if (pr && pr.totalBytes > 0) {
            // Real byte progress from yt-dlp.
            const label = `Downloading ${si + 1}/${sources.length} - ${fmtMB(pr.downloadedBytes)} MB / ${fmtMB(pr.totalBytes)} MB (${Math.round(pr.pct)}%)${pr.speed ? ` at ${pr.speed}` : ""}`;
            useClippingStore.getState().setRunProgress({ pct: Math.round(base + perSrc * 0.4 * (pr.pct / 100)), label });
            if (attempt % 8 === 7) log(`  ${label}`); // milestone line every ~32s (don't flood)
            // Stall watch - only while actively downloading (pct < 100; the merge
            // phase emits no progress and would false-positive). A % drop marks a
            // new stream (video→audio), so reset rather than count it.
            if (pr.pct < 100) {
              if (pr.pct > lastPct) { stalled = 0; lastPct = pr.pct; }
              else if (pr.pct < lastPct) { lastPct = pr.pct; stalled = 0; }
              else if (++stalled >= STALL_POLLS) throw new Error(`download stalled - no progress for ${(STALL_POLLS * POLL_MS) / 1000}s (proxy or source issue). Try a shorter video or a direct .mp4 link.`);
            }
          } else if (attempt % 8 === 7) {
            // No byte counts yet (resolving formats, or merging streams) - show elapsed.
            progress(Math.round(base), `Downloading source ${si + 1}/${sources.length}… (${(attempt * POLL_MS) / 1000}s)`);
          }
        }
        if (!dl.url) throw new Error("download timed out (40 min ceiling) - source too long. Try a shorter video or a direct .mp4 link.");
        log(`  ready - ${Math.round(Number(dl.durationSeconds) || 0)}s, stored to Convex`);
        } // end full-download (non-social) branch
        // Source stays "running" through transcribe + find-moments (no Compose node).
        progress(Math.round(base + perSrc * 0.4), `Transcribing source ${si + 1}/${sources.length}…`);
        // sourceUrl = original video (cache key); audioUrl = the downloaded copy.
        // Feature E: tag campaignSource by PROVENANCE - true iff this source node
        // picked the URL from a campaign dropdown (campaignId set). The route caches
        // ONLY when this flag is true, so identical URLs cache-or-not purely on
        // whether they came from a campaign vs a user paste/upload.
        const srcCampaignId = campaignByUrl.get(sourceUrl);
        const srcRewardId = rewardByUrl.get(sourceUrl);
        // campaignSource (cacheable) is true for EITHER provenance - a Convex
        // campaign OR a Stage content_reward. campaignId is passed only when the
        // Convex provenance is present (the route ignores contentRewardId; caching
        // only needs the boolean), so a reward source still caches via the flag.
        log(`  ⏳ extracting transcription…${srcCampaignId || srcRewardId ? " (campaign source - caches to shared DB)" : ""}`);
        const stt = await postJSON("/api/video/transcribe-clip", {
          sourceUrl,
          audioUrl: dl.url as string,
          campaignSource: !!srcCampaignId || !!srcRewardId,
          ...(srcCampaignId ? { campaignId: srcCampaignId } : {}),
          // Skills-only pricing: transcription compute is absorbed (charged via
          // the wired skills at run start), so no per-step billing here.
        }).catch(
          (e) => {
            const msg = e instanceof Error ? e.message : "error";
            if (/needs funding|spend cap/i.test(msg)) throw e; // billing stop, not a degrade
            log(`  ✗ transcription failed (${msg}) - captions/moment-picking degraded`);
            return {} as Record<string, unknown>;
          },
        );
        let sttSegments = (Array.isArray(stt.segments) ? stt.segments : []) as Seg[];
        let sttWords = (Array.isArray(stt.words) ? stt.words : []) as Word[];
        const realDur = Number(dl.durationSeconds) || 0;
        // Rescale compressed best-effort STT timelines to the real duration.
        const maxT = Math.max(sttSegments.at(-1)?.end ?? 0, sttWords.at(-1)?.end ?? 0);
        if (realDur > 10 && maxT > 0 && maxT < realDur * 0.6) {
          const k = realDur / maxT;
          sttSegments = sttSegments.map((s) => ({ ...s, start: s.start * k, end: s.end * k }));
          sttWords = sttWords.map((w) => ({ ...w, start: w.start * k, end: w.end * k }));
          log(`WARN transcript timeline compressed (${Math.round(maxT)}s vs real ${Math.round(realDur)}s) - rescaled ×${k.toFixed(1)}`);
        }
        const transcript = { segments: sttSegments, words: sttWords, durationSeconds: Number(realDur || (stt.durationSeconds as number) || 0) };
        transcriptTexts.push(sttSegments.map((s) => s.text).join(" "));
        log(
          transcript.words.length > 0
            ? `  ✓ transcription done - ${transcript.segments.length} segments, ${transcript.words.length} words${stt.cached ? " (cache hit - $0)" : ""}`
            : "  ✗ transcript empty (no speech detected) - captions will be skipped",
        );
        const analysis = stt.analysis as { moments?: { title?: string; viralScore?: number; emotion?: string }[] } | undefined;
        if (analysis?.moments?.length) {
          const top = analysis.moments[0];
          log(`  analysis - ${analysis.moments.length} ranked moments · top: "${top.title}" (★${top.viralScore}, ${top.emotion})`);
        }
        progress(Math.round(base + perSrc * 0.8), `Planning source ${si + 1}/${sources.length}…`);
        const plan = await postJSON("/api/video/plan-moments", { transcript, clipConfig, skills, analysis, clipFeel, genre, autoPlan });
        const plans = (Array.isArray(plan.plans) && plan.plans.length > 0
          ? plan.plans
          : [{ moment: plan.moment, ops: plan.ops }]) as { moment: PlanMoment; ops: unknown }[];
        for (const p of plans) allPlans.push({ ...p, srcUrl: dl.url as string, srcOriginal: sourceUrl, words: transcript.words, segmentMode: social });
        } catch (e) {
          // A user abort (fetch AbortError / our DOMException) is an intentional
          // stop, not a bad source - re-throw so the run ends cleanly instead of
          // logging "source failed" and grinding through the remaining sources.
          if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
          // One bad source (dead link, private file…) must not kill the run -
          // log it and keep clipping the remaining sources.
          log(`WARN source ${si + 1} failed (${e instanceof Error ? e.message.slice(0, 100) : "error"}) - skipping it`);
        }
      }
      // Aborted after the source loop → stop before planning/cutting.
      if (ac.signal.aborted) throw new DOMException("Run aborted", "AbortError");
      if (allPlans.length === 0) throw new Error("No source could be processed - check the Source node URLs.");
      setKind("source", "done");

      // Pool the best clips across ALL sources (virality-ranked). "Let AI decide"
      // keeps however many strong moments the analyzer found; manual mode honors the
      // "Number of clips" slider (up to 60). NOTE: this is the LOCAL demo run — each
      // source's plan-moments call is itself capped LOW (server-synchronous edit
      // planning would 502 at 60), so the real per-source ceiling is enforced there;
      // the full requested count (up to 60) only materializes on the CLOUD run.
      const maxClips = autoPlan ? 30 : Math.min(60, Math.max(1, Number(clipConfig.maxClipsPerSource) || 1));
      const plans = [...allPlans]
        .sort((a, b) => (b.moment.viralScore ?? 0) - (a.moment.viralScore ?? 0))
        .slice(0, maxClips);
      if (!autoPlan && (Number(clipConfig.maxClipsPerSource) || 1) > plans.length) {
        log(`Local run capped at ${plans.length} clip(s), run on the cloud for the full requested count (up to 60, via per-moment variations).`);
      }

      // 3. Cut each planned clip. The slow part is the per-clip segment download
      // through the proxy (segment-mode/social), so run those in a small pool -
      // the proxy is confirmed to tolerate 3 concurrent. Full-mode (direct/Drive)
      // re-fetches the whole video per clip, so keep it sequential to avoid
      // loading a large file N times at once (RAM).
      activeKind = "skill";
      setKind("skill", "running");
      type ClipItem = { clipUrl: string; title?: string; durationSeconds?: number; viralScore?: number; emotion?: string; reason?: string; captionText?: string; startSeconds?: number; endSeconds?: number; sourceUrl?: string; createdAt?: number };
      const CONCURRENCY = plans.length > 0 && plans.every((p) => p.segmentMode) ? 3 : 1;
      const results: (ClipItem | null)[] = new Array(plans.length).fill(null);
      useClippingStore.setState({ runClips: plans.map((p, i) => ({ id: `local-${i}`, title: p.moment.title || `Clip ${i + 1}`, status: "rendering" })) });
      let completed = 0;
      // Holds a billing-stop Error or a user-abort (AbortError DOMException) -
      // either ends the whole clip pool. `unknown` so a DOMException fits too.
      let abortErr: unknown = null;
      // Per-clip render errors (the real ffmpeg/route message) so a total failure
      // surfaces the actual cause instead of a generic "see the warnings above".
      const failures: string[] = [];
      log(`Plan ready - ${plans.length} clip${plans.length > 1 ? "s" : ""} pooled from ${sources.length} source${sources.length > 1 ? "s" : ""} (ranked by virality)${CONCURRENCY > 1 ? ` · ${CONCURRENCY} in parallel (log lines may interleave)` : ""}`);
      // Say so rather than silently cutting from the source: bypass replaces the
      // BODY of the video, which this draft preview path doesn't do (a minted
      // agent's run goes through the cloud pipeline, which honors it).
      if ((clipConfig as { mainOnly?: boolean }).mainOnly) {
        log("  note: \"No clip / UGC needed\" applies on the cloud pipeline (minted agents). This draft preview still cuts from the source; the hook video is applied.");
      }

      const renderOne = async (p: SourcedPlan, i: number): Promise<void> => {
        if (abortErr || ac.signal.aborted) return;
        try {
          const opNames = Array.isArray(p.ops) ? (p.ops as { op: string }[]).map((o) => o.op).join(", ") : "?";
          const score = p.moment.viralScore != null ? ` ★${p.moment.viralScore}` : "";
          log(`  clip ${i + 1}:${score} "${p.moment.title ?? "Highlight"}" ${p.moment.startSeconds}-${p.moment.endSeconds}s · ops: ${opNames}`);

          // Cut source. Audio-first (segmentMode): download just THIS clip's video
          // window now and cut from the trimmed segment, which starts at 0 - pass
          // start=0 and offset the words onto the segment timeline (ops are
          // already clip-relative). Full mode: cut from the whole video at the
          // moment's absolute timestamps.
          let cutSourceUrl = p.srcUrl;
          let cutStart = p.moment.startSeconds;
          let cutEnd = p.moment.endSeconds;
          let cutWords = p.words;
          if (p.segmentMode) {
            // YouTube bot-checks / 403s some segments through the rotating proxy.
            // A retry usually lands on a fresh exit IP that passes - try a couple
            // times before giving up (the per-clip catch then skips just this one).
            let seg: Record<string, unknown> | null = null;
            for (let attempt = 0; attempt < 3 && !seg; attempt++) {
              try {
                seg = await postJSON("/api/video/download", { sourceUrl: p.srcOriginal, mode: "segment", start: p.moment.startSeconds, end: p.moment.endSeconds, ...(mintAddress ? { mintAddress } : {}) });
              } catch (segErr) {
                // Don't retry a user abort - bubble it straight up.
                if (ac.signal.aborted || (segErr instanceof Error && segErr.name === "AbortError")) throw segErr;
                if (attempt === 2) throw segErr;
                log(`  clip ${i + 1} segment retry ${attempt + 1}/2 - ${segErr instanceof Error ? segErr.message.slice(0, 60) : "error"}`);
                await new Promise((r) => setTimeout(r, 2500)); // brief pause → fresh proxy exit IP
              }
            }
            cutSourceUrl = seg!.url as string;
            // GC this segment's one-off source blob at run end (not Drive).
            if (seg!.storageId && !isDriveUrl(p.srcOriginal)) downloadedSourceIds.push(String(seg!.storageId));
            cutEnd = Number(seg!.durationSeconds) > 0 ? Number(seg!.durationSeconds) : (p.moment.endSeconds - p.moment.startSeconds);
            cutStart = 0;
            cutWords = p.words
              .filter((w) => w.end > p.moment.startSeconds && w.start < p.moment.endSeconds)
              .map((w) => ({ ...w, start: +(w.start - p.moment.startSeconds).toFixed(3), end: +(w.end - p.moment.startSeconds).toFixed(3) }));
          }
          if (abortErr || ac.signal.aborted) return;
          // Hook Videos app: cycle the operator's uploads across this run's clips
          // (the canvas has no transcript cache to match against — the cloud path
          // does the contextual pick). Sent to the route, which stitches it in FRONT
          // of the cut so overlays burn over the hook, same as the cloud render.
          const hookPool = (clipConfig as { hookVideos?: string[] }).hookVideos ?? [];
          const hookVideoUrl = hookPool.length ? hookPool[i % hookPool.length] : undefined;
          const cut = await postJSON("/api/video/clip", {
            sourceUrl: cutSourceUrl,
            startSeconds: cutStart,
            endSeconds: cutEnd,
            ops: p.ops,
            words: cutWords,
            width,
            height,
            ...(hookVideoUrl ? { hookVideoUrl } : {}),
            // Skills-only pricing: render compute is absorbed - the wired skills
            // were charged at run start (clip-precheck). billing identifies the
            // run so the route's never-trust-the-client backstop (#23) DEDUPS
            // its ops-derived skill charges against the precheck's idemKey
            // (`${runId}:skill:${skillId}`) instead of 402ing a billing-less
            // render. Drafts (sessionId, no mint) stay free.
            billing: mintAddress ? { mintAddress, runId } : sessionId ? { sessionId, runId } : undefined,
          });
          if (Array.isArray(cut.warnings)) for (const w of cut.warnings as string[]) log(`WARN ${w}`);
          // Keep the browser-orchestrated run identical to clip-batch-start:
          // Intro/Hook is prepended inside /api/video/clip so every overlay is
          // rendered over the assembled body, then CTA is appended last.
          let finalClipUrl = cut.clipUrl as string;
          const ctaVideo = (clipConfig as { ctaVideo?: string }).ctaVideo;
          if (ctaVideo) {
            const appended = await postJSON("/api/video/append-cta", {
              videoUrl: finalClipUrl,
              ctaUrl: ctaVideo,
              ...((clipConfig as { transition?: { id: string; durationSec: number } }).transition
                ? { transition: (clipConfig as { transition: { id: string; durationSec: number } }).transition }
                : {}),
            });
            finalClipUrl = appended.videoUrl as string;
          }
          results[i] = {
            clipUrl: finalClipUrl,
            title: p.moment.title,
            durationSeconds: Math.round(p.moment.endSeconds - p.moment.startSeconds),
            viralScore: p.moment.viralScore,
            emotion: p.moment.emotion,
            reason: p.moment.reason ?? "",
            captionText: p.moment.captionText ?? "",
            startSeconds: p.moment.startSeconds,
            endSeconds: p.moment.endSeconds,
            sourceUrl: p.srcOriginal,
            createdAt: Date.now(),
          };
          useClippingStore.setState((s) => ({ runClips: s.runClips.map((clip, index) => index === i ? { ...clip, status: "ready" } : clip) }));
          // Record each finished clip in this agent's History as it lands.
          addClipToHistory(mintKey, {
            id: finalClipUrl,
            clipUrl: finalClipUrl,
            title: p.moment.title || "Clip",
            durationSeconds: Math.round(p.moment.endSeconds - p.moment.startSeconds),
            sourceUrl: p.srcOriginal,
            ...(typeof p.moment.viralScore === "number" ? { viralScore: p.moment.viralScore } : {}),
            ...(p.moment.emotion ? { emotion: p.moment.emotion } : {}),
            status: "done",
            createdAt: Date.now(),
          });
          completed += 1;
          progress(70 + Math.round((completed / plans.length) * 30), `Rendered ${completed}/${plans.length} clip${plans.length > 1 ? "s" : ""}…`);
        } catch (e) {
          // A user abort stops the whole pool - surface it as abortErr (which
          // the loop below re-throws to the outer catch as an intentional stop),
          // never as a skipped clip.
          if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
            abortErr = e instanceof Error ? e : new DOMException("Run aborted", "AbortError");
            return;
          }
          const msg = e instanceof Error ? e.message : "error";
          // Billing stops abort the whole run; one bad segment/render just skips.
          useClippingStore.setState((s) => ({ runClips: s.runClips.map((clip, index) => index === i ? { ...clip, status: "failed", failReason: msg } : clip) }));
          if (/needs funding|spend cap|daily|suspended/i.test(msg)) { abortErr = e instanceof Error ? e : new Error(msg); return; }
          completed += 1;
          failures.push(msg);
          // Surface the REAL error (ffmpeg stderr tail / route message), not a
          // truncated stub - this is the line a user pastes when reporting a bug.
          log(`WARN clip ${i + 1} failed: ${msg.slice(0, 240)}`);
        }
      };

      // Bounded worker pool: shared cursor hands out clip indices.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, plans.length) }, async () => {
          while (cursor < plans.length && !abortErr) {
            const idx = cursor;
            cursor += 1;
            await renderOne(plans[idx], idx);
          }
        }),
      );
      if (abortErr) throw abortErr;
      // Keep virality order (results is index-aligned to the ranked plans).
      const items = results.filter((r): r is ClipItem => r !== null);
      if (items.length === 0) {
        throw new Error(
          failures.length
            ? `Every clip failed to render. First error: ${explainClipFailureLine(failures[0])}`
            : "Every clip failed to render - check the run log.",
        );
      }

      // Persist the finished batch to the Convex `clips` table (source of truth)
      // so it shows in the builder ClipsQueue, syncs across devices, and surfaces
      // on the public Creations tab. The mp4 bytes already live in Convex storage
      // (clipUrl); only the relational rows were missing. addClipToHistory above
      // is the same-browser fallback - DB is primary. Only minted agents persist:
      // the `clips` table is mint-keyed and the route ownership-checks the mint;
      // draft/session runs keep their localStorage history. Best-effort - a save
      // failure NEVER fails the run (postJSON attaches the Bearer token, and the
      // global fetch interceptor also adds Authorization + X-Siws-Session).
      if (mintAddress && items.length > 0) {
        try {
          await postJSON("/api/clips/record", {
            mintAddress,
            sourceUrl: sources[0] ?? "",
            clips: items.map((it) => ({
              title: it.title ?? "Clip",
              reason: it.reason ?? "",
              clipUrl: it.clipUrl,
              viralScore: typeof it.viralScore === "number" ? it.viralScore : 0,
              captionText: it.captionText ?? "",
              startSeconds: it.startSeconds ?? 0,
              endSeconds: it.endSeconds ?? 0,
            })),
          });
          log(`Saved ${items.length} clip${items.length > 1 ? "s" : ""} to your agent's library`);
        } catch (e) {
          log(`WARN could not save clips to library (${e instanceof Error ? e.message.slice(0, 80) : "error"}) - they're still downloadable below`);
        }
      }
      setKind("skill", "done");

      // 4. Surface the downloadable clip(s) on the Publish node (no upload).
      activeKind = "publish";
      setKind("publish", "done");
      const all = useClippingStore.getState().nodes;
      const sink = all.find((n) => n.data.kind === "publish") ?? all[all.length - 1];
      if (sink) {
        useClippingStore.getState().setNodeStatus(sink.id, "done", {
          output:
            items.length > 1
              ? { type: "clips", items }
              : { type: "clip", clipUrl: items[0].clipUrl, title: items[0].title, durationSeconds: items[0].durationSeconds, captionText: items[0].captionText },
        });
        useClippingStore.setState({ previewId: sink.id });
      }
      // 5. Campaign Scout: match the run's transcripts against the marketplace.
      let scoutMatch: { campaignId: string; title: string; platforms: string[] } | null = null;
      const scoutNode = graphNodes.find(
        (n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === "clip.campaignscout" && wired.has(n.id),
      );
      if (scoutNode) {
        const picked = ((scoutNode.data.config as { campaignIds?: string[] }).campaignIds ?? []);
        const pool = (campaignsRef.current ?? [])
          // campaigns.create writes status "open" - filtering on "active" alone
          // silently dropped every real campaign (Scout never matched in prod).
          .filter((cp) => ["open", "active"].includes(cp.status ?? "open"))
          .filter((cp) => picked.length === 0 || picked.includes(cp._id));
        const text = transcriptTexts.join(" ").toLowerCase();
        const scored = pool
          .map((cp) => {
            const terms = [
              ...(cp.targetNiche ?? []),
              ...String(cp.title ?? "").split(/\s+/),
              ...String(cp.brief ?? "").split(/\s+/).slice(0, 40),
            ]
              .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
              .filter((t) => t.length > 3);
            const hits = new Set(terms.filter((t) => text.includes(t)));
            return { cp, score: hits.size };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (scored.length > 0) {
          log(`Campaign Scout - ${scored.length} match${scored.length > 1 ? "es" : ""}:`);
          for (const s of scored) log(`  ⭐ "${s.cp.title}"${s.cp.targetNiche?.[0] ? ` (${s.cp.targetNiche[0]})` : ""} - ${s.score} keyword hits`);
          const top = scored[0].cp;
          scoutMatch = { campaignId: top._id, title: top.title, platforms: (top as { platforms?: string[] }).platforms ?? [] };
        } else {
          log(`Campaign Scout - no matching campaigns${pool.length === 0 ? " (none active)" : ""}`);
        }
      }

      const pubNode = graphNodes.find((n) => n.data.kind === "publish" && wired.has(n.id));
      // The Publish node is a thin destination marker now - it only carries the
      // per-pipeline `schedule` intent (publish vs save-only). Channels come from
      // the Posting tab (clipConfig.platforms), the single source of truth.
      const pubCfg = pubNode?.data.config as { schedule?: string } | undefined;
      // Posting channels from the persisted clipConfig: NON-EMPTY = those channels;
      // EMPTY/undefined = post to ALL connected accounts ("post everywhere").
      const cfgPlatformsRaw = (savedClipConfigRef.current as { platforms?: unknown } | undefined)?.platforms;
      const pubPlatforms: string[] = Array.isArray(cfgPlatformsRaw)
        ? (cfgPlatformsRaw as unknown[]).filter((p): p is string => typeof p === "string")
        : [];

      // 6a. END-TO-END AUTO-POST (LOCKED default OFF): when the PERSISTED per-agent
      // toggle is ON *and* ≥1 social account is connected, every finished run
      // auto-queues ALL clips (viralScore DESC, best first, none dropped) into the
      // existing 2h drip - no manual "Start drip" gate. Connecting alone never
      // posts: the toggle (consent) AND a live connection are both required.
      // Idempotent: only THIS run's clips are scheduled, and any clipUrl already
      // present in scheduledContent is skipped, so a re-fire never double-queues.
      let autoPosted = false;
      if (autoPostOnRef.current && mintAddress && items.length > 0) {
        try {
          const token = accessTokenRef.current;
          // (i) Connection check - connecting != consent; require ≥1 connected.
          let connectedPlatforms: string[] = [];
          try {
            const sres = await fetch(`/api/social/status?username=${encodeURIComponent(mintAddress)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const sdata = (await sres.json()) as { connected?: Record<string, unknown> };
            connectedPlatforms = Object.entries(sdata.connected ?? {}).filter(([, v]) => Boolean(v)).map(([k]) => k);
          } catch { /* treat as none connected → download-only fallback below */ }
          if (connectedPlatforms.length === 0) {
            log("Auto-post ON but no social connected - clips stay as downloads; connect an account in the Posting tab");
          } else {
            // (ii) Campaign Hunter: if Scout matched, gate auto-submit on the real
            // join requirements (skills + a connected platform the campaign accepts).
            let autoCampaign: { campaignId: string; title: string; platform?: string } | undefined;
            if (scoutMatch) {
              const elig = evaluateCampaignEligibility({
                installedSkills: installedSkillIdsRef.current,
                connectedPlatforms,
                campaignPlatforms: scoutMatch.platforms,
              });
              if (elig.eligible) {
                // Post to the campaign's accepted platform (mirror the drip path) -
                // otherwise empty pubPlatforms fans the campaign post out to ALL
                // connected accounts (off-platform brand posts).
                autoCampaign = { campaignId: scoutMatch.campaignId, title: scoutMatch.title, platform: preferredPostPlatform(elig) ?? undefined };
                log(`Campaign Hunter armed - auto-posts will submit to "${scoutMatch.title}"${autoCampaign.platform ? ` on ${autoCampaign.platform}` : ""}`);
              } else {
                log(`WARN campaign auto-submit skipped: ${elig.guidance}`);
              }
            }
            // (iii) Idempotency: build a Set of clipUrls already queued/posting/
            // posted from the live scheduledContent query so a re-run or a hydrate
            // never double-schedules the same clip (/api/schedule/create has no
            // dedup - the schedule mutation always inserts). Cancelled/failed rows
            // don't block re-queueing.
            const scheduledUrls = new Set<string>();
            for (const r of scheduledRowsRef.current ?? []) {
              if (r.videoUrl && r.status !== "cancelled" && r.status !== "failed") scheduledUrls.add(r.videoUrl);
            }
            // (iv) Read the persisted clipConfig (Posting tab) once: order mode +
            // spacing/cap + optional daily start. Both schedulers share these via
            // orderClips/computeScheduleTimes so the manual DripBar and this auto
            // path can't drift.
            const cfg = savedClipConfigRef.current as {
              postIntervalMs?: number; maxPerDay?: number; postOrder?: PostOrder;
              dailyStartHour?: number; dailyStartMinute?: number; timezone?: string;
            } | undefined;
            // Order ALL clips by the chosen mode (default best/viralScore) - none dropped.
            const ordered = orderClips(items, cfg?.postOrder ?? "best");
            // Captions are auto-generated per clip from its transcript (content-aware);
            // the Publish node no longer carries a caption override. Empty → use the
            // clip's own captionText; when THAT is empty the source had nothing to
            // transcribe → post BARE (no generic auto-caption, no "Clip N" placeholder).
            const caption = "";
            const authHeaders = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
            const intervalMs = cfg?.postIntervalMs ?? DRIP_STAGGER_MS;
            const maxPerDay = cfg?.maxPerDay ?? 0;
            const nowMs = Date.now();
            // Resolve the operator's scheduling zone once (Posting tab; default =
            // browser zone) - used for BOTH the existingPerDay day-bucketing and the
            // computeScheduleTimes slot math so the cap seed can't drift from the
            // slots it seeds (the host-local-vs-agent-zone seam this once had).
            const scheduleTz = cfg?.timezone ?? browserTimeZone();
            // Seed existingPerDay (index 0 = today, 1 = tomorrow…) from the live
            // scheduledContent rows so a re-run respects the daily cap. Counts any
            // not-cancelled/failed row on TODAY-or-later - INCLUDING ones whose slot
            // time already elapsed but are still 'scheduled'/'posting' (the cron lags
            // up to 5 min); past-DAY rows are dropped. Buckets by scheduleTz so the
            // seed and the slots agree. Shared with the manual DripBar via
            // existingPerDayFromRows so the two posting paths can't drift.
            const existingPerDay = existingPerDayFromRows(scheduledRowsRef.current ?? [], nowMs, scheduleTz);
            // Clips actually needing a fresh slot (skip ones already queued) - compute
            // exactly that many times up front so HTTP failures don't burn slots.
            const toQueue = ordered.filter((it) => !scheduledUrls.has(it.clipUrl));
            const times = computeScheduleTimes(toQueue.length, {
              intervalMs,
              maxPerDay,
              ...(maxPerDay > 0 ? { existingPerDay } : {}),
              now: nowMs,
              // Honor the operator's chosen scheduling zone (Posting tab) so the
              // REAL queued scheduledFor uses the same daily-start + day-bucketing
              // as the calendar forecast. Default = the browser's zone.
              timeZone: scheduleTz,
              ...(cfg?.dailyStartHour !== undefined
                ? { dailyStartHour: cfg.dailyStartHour, dailyStartMinute: cfg.dailyStartMinute }
                : {}),
            });
            let queued = 0;
            let timeIdx = 0;
            for (const it of ordered) {
              // Skip clips already queued in scheduledContent (the DB Set is the
              // cross-device idempotency guard; the addClipToHistory write below,
              // status:"scheduled", is the same-browser marker like DripBar's).
              if (scheduledUrls.has(it.clipUrl)) continue;
              const res = await fetch("/api/schedule/create", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                  mintAddress,
                  sessionId,
                  scheduledFor: times[timeIdx] ?? (nowMs + (timeIdx + 1) * intervalMs),
                  topic: it.title || "Clip",
                  caption: caption || it.captionText || "",
                  // A matched campaign posts to ITS accepted platform; otherwise the
                  // Publish node's chosen channels (EMPTY => all connected).
                  platforms: autoCampaign?.platform ? [autoCampaign.platform] : pubPlatforms,
                  videoUrl: it.clipUrl,
                  ...(autoCampaign ? { campaignId: autoCampaign.campaignId } : {}),
                }),
              });
              if (!res.ok) {
                log(`WARN auto-post: could not queue "${it.title ?? "clip"}" (HTTP ${res.status})`);
                // Don't burn this slot - the next queued clip reuses this time index.
                continue;
              }
              timeIdx += 1;
              scheduledUrls.add(it.clipUrl);
              addClipToHistory(mintKey, {
                id: it.clipUrl,
                clipUrl: it.clipUrl,
                title: it.title || "Clip",
                durationSeconds: it.durationSeconds ?? 0,
                sourceUrl: it.sourceUrl ?? sources[0] ?? "",
                status: "scheduled",
                createdAt: Date.now(),
              });
              queued += 1;
            }
            if (queued > 0) {
              autoPosted = true;
              const cadence = `one every ${formatInterval(intervalMs)}${maxPerDay > 0 ? `, max ${maxPerDay}/day` : ""}`;
              log(`Auto-posting ON - queued ${queued} clip${queued > 1 ? "s" : ""}, ${cadence}, best first${autoCampaign ? ` · submitting to "${autoCampaign.title}"` : ""}`);
            } else {
              log("Auto-post ON - all clips from this run were already queued (nothing new to schedule)");
            }
          }
        } catch (e) {
          // Auto-post is best-effort - a scheduling failure must never fail the run
          // (the clips are still rendered + downloadable + in the library).
          log(`WARN auto-post failed (${e instanceof Error ? e.message.slice(0, 100) : "error"}) - clips stay as downloads`);
        }
      }

      // 6b. MANUAL drip mode (auto-post OFF): Publish node set to "scheduled" → arm
      // the preview dialog with drip controls (reorder, then "Start drip"). The
      // operator picks the posting ORDER before anything is queued. Skipped when
      // auto-post already queued this run so the two paths never double-schedule.
      if (!autoPostOnRef.current && !autoPosted && pubCfg?.schedule === "scheduled" && items.length > 0) {
        if (!mintAddress) {
          log("WARN drip posting needs a MINTED agent (posting profile is keyed to the mint) - clips stay as downloads");
        } else {
          // Campaign Hunter: when Scout matched a campaign, gate on the real
          // join requirements (skills + a connected platform the campaign
          // accepts). Eligible → drip posts AUTO-SUBMIT to it; ineligible →
          // plain drip + tell the operator exactly what's missing. Never block.
          let campaign: { campaignId: string; title: string; platforms: string[] } | undefined;
          // Default campaign post platform = the first configured channel (Posting tab),
          // else tiktok; a matched campaign overrides it with its accepted platform below.
          let platform = pubPlatforms[0] || "tiktok";
          if (scoutMatch) {
            let connectedPlatforms: string[] = [];
            try {
              const token = accessTokenRef.current;
              const sres = await fetch(`/api/social/status?username=${encodeURIComponent(mintAddress)}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              const sdata = (await sres.json()) as { connected?: Record<string, unknown> };
              connectedPlatforms = Object.entries(sdata.connected ?? {}).filter(([, v]) => Boolean(v)).map(([k]) => k);
            } catch { /* treat as none connected */ }
            const elig = evaluateCampaignEligibility({
              installedSkills: installedSkillIdsRef.current,
              connectedPlatforms,
              campaignPlatforms: scoutMatch.platforms,
            });
            if (elig.eligible) {
              campaign = scoutMatch;
              platform = preferredPostPlatform(elig) ?? platform;
              log(`Campaign Hunter armed - drip posts will auto-submit to "${scoutMatch.title}" on ${platform}`);
            } else {
              log(`WARN campaign auto-submit skipped: ${elig.guidance}`);
            }
          }
          // Thread the persisted spacing/cap into the drip so DripBar's
          // computeScheduleTimes matches the canvas auto-scheduler exactly.
          const dripCfg = savedClipConfigRef.current as {
            postIntervalMs?: number; maxPerDay?: number; postOrder?: PostOrder;
            dailyStartHour?: number; dailyStartMinute?: number; timezone?: string;
          } | undefined;
          useClippingStore.getState().setDripContext({
            mintAddress,
            sessionId,
            platform,
            // A campaign match posts to its single accepted platform; otherwise
            // use the Publish node's chosen channels (empty = all connected).
            platforms: campaign ? [platform] : pubPlatforms,
            caption: "",
            mintKey,
            postIntervalMs: dripCfg?.postIntervalMs ?? DRIP_STAGGER_MS,
            maxPerDay: dripCfg?.maxPerDay ?? 0,
            postOrder: dripCfg?.postOrder ?? "best",
            timezone: dripCfg?.timezone ?? browserTimeZone(),
            ...(dripCfg?.dailyStartHour !== undefined
              ? { dailyStartHour: dripCfg.dailyStartHour, dailyStartMinute: dripCfg.dailyStartMinute }
              : {}),
            ...(campaign ? { campaign } : {}),
          });
          log("Drip armed - reorder the clips in the preview, then press 'Start drip'");
        }
      }

      log(`Done - ${items.length} clip${items.length > 1 ? "s" : ""} ready`);
      useClippingStore.setState({ runStatus: "done", runProgress: null });

      // Uploaded sources are transient - delete the source blobs now that the
      // clips are rendered (only the clips are kept). Best-effort.
      const cleaned = cleanupUploadedSources();
      if (cleaned) log(`Cleaned up ${cleaned} uploaded source file${cleaned > 1 ? "s" : ""} - only clips kept`);

      // Downloaded one-off sources (audio-first + segment blobs we minted this
      // run) are transient too - delete them now that all clips are rendered.
      // Best-effort; Drive sources were already excluded above. The direct-.mp4
      // async-path (download-start) source blob isn't reachable client-side -
      // that's a known deferred leak, not handled here.
      for (const sid of downloadedSourceIds) {
        try { await deleteSourceBlob(sid); } catch {}
      }

      // Best-effort on-chain settle of the run's tab (hourly settleDueTabs cron
      // is the backstop). Fire-and-forget - settlement must never fail a run.
      if (mintAddress) {
        const token = accessTokenRef.current;
        void fetch("/api/economy/settle-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ mintAddress }),
        }).then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { status?: string; amountUsdc?: number; tabUsdc?: number };
          if (j.status === "settled") log(`Tab settled on-chain - $${j.amountUsdc?.toFixed(2)} swept to treasury`);
          else if (j.status === "accruing" && (j.tabUsdc ?? 0) > 0) log(`Tab accruing - $${j.tabUsdc?.toFixed(2)} unsettled`);
        }).catch(() => {});
      }
    } catch (e) {
      // User abort: abortRun() already reset the UI to a clean idle state and
      // logged "Run aborted by user". An abort is NOT a failed run, so don't
      // light up the error node / error pill / runError here.
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      setKind(activeKind, "error");
      log(`ERROR (${activeKind}): ${e instanceof Error ? e.message : String(e)}`);
      useClippingStore.setState({ runStatus: "error", runProgress: null });
      setRunError(e instanceof Error ? e.message : "Clip run failed");
      // A failed run must not strand the uploaded source blob in storage - the
      // success-path cleanup above never ran. (User aborts already returned.)
      cleanupUploadedSources();
    } finally {
      // Release this run's controller (unless a newer run already replaced it).
      if (runAbortRef.current === ac) runAbortRef.current = null;
    }
  }, [resetRun, mintKey, mintAddress, sessionId, convex, setRunError]);

  // Drain canvas ops queued by the builder chat (canvas_* agentActions). Runs
  // only once hydrated so a queued op never races the localStorage graph load,
  // and never mid-run - ops queued during a run apply when it finishes (the
  // runStatus dep re-fires the effect).
  const pendingChatOps = useClippingStore((s) => s.pendingChatOps);
  const liveRunStatus = useClippingStore((s) => s.runStatus);
  useEffect(() => {
    if (!hydrated.current || pendingChatOps.length === 0 || liveRunStatus === "running") return;
    const st = () => useClippingStore.getState();
    const ops = st().takeChatOps();
    const byTitle = (title: string) => {
      const t = title.trim().toLowerCase();
      return (
        st().nodes.find((n) => n.data.title.toLowerCase() === t) ??
        st().nodes.find((n) => n.data.title.toLowerCase().includes(t))
      );
    };
    const sourceNode = () => st().nodes.find((n) => n.data.kind === "source");
    const clampLen = (v: number) => Math.min(90, Math.max(5, Math.round(v)));
    let structural = false;
    let wantRun = false;

    for (const o of ops) {
      switch (o.op) {
        case "set_source": {
          const src = sourceNode();
          // Clear any prior uploaded-blob id - a chat-set URL replaces the
          // source, so a stale sourceStorageId would make the run reuse the old
          // uploaded file instead of the new URL.
          if (src) {
            const previous = src.data.config as Partial<SourceConfig>;
            st().updateNodeConfig(src.id, {
              sourceUrl: o.sourceUrl, sourceStorageId: undefined,
              // An editor selection is ONE video. Never carry an old folder's
              // "clip all" setting into this run or re-resolve that stale folder.
              clipAll: false, sourceCollectionUrl: undefined,
              ...(previous.sourceUrl !== o.sourceUrl ? {
                campaignId: undefined, contentRewardId: undefined,
                rewardVideos: undefined, sourceFolderVideos: undefined,
              } : {}),
            });
          }
          else {
            st().addNodeFromCatalog("source", { x: -320, y: 0 });
            // Write the URL directly (no updateNodeConfig) so this op stays ONE
            // undo step - addNodeFromCatalog already pushed history.
            const id = st().selectedId;
            if (id)
              useClippingStore.setState((s) => ({
                nodes: s.nodes.map((n) =>
                  n.id === id
                    ? { ...n, data: { ...n.data, config: { ...n.data.config, sourceUrl: o.sourceUrl } } }
                    : n
                ),
              }));
            structural = true;
          }
          break;
        }
        case "seed_reward_source": {
          // Stage content-reward handoff (/builder?reward=<id>): seed ONE Source
          // node with the FIRST resolved video, tag it with contentRewardId
          // (Supabase provenance → cache + auto-submit), and stash the full list
          // on rewardVideos for the inspector swap-picker. Clears campaignId so a
          // Source carries at most one provenance (Convex XOR Supabase). A reward
          // with no resolvable videos (e.g. private Drive folder, no key) still
          // tags the node so the user can paste a URL that inherits the reward.
          const first = o.videos[0]?.url ?? "";
          const patch = {
            sourceUrl: first,
            sourceStorageId: undefined,
            campaignId: undefined,
            contentRewardId: o.contentRewardId,
            rewardVideos: o.videos,
          };
          const src = sourceNode();
          if (src) st().updateNodeConfig(src.id, patch);
          else {
            st().addNodeFromCatalog("source", { x: -320, y: 0 });
            // Write directly (no updateNodeConfig) so the seed stays ONE undo step -
            // addNodeFromCatalog already pushed history (mirrors set_source above).
            const id = st().selectedId;
            if (id)
              useClippingStore.setState((s) => ({
                nodes: s.nodes.map((n) =>
                  n.id === id
                    ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
                    : n
                ),
              }));
            structural = true;
          }
          break;
        }
        case "set_clip_length": {
          const src = sourceNode();
          if (!src) break;
          const cfg = src.data.config as { clipLengthMin?: number; clipLengthMax?: number };
          let min = clampLen(o.min ?? cfg.clipLengthMin ?? 20);
          let max = clampLen(o.max ?? cfg.clipLengthMax ?? 45);
          if (min > max) [min, max] = [max, min];
          st().updateNodeConfig(src.id, { clipLengthMin: min, clipLengthMax: max });
          break;
        }
        case "set_max_clips": {
          const src = sourceNode();
          if (src) st().updateNodeConfig(src.id, { maxClips: Math.min(60, Math.max(1, Math.round(o.count))) });
          // The real node now carries the count — the Editor tab's optimistic
          // draft (shown on its top "Clip (N clips)" button before this op ever
          // drained) can stand down; the node's own config is authoritative again.
          useClippingStore.setState({ draftMaxClips: null });
          break;
        }
        case "set_aspect": {
          if (!["9:16", "16:9", "1:1", "4:5"].includes(o.ratio)) break;
          const isCrop = (n: (typeof nodes)[number]) =>
            n.data.kind === "skill" && (n.data.config as { variant?: string }).variant === "crop";
          let crop = st().nodes.find(isCrop);
          if (!crop) {
            st().addNodeFromCatalog("crop", { x: 0, y: 400 });
            structural = true;
            crop = st().nodes.find(isCrop);
          }
          if (crop) st().updateNodeConfig(crop.id, { ratio: o.ratio });
          break;
        }
        case "set_auto_plan": {
          const src = sourceNode();
          if (src) st().updateNodeConfig(src.id, { autoPlan: o.enabled });
          break;
        }
        case "set_watermark": {
          const src = sourceNode();
          if (src) st().updateNodeConfig(src.id, { velloWatermark: o.enabled });
          break;
        }
        case "set_genre": {
          // Drop a hallucinated genre id - an unknown value would silently
          // no-op in genreScore and leave the source mis-configured.
          if (!CLIP_GENRE_BY_ID[o.genre]) { console.warn(`[clip-canvas] ignored unknown genre "${o.genre}"`); break; }
          const src = sourceNode();
          if (src) st().updateNodeConfig(src.id, { genre: o.genre });
          break;
        }
        case "set_caption_preset": {
          // Drop a hallucinated preset id (same reason as genre).
          if (!isCaptionPresetId(o.preset)) { console.warn(`[clip-canvas] ignored unknown caption preset "${o.preset}"`); break; }
          // Apply to the wired Dynamic Captions node (clip.captions).
          const cap = st().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === "clip.captions");
          if (cap) st().updateNodeConfig(cap.id, { captionPreset: o.preset });
          break;
        }
        case "set_editor_skill": {
          const definition = CLIP_SKILL_BY_ID[o.skillId];
          if (!definition) break;
          let node = st().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === o.skillId);
          if (!node) {
            st().addSkillNodeAt({ skillId: o.skillId, name: definition.name }, { x: 320, y: 260 }, { allowSameCategory: true });
            structural = true;
            node = st().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === o.skillId);
          }
          if (node) st().updateNodeConfig(node.id, o.config);
          break;
        }
        case "remove_skill": {
          const matches = (id: string | undefined) =>
            !!id && (id === o.skillId || (o.skillId.endsWith(".*") && id.startsWith(o.skillId.slice(0, -1))));
          for (const n of st().nodes.filter((n) => n.data.kind === "skill" && matches((n.data.config as { skillId?: string }).skillId))) {
            st().removeNode(n.id);
            structural = true;
          }
          break;
        }
        case "set_prompt_to_clip": {
          const text = o.prompt.trim();
          let node = st().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === "clip.prompt");
          if (!node) {
            if (!text) break; // nothing to add an empty-prompt node for
            const owned = st().availableSkills.find((s) => s.skillId === "clip.prompt");
            const name = owned?.name ?? CLIP_SKILL_BY_ID["clip.prompt"]?.name;
            if (!name) break;
            st().addSkillNodeAt({ skillId: "clip.prompt", name }, { x: 320, y: 260 });
            structural = true;
            node = st().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === "clip.prompt");
          }
          if (node) st().updateNodeConfig(node.id, { prompt: text });
          break;
        }
        case "add_node":
          st().addNodeFromCatalog(o.key, { x: 0, y: 260 });
          structural = true;
          break;
        case "add_skill": {
          // Prefer the installed Library entry; fall back to the catalog so the
          // op still works before the Convex skills query has landed.
          const owned = st().availableSkills.find((s) => s.skillId === o.skillId);
          const name = owned?.name ?? CLIP_SKILL_BY_ID[o.skillId]?.name;
          if (!name) break; // unknown skill id - drop silently
          st().addSkillNodeAt({ skillId: o.skillId, name }, { x: 320, y: 260 });
          structural = true;
          break;
        }
        case "remove_node": {
          const n = byTitle(o.title);
          if (n) {
            st().removeNode(n.id);
            structural = true;
          }
          break;
        }
        case "connect": {
          const a = byTitle(o.from);
          const b = byTitle(o.to);
          if (a && b && a.id !== b.id)
            st().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
          break;
        }
        case "apply_template": {
          // Load a full ready-made wired chain (Podcast Clipper / Hormozi Bold /
          // Campaign Hunter) + auto-install its skills. applyTemplate confirms
          // before overwriting a non-empty canvas.
          const tpl = TEMPLATE_BY_ID[o.templateId];
          if (tpl) applyTemplate(tpl);
          break;
        }
        case "tidy":
          structural = true;
          break;
        case "run":
          wantRun = true;
          break;
      }
    }
    if (structural) st().tidyLayout();
    if (wantRun) void (isMinted && cloudClipAvailable() ? runReal() : runLocalDemo());
  }, [pendingChatOps, hydratedTick, liveRunStatus, runLocalDemo, runReal, isMinted, applyTemplate]);

  return (
    <div className="clipping-flow-root relative flex h-full w-full overflow-hidden">
      <div className="relative min-w-0 flex-1">
        <RunBar
          onRun={isMinted && cloudClipAvailable() ? runReal : runLocalDemo}
          onAbort={abortRun}
          connectedCount={connectedCount}
          onConnectAccount={onNavigateToPosting}
          hint={runError ?? "Builds one downloadable clip from your Source URL - no upload"}
        />
        {skillNotice && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-md border border-white/10 bg-[#15161c]/95 px-3 py-1.5 text-[11px] text-zinc-200 shadow">
            {skillNotice}
          </div>
        )}
        <FlowCanvas onApplyTemplate={applyTemplate} />
        {nodes.length === 0 && liveRunStatus !== "running" && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <TemplatePicker variant="cards" onApply={applyTemplate} />
          </div>
        )}

        {/* Collapsible node palette: floating "+" pops the full palette up.
            Locked (closed) while a pipeline runs. */}
        <AnimatePresence>
          {paletteOpen && liveRunStatus !== "running" && (
            <motion.div
              key="palette"
              initial={{ opacity: 0, scale: 0.92, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 14 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              style={{ transformOrigin: "bottom right" }}
              className="absolute bottom-20 right-4 z-20"
              ref={paletteWrapRef}
            >
              <NodePalette />
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          ref={paletteFabRef}
          onClick={() => setPaletteOpen((v) => !v)}
          disabled={liveRunStatus === "running"}
          title={liveRunStatus === "running" ? "Locked while running" : paletteOpen ? "Close node palette" : "Add nodes"}
          aria-label={paletteOpen ? "Close node palette" : "Add nodes"}
          className="absolute bottom-4 right-4 z-20 grid size-12 place-items-center rounded-full border-2 border-[#1c1c1f] bg-[#1c1c1f] text-[#fffdf7] shadow-[3px_3px_0_rgba(28,28,31,0.35)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {paletteOpen ? <X className="size-5" /> : <Plus className="size-5" />}
        </button>
      </div>
      {/* Slide-out inspector: hidden by default, slides in from the right when a
          node is selected (or the edge toggle is clicked). */}
      <AnimatePresence initial={false}>
        {inspectorOpen && (
          <motion.div
            key="inspector"
            initial={{ x: 340, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 340, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="relative z-20 h-full shrink-0"
          >
            <InspectorPanel
              mintAddress={mintAddress}
              clipConfig={agentDoc?.clipConfig}
              onNavigateToPosting={onNavigateToPosting}
              onClose={() => setInspectorOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Edge toggle to reopen the inspector once it's been minimized. */}
      <AnimatePresence initial={false}>
        {!inspectorOpen && (
          <motion.button
            key="inspector-tab"
            type="button"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            onClick={() => setInspectorOpen(true)}
            title="Open inspector"
            aria-label="Open inspector"
            className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-full border-2 border-[#1c1c1f] bg-[#15161c] px-3 py-2 text-xs font-medium text-zinc-100 shadow-[3px_3px_0_rgba(28,28,31,0.35)] transition-transform hover:-translate-y-0.5"
          >
            <PanelRight className="size-4" />
            Inspector
          </motion.button>
        )}
      </AnimatePresence>
      <OutputPreview />
    </div>
  );
}

/** Human-friendly post spacing for run-log lines, e.g. "2h", "45m", "1h 30m". */
function formatInterval(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
