import { normalizeClipConfig } from "@/lib/builder/clipConfig";
import type { CaptionStyle } from "@/lib/server/clipTypes";
import type {
  VelloNode,
  VelloEdge,
  CaptionsConfig,
  CropConfig,
  SourceConfig,
} from "@/components/builder/clipping-flow/types/clipping";

/**
 * Nodes reachable downstream of ANY Source node via directed edges (multi-root
 * BFS - a graph may clip from several sources at once). Run participation is
 * connectivity-based: disconnect a node and it stops contributing to the
 * compiled config / skill plan.
 */
export function reachableFromSource(nodes: VelloNode[], edges: VelloEdge[]): Set<string> {
  const roots = nodes.filter((n) => n.data.kind === "source").map((n) => n.id);
  if (roots.length === 0) return new Set();
  const out: Record<string, string[]> = {};
  edges.forEach((e) => { (out[e.source] ??= []).push(e.target); });
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const next of out[id] ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/**
 * The marketplace skill ids WIRED into the run (reachable from a Source), deduped
 * - the exact set the run charges for under skills-only pricing (render/transcribe
 * compute is absorbed). Prompt-to-Clip (clip.prompt) only counts when its prompt is
 * non-empty, since an unconfigured prompt node is dropped (and not billed) by the
 * run. Kept here so the RunBar cost ESTIMATE and the LOCAL run's CHARGE derive from
 * one source of truth. NOTE: the CLOUD path (convex/clipJobs.process) bills the
 * agent's INSTALLED priced skills from agentSkillFiles, which can differ from this
 * graph-WIRED set if a skill is installed but its node is removed/disconnected - so
 * on the cloud path the badge is an estimate, not a guarantee.
 */
export function wiredMarketplaceSkillIds(nodes: VelloNode[], edges: VelloEdge[]): string[] {
  const wired = reachableFromSource(nodes, edges);
  return [...new Set(
    nodes
      .filter((n) => wired.has(n.id) && n.data.kind === "skill" && (n.data.config as { variant?: string }).variant === "marketplace")
      .filter((n) => {
        const c = n.data.config as { skillId?: string; prompt?: string };
        return c.skillId !== "clip.prompt" || (c.prompt ?? "").trim().length > 0;
      })
      .map((n) => (n.data.config as { skillId?: string }).skillId)
      .filter((id): id is string => !!id),
  )];
}

/** All wired source URLs (multi-source runs). First node's sliders set config. */
export function collectSourceUrls(nodes: VelloNode[]): string[] {
  return nodes
    .filter((n) => n.data.kind === "source")
    .map((n) => String((n.data.config as Partial<SourceConfig>)?.sourceUrl ?? "").trim())
    .filter((u) => /^https?:\/\/[^\s]+$/i.test(u));
}

// Caption tone (Captions node) → burned-in subtitle style.
const TONE_STYLE: Record<string, CaptionStyle> = {
  hype: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 68, position: "bottom" },
  casual: { mode: "karaoke", fontColor: "#FFFFFF", fontSize: 64, position: "bottom" },
  informative: { mode: "line", fontColor: "#FFFFFF", fontSize: 52, position: "bottom" },
};

// Aspect Crop node ratio → output canvas dimensions (width × height).
const RATIO_DIMS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/**
 * Compile the Flow graph into the real backend's inputs: the Source node's video
 * URL, a normalized ClipConfig, and the output canvas dims. The graph drives the
 * flags wired into the render - captions on/off + tone (Captions node), aspect
 * ratio (Aspect Crop node), target platform + auto-post (Publish node); the rest
 * falls back to pipeline defaults via normalizeClipConfig.
 */
export function compileGraph(allNodes: VelloNode[], edges?: VelloEdge[]): {
  sourceUrl: string;
  sourceUrls: string[];
  clipFeel: string;
  genre: string;
  autoPlan: boolean;
  clipConfig: ReturnType<typeof normalizeClipConfig>;
  width: number;
  height: number;
} {
  const source = allNodes.find((n) => n.data.kind === "source");
  const srcCfg = source?.data.config as Partial<SourceConfig> | undefined;
  const sourceUrl = String(srcCfg?.sourceUrl ?? "").trim();
  const sourceUrls = collectSourceUrls(allNodes);
  const clipFeel = String(srcCfg?.clipFeel ?? "any");
  const genre = String(srcCfg?.genre ?? "auto");
  const autoPlan = srcCfg?.autoPlan === true;

  // With edges supplied, only nodes wired downstream of Source participate -
  // disconnected nodes are inert. Without edges (legacy callers) every node counts.
  const reachable = edges ? reachableFromSource(allNodes, edges) : null;
  const nodes = reachable ? allNodes.filter((n) => reachable.has(n.id)) : allNodes;

  // Source node sliders → the moment picker's target window. Graphs saved
  // before the sliders existed have no values → pipeline defaults (20-45s).
  const lenMin = typeof srcCfg?.clipLengthMin === "number" ? srcCfg.clipLengthMin : undefined;
  const lenMax = typeof srcCfg?.clipLengthMax === "number" ? srcCfg.clipLengthMax : undefined;

  const isVariant = (n: VelloNode, v: string) =>
    n.data.kind === "skill" && (n.data.config as { variant?: string }).variant === v;

  // Captions node → OPTIONAL tone/style override only. captionsOn itself
  // defaults ON (DEFAULT_CLIP_CONFIG.captionsOn) and must NOT be forced off
  // just because the canvas has no explicit caption node wired — most graphs
  // (chat-built, or a plain Source→Compose→Publish) never add one, and
  // captions are expected to burn in regardless. This used to compile
  // `captionsOn: !!captionsNode || !!captionsSkillNode`, which silently
  // turned every clip caption-less the moment no such node existed — exactly
  // the "clipped the video but no captions" bug. A wired Captions node still
  // WINS to pick the tone-driven style below; it just never disables captions.
  const captionsNode = nodes.find((n) => isVariant(n, "captions"));
  const tone = (captionsNode?.data.config as Partial<CaptionsConfig> | undefined)?.tone;
  const captionStyle = tone ? TONE_STYLE[tone] : undefined;

  // Video Call To Action node (clip.cta) → a clip appended to the end of every
  // produced clip. Lifted onto clipConfig so both the local run (clip-batch-start)
  // and the persisted cloud config (agent.clipConfig) carry it.
  const ctaNode = nodes.find((n) => isVariant(n, "marketplace") && (n.data.config as { skillId?: string }).skillId === "clip.cta");
  const ctaVideo = String((ctaNode?.data.config as { ctaUrl?: string } | undefined)?.ctaUrl ?? "").trim() || undefined;

  // Transitions node (clip.transitions) → the seam transition applied at the clip's
  // joins (title→body, body→CTA, and stitched-clip seams). Lifted onto clipConfig so
  // both the local run and the persisted cloud config carry it. normalizeClipConfig
  // validates the id + clamps the duration.
  const transNode = nodes.find((n) => isVariant(n, "marketplace") && (n.data.config as { skillId?: string }).skillId === "clip.transitions");
  const transCfg = transNode?.data.config as { transitionId?: string; transitionDurationSec?: number } | undefined;
  const transition = transCfg?.transitionId
    ? { id: transCfg.transitionId, ...(typeof transCfg.transitionDurationSec === "number" ? { durationSec: transCfg.transitionDurationSec } : {}) }
    : undefined;

  // Hook Videos (clip.hookvideos) + Main Content (clip.maincontent) nodes → the
  // operator's uploaded video POOLS. Lifted onto clipConfig so the local run and the
  // persisted cloud config both see them; normalizeClipConfig drops junk entries and
  // ignores mainOnly when the main pool is empty.
  const poolCfg = (skillId: string) =>
    nodes.find((n) => isVariant(n, "marketplace") && (n.data.config as { skillId?: string }).skillId === skillId)
      ?.data.config as { videoUrls?: unknown; mainOnly?: boolean } | undefined;
  const hookPool = poolCfg("clip.hookvideos");
  const mainPool = poolCfg("clip.maincontent");
  const hookVideos = Array.isArray(hookPool?.videoUrls) ? (hookPool!.videoUrls as string[]) : undefined;
  const mainVideos = Array.isArray(mainPool?.videoUrls) ? (mainPool!.videoUrls as string[]) : undefined;
  const mainOnly = mainPool?.mainOnly === true;

  // Aspect Crop node → output canvas dimensions.
  const cropNode = nodes.find((n) => isVariant(n, "crop"));
  const ratio = (cropNode?.data.config as Partial<CropConfig> | undefined)?.ratio;
  const dims = (ratio && RATIO_DIMS[ratio]) || RATIO_DIMS["9:16"];

  // Clips-per-run slider (Source node) → how many clips a source produces. Up to 60
  // on the CLOUD path (clipJobs.process runs off-wall + reaches high counts via
  // per-moment variations). The LOCAL demo run stays capped low in plan-moments so
  // it never 502s. This is PER-SOURCE; the cloud canvas run clips ONE source per job.
  const maxClips = Math.min(60, Math.max(1, Math.round(Number(srcCfg?.maxClips) || 1)));

  const clipConfig = normalizeClipConfig({
    velloWatermark: srcCfg?.velloWatermark,
    // Default true (normalizeClipConfig falls back to DEFAULT_CLIP_CONFIG.captionsOn)
    // — never compile a hard false here. See the comment above.
    ...(captionStyle ? { captionStyle } : {}),
    ...(lenMin !== undefined || lenMax !== undefined
      ? { clipLength: { min: lenMin ?? 20, max: lenMax ?? 45 } }
      : {}),
    maxClipsPerSource: maxClips,
    // Output aspect rides on the persisted config: the cloud run only persists
    // clipConfig (width/height below were dropped), so clips always came out 9:16.
    ...(ratio && RATIO_DIMS[ratio] ? { outputAspect: ratio as "9:16" | "16:9" | "1:1" | "4:5" } : {}),
    // Channels are owned by the Posting tab (clipConfig.platforms), not the graph.
    // Compile to [] = "all connected"; the canvas compile-persist preserves the
    // operator's saved choice on top of this, so a graph run never clobbers it.
    platforms: [],
    // Auto-post is owned SOLELY by the Posting tab (clipConfig.autoPost); the canvas
    // Publish node is a read-only MIRROR, not a control. Compile to the safe default
    // OFF - the canvas persist guard (ClippingFlowCanvas: `saved?.autoPost ?? …`)
    // keeps the operator's saved Posting-tab toggle on top, so a graph run never
    // turns posting on by itself. (Previously the Publish node's dropdown drove this
    // via an inverted boolean, so "Save only" auto-posted.)
    autoPost: false,
    ...(ctaVideo ? { ctaVideo } : {}),
    ...(transition ? { transition } : {}),
    ...(hookVideos?.length ? { hookVideos } : {}),
    ...(mainVideos?.length ? { mainVideos } : {}),
    ...(mainOnly ? { mainOnly: true } : {}),
  });

  return { sourceUrl, sourceUrls, clipFeel, genre, autoPlan, clipConfig, width: dims.width, height: dims.height };
}
