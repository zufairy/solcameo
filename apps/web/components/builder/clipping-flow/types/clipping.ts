import type { Node, Edge } from "@xyflow/react";

export type NodeKind = "source" | "compose" | "skill" | "publish";
export type NodeStatus = "idle" | "running" | "done" | "error";

export interface SourceConfig {
  velloWatermark?: boolean;
  provider: "google-drive";
  /** Which input the operator is using - drives the inspector's 3-pill selector
   *  and guarantees only ONE source feeds Run (switching pills resets the source).
   *  Unset = derived from the other fields (back-compat). */
  sourceMode?: "url" | "campaign" | "upload";
  /** Video source URL fed to the real clipJobs pipeline on Run. */
  sourceUrl: string;
  /** Target highlight window (seconds) for the moment picker → clipConfig.clipLength.
      Optional: graphs persisted before this field existed fall back to 20/45. */
  clipLengthMin?: number;
  clipLengthMax?: number;
  /** Number of clips per source (1-60) → clipConfig.maxClipsPerSource. Default 1.
   *  Counts above the number of distinct strong moments are reached on the CLOUD
   *  path via per-moment variations; the local demo run stays capped low. */
  maxClips?: number;
  /** "Let AI decide" - ignore the length/count sliders; the analyzer picks the
      natural windows and however many strong moments it found. */
  autoPlan?: boolean;
  /** Preferred clip feel - moments matching this emotion rank first.
      "any" (default) keeps the pure virality ranking. */
  clipFeel?: "any" | "funny" | "shocking" | "inspiring" | "informative" | "emotional" | "controversial";
  /** Content genre (lib/builder/clipGenres.ts) - re-weights the virality
      sub-scores when ranking moments. "auto" (default) = let AI detect. */
  genre?: string;
  /** When the source was UPLOADED (not a URL): the Convex storage id of the
      transient source blob, deleted after the run so only clips remain. */
  sourceStorageId?: string;
  /** Set ONLY when sourceUrl was picked from a clipping CAMPAIGN's contentLinks
      (Feature D source dropdown). Drives the E caching rule: the canvas tags the
      transcribe call campaignSource:true (cacheable) iff this is set. A manually
      pasted URL / uploaded file leaves this undefined (user source = not cached). */
  campaignId?: string;
  /** Set ONLY when sourceUrl came from a Stage content_reward (Supabase). Sibling
      to campaignId (Convex). Drives BOTH: campaignSource:true on transcribe (cache)
      AND the enqueued clip job's contentRewardId (Supabase auto-submit). Mutually
      exclusive with campaignId - a Source picks at most one provenance. A manually
      pasted URL / uploaded file leaves this undefined (user source = not cached). */
  contentRewardId?: string;
  /** Full Stage-campaign video list (the reward's resolved Drive folder / links)
      for the inspector swap-picker - lets the user switch which folder video this
      Source clips while keeping the same contentRewardId. UX-only, not persisted-
      critical (compile-graph reads only sourceUrl + sliders). */
  rewardVideos?: { url: string; name: string }[];
  /** Full Google Drive FOLDER video list when a FOLDER link is pasted into the
      Paste-URL pill (a NON-campaign user source - no contentRewardId/campaignId).
      Mirrors rewardVideos but for the manual-paste path: the inspector lists every
      folder video and lets the user swap which one this Source clips. UX-only;
      compile-graph reads only sourceUrl. Cleared when a fresh URL is typed or the
      source pill is switched. */
  sourceFolderVideos?: { url: string; name: string }[];
  /** Master Videos "clip all" opt-in: when true AND sourceCollectionUrl is set, the
   *  cloud run clips EVERY member of the folder/channel (one job each, capped) instead
   *  of only the picked top video. Default false = single-video behavior (unchanged). */
  clipAll?: boolean;
  /** The expandable COLLECTION url (Drive FOLDER or YouTube CHANNEL/PLAYLIST) this
   *  Source was expanded from. Persisted at expand time so a "clip all" cloud run can
   *  send the collection url for run-task to re-expand + fan out. Undefined for a
   *  single video / Drive file / a Stage reward with no single collection url. */
  sourceCollectionUrl?: string;
}
export interface CaptionsConfig {
  variant: "captions";
  tone: "casual" | "hype" | "informative";
  hashtags: boolean;
}
export interface BrollConfig {
  variant: "broll";
  pack: "city" | "nature" | "abstract";
  intensity: number;
}
export interface CropConfig {
  variant: "crop";
  ratio: "9:16" | "16:9" | "1:1" | "4:5";
  focus: "auto" | "center";
}
export interface MarketplaceSkillConfig {
  variant: "marketplace";
  /** agentSkillFiles skillId, e.g. "clip.zoom". */
  skillId: string;
  skillName: string;
  /** Operator prompt for the Prompt-to-Clip skill (clip.prompt) - steers
   *  moment selection. Edited in the node inspector. */
  prompt?: string;
  /** Campaign Scout (clip.campaignscout): campaign ids to consider. Empty /
   *  unset = all active campaigns. Edited in the node inspector. */
  campaignIds?: string[];
  /** Dynamic Captions (clip.captions): chosen caption preset
   *  (lib/builder/captionPresets.ts). Unset = Classic. */
  captionPreset?: string;
  /** Dynamic Captions (clip.captions): caption vertical alignment
   *  (top | center | bottom). "bottom" stays above the platform's caption zone.
   *  Unset = the preset/default position. */
  captionAlign?: "top" | "center" | "bottom";
  /** Dynamic Captions: exact placement (block centre, % from the top), set by
   *  dragging the caption in the Editor preview. Wins over captionAlign. */
  captionYPct?: number;
  /** Smart Captions (clip.captionstyle): operator's freeform instruction for the
   *  ON-VIDEO SUBTITLE text (translate / casing / emojis). Edited in the node
   *  inspector. Always drives the burned-in subtitles, regardless of the
   *  description fields below. */
  captionPrompt?: string;
  /** Smart Captions (clip.captionstyle): whether the POST DESCRIPTION should
   *  reuse `captionPrompt` when `descriptionPrompt` is empty. Unset (legacy
   *  configs) behaves as true. */
  descFromCaption?: boolean;
  /** Smart Captions (clip.captionstyle): a SEPARATE instruction for the POST
   *  DESCRIPTION only (does not affect on-video subtitles). Non-empty always
   *  wins over `descFromCaption`/`captionPrompt`. */
  descriptionPrompt?: string;
  /** Smart Framing (clip.facetrack): how to frame wide/multi-person sources
   *  (auto | pan | zoom | full). Unset = auto. */
  framingMode?: "auto" | "pan" | "zoom" | "full";
  /** Viral Sticker (clip.sticker): box style id (lib/builder/stickerStyles). */
  stickerStyleId?: string;
  /** Viral Sticker: vertical position (top | center | bottom). Unset = top. */
  stickerPosition?: string;
  /** Viral Sticker: optional operator prompt steering the sticker text. */
  stickerPrompt?: string;
  /** Brain Rot (clip.brainrot): composite layout - "vstack" = clip on top /
   *  gameplay bottom, "hstack" = side by side. Default vstack. Read by the
   *  catalog floor → composite_bg op. */
  bgLayout?: "vstack" | "hstack";
  /** Brain Rot (clip.brainrot): chosen bundled gameplay pack id (one of
   *  lib/server/gameplayPack GAMEPLAY_PACK ids). Floor falls back to
   *  DEFAULT_GAMEPLAY_ID when unset. */
  bgId?: string;
  /** Meme Audio (clip.memeaudio): direct URL of the chosen trending sound.
   *  Load-bearing - the floor emits NO audio_overlay op without it. */
  audioUrl?: string;
  /** Meme Audio (clip.memeaudio): id of the chosen trending sound (from the
   *  trending API), for selection/state. */
  audioId?: string;
  /** Meme Audio (clip.memeaudio): overlay gain in dB. Default -3; the render
   *  clamps to -30..+12. Reused by Trending Audio for the music-bed gain (default -16). */
  gainDb?: number;
  /** Trending Audio (clip.trendingaudio): chosen built-in music track id
   *  (lib/server/trendingAudioPack). Unset = rely on autoMusic. */
  musicTrackId?: string;
  /** Trending Audio (clip.trendingaudio): auto-pick a mood-matched track. Default ON
   *  when the node is added; the floor honors it only when no track is picked. */
  autoMusic?: boolean;
  /** Trending Audio (clip.trendingaudio): operator's own uploaded MP3 — wins over
   *  musicTrackId/autoMusic in the floor when set. */
  customAudioUrl?: string;
  /** Trending Audio: the uploaded track's Convex storage id (for future cleanup). */
  customAudioStorageId?: string;
  /** Video Filters (clip.filters): named color-grade preset. */
  filterPreset?: "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "moody" | "filmic" | "matte";
  /** Video Filters: saturation multiplier (0..2, 1 = unchanged). */
  filterSaturation?: number;
  /** Video Filters: brightness add (-0.5..0.5, 0 = unchanged). */
  filterBrightness?: number;
  /** Reaction SFX (clip.reactionsfx): chosen sound id (lib/server/reactionSfxPack). */
  sfxId?: string;
  /** MEME reaction SFX (clip.memeaudio): chosen reaction-SFX pack id
   *  (lib/server/reactionSfxPack REACTION_SFX_PACKS). The AI still auto-picks the
   *  sting by emotion; this only swaps the pack. Unset = Gen Z Meme (default). */
  sfxPackId?: string;
  /** Reaction SFX: when (seconds into the clip) the sfx fires. Unset = the hook. */
  sfxAtSec?: number;
  /** Auto Hook (clip.hook): seconds the hook line stays on screen (1..15).
   *  Unset = 5. Read by the catalog floor → text_overlay endSec. */
  hookDurationSec?: number;
  /** Auto Hook (clip.hook): "Always on" — keep the hook up until the end of the
   *  clip (overrides hookDurationSec). Unset/false = off. */
  hookAlwaysOn?: boolean;
  /** Auto Hook (clip.hook): chosen text-design template id
   *  (lib/builder/hookDesigns). Unset = "bold_white". */
  hookTemplateId?: string;
  /** Auto Hook (clip.hook): where the hook text sits - overrides the template's
   *  baked position at render. Unset = the template's own position. */
  hookPosition?: "top" | "center" | "bottom";
  /** Auto Hook (clip.hook): operator's custom look - overrides the template's
   *  render fields server-side (resolveHookRender). Unset = use the template. */
  hookCustomDesign?: { font?: string; fontColor?: string; fontSize?: number; position?: "top" | "center" | "bottom"; yPct?: number; boxColor?: string | null; allCaps?: boolean };
  /** Auto Hook (clip.hook): operator's prompt-box idea for the overlay line.
   *  When set, the planner's LLM writes the hook text to fit it. */
  hookPrompt?: string;
  /** Auto Hook (clip.hook): operator's language dropdown pick (e.g. "Spanish").
   *  When set, the planner's LLM writes the hook in this language instead of
   *  only guessing from the clip's caption text. */
  hookLanguage?: string;
  /** Hook Title Card (clip.title): chosen slate design template id
   *  (lib/builder/titleCardDesigns). Unset = "bold_white". */
  titleTemplateId?: string;
  /** Hook Title Card (clip.title): seconds the title slate holds (1..5).
   *  Unset = 1.5. Read by the catalog floor → title_card durationSec. */
  titleDurationSec?: number;
  /** Hook Title Card (clip.title): operator's prompt-box idea for the slate text.
   *  When set, the planner's LLM writes the headline to fit it. */
  titlePrompt?: string;
  /** Transitions (clip.transitions): chosen transition style id
   *  (lib/server/transitionsPack). Unset = "fade". */
  transitionId?: string;
  /** Transitions (clip.transitions): seam duration in seconds (0.2..1.5). Unset = the
   *  style's default. */
  transitionDurationSec?: number;
}
export type SkillConfig = CaptionsConfig | BrollConfig | CropConfig | MarketplaceSkillConfig;
/** Compose node - a transparent skill hub. Skills fan around it; it carries no
 *  config of its own. */
export interface ComposeConfig {}
export interface PublishConfig {
  /** @deprecated single-channel legacy field; superseded by `platforms`. */
  channel?: "tiktok";
  /** Channels to post to. EMPTY = post to ALL connected accounts. */
  platforms?: string[];
  caption: string;
  schedule: "now" | "scheduled";
}
export type NodeConfig =
  | SourceConfig
  | ComposeConfig
  | SkillConfig
  | PublishConfig;

export type NodeOutput =
  | { type: "files"; count: number; sample: string[] }
  | { type: "post"; headline: string; gradient: string }
  | { type: "caption"; text: string; hashtags: string[] }
  | { type: "overlay"; pack: string; clips: number }
  | { type: "crop"; ratio: string }
  | { type: "publish"; url: string; views: string }
  | { type: "clip"; clipUrl: string; title?: string; durationSeconds?: number; captionText?: string }
  | { type: "clips"; items: { clipUrl: string; title?: string; durationSeconds?: number; viralScore?: number; emotion?: string; captionText?: string }[] };

export interface VelloNodeData extends Record<string, unknown> {
  kind: NodeKind;
  title: string;
  status: NodeStatus;
  config: NodeConfig;
  output?: NodeOutput;
  error?: string;
}

export type VelloNode = Node<VelloNodeData>;
export type VelloEdge = Edge;
