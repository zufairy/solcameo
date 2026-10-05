import {
  FolderInput,
  Sparkles,
  Boxes,
  Captions,
  Clapperboard,
  Crop,
  Send,
  Anchor,
  Film,
  Newspaper,
  Music,
  Volume2,
  ZoomIn,
  Scissors,
  Crosshair,
  Palette,
  Sticker,
  Gamepad2,
  Lightbulb,
  Video,
  Target,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Position } from "@xyflow/react";
import type {
  VelloNodeData,
  SourceConfig,
  CaptionsConfig,
  BrollConfig,
  CropConfig,
  MarketplaceSkillConfig,
} from "@/components/builder/clipping-flow/types/clipping";
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";
import { iconifyUrl, skillIconName } from "@/lib/builder/skillIcons";

// Per-skill canvas icon so nodes are VISUALLY DISTINCT (previously every skill node
// used the same Sparkles glyph, so Auto Hook and Transitions looked identical and
// were easy to mix up). Unmapped skills fall back to Sparkles.
const SKILL_NODE_ICON: Record<string, LucideIcon> = {
  "clip.captions": Captions,
  "clip.captionstyle": MessageSquareText,
  "clip.keywords": Lightbulb,
  "clip.title": Newspaper,
  "clip.hook": Anchor,
  "clip.transitions": Film,
  "clip.cta": Video,
  "clip.trendingaudio": Music,
  "clip.memeaudio": Volume2,
  "clip.zoom": ZoomIn,
  "clip.fillercut": Scissors,
  "clip.facetrack": Crosshair,
  "clip.filters": Palette,
  "clip.sticker": Sticker,
  "clip.brainrot": Gamepad2,
  "clip.campaignscout": Target,
  "clip.guardrails": ShieldCheck,
};
import { CAPTION_PRESET_BY_ID } from "@/lib/builder/captionPresets";

// TODO: The accent values below reference CSS custom properties (--node-source,
// --node-compose, --node-skill, --node-publish) that are defined in
// clipping-flow/clipping-flow.css. That file MUST be imported by any component
// that renders nodes; without it the accents will silently resolve to empty/unset.

export interface NodeVisual {
  icon: LucideIcon;
  accent: string; // a CSS color (var reference)
  summary: string;
  hasInput: boolean;
  hasOutput: boolean;
  /** Which side the (unnamed/null-id) input handle attaches to. Every node uses
   *  Left so connector wires enter from the left in the horizontal
   *  Source→Compose→(skills)→Publish flow. */
  inputPos: Position;
  /** Which side the (unnamed/null-id) output handle attaches to. Every node uses
   *  Right so wires leave from the right — no top/bottom crossing. */
  outputPos: Position;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Icon/logo for each node card. Skill nodes resolve to the SAME Iconify
 * "fluent-emoji-flat" icon shown for that skill in the App Store (via the shared
 * skillIcons map), so a skill looks identical on the shelf and on the canvas.
 * Source/Compose/Publish are structural (not App-Store skills) and map to their
 * own fluent-emoji-flat glyphs from the same set for a consistent look.
 */
const iconify = (name: string) => iconifyUrl(name);

export function nodeImage(data: VelloNodeData): string {
  switch (data.kind) {
    case "source":
      return iconify("clapper-board");
    case "compose":
      return iconify("puzzle-piece");
    case "publish":
      return iconify("megaphone");
    case "skill": {
      const c = data.config as
        | CaptionsConfig
        | BrollConfig
        | CropConfig
        | MarketplaceSkillConfig;
      if (c.variant === "captions") return iconify("speech-balloon");
      if (c.variant === "broll") return iconify("film-frames");
      if (c.variant === "crop") return iconify("scissors");
      if (c.variant === "marketplace") {
        const mc = c as MarketplaceSkillConfig;
        // Same lookup the App Store uses: skillId → icon, then the skill's emoji.
        const emoji = CLIP_SKILL_BY_ID[mc.skillId]?.icon;
        const name = skillIconName(mc.skillId, emoji);
        return iconify(name ?? "sparkles");
      }
      return iconify("sparkles");
    }
    default:
      return iconify("sparkles");
  }
}

export function nodeVisual(data: VelloNodeData): NodeVisual {
  switch (data.kind) {
    case "source": {
      const c = data.config as SourceConfig;
      let host = "";
      try {
        host = c.sourceUrl ? new URL(c.sourceUrl).hostname.replace(/^www\./, "") : "";
      } catch {
        /* not a valid URL yet - fall through to the placeholder summary */
      }
      const sourceLabel = c.sourceStorageId ? "Uploaded video" : host;
      const lenCount = c.autoPlan ? "AI-picked" : `${c.clipLengthMin ?? 20}-${c.clipLengthMax ?? 45}s${(c.maxClips ?? 1) > 1 ? ` × ${c.maxClips}` : ""}`;
      return {
        icon: FolderInput,
        accent: "var(--node-source)",
        summary: sourceLabel
          ? `${sourceLabel} · ${lenCount}${c.clipFeel && c.clipFeel !== "any" ? ` · ${c.clipFeel}` : ""}${c.genre && c.genre !== "auto" ? ` · ${c.genre}` : ""}`
          : "Add a video URL or upload",
        hasInput: false,
        hasOutput: true,
        inputPos: Position.Left,
        outputPos: Position.Right,
      };
    }
    case "compose":
      // Transparent skill hub - no config to read. Skills fan around it.
      return {
        icon: Boxes,
        accent: "var(--node-compose)",
        summary: "Skill hub",
        hasInput: true,
        hasOutput: true,
        inputPos: Position.Left,
        outputPos: Position.Right,
      };
    case "skill": {
      const c = data.config as CaptionsConfig | BrollConfig | CropConfig | MarketplaceSkillConfig;
      if (c.variant === "marketplace") {
        const mc = c as MarketplaceSkillConfig;
        const meta = CLIP_SKILL_BY_ID[mc.skillId];
        // Dynamic Captions: surface the picked preset on the node itself.
        const preset = mc.skillId === "clip.captions" && mc.captionPreset ? CAPTION_PRESET_BY_ID[mc.captionPreset] : undefined;
        return {
          icon: SKILL_NODE_ICON[mc.skillId] ?? Sparkles,
          accent: "var(--node-skill)",
          summary: preset && preset.id !== "default" ? `Captions · ${preset.name}` : (meta?.tag ?? "AI skill"),
          hasInput: true,
          hasOutput: true,
          inputPos: Position.Left,
          outputPos: Position.Right,
        };
      }
      if (c.variant === "captions") {
        const cc = c as CaptionsConfig;
        return {
          icon: Captions,
          accent: "var(--node-skill)",
          summary: `${cap(cc.tone)}${cc.hashtags ? " · #tags" : ""}`,
          hasInput: true,
          hasOutput: true,
          inputPos: Position.Left,
          outputPos: Position.Right,
        };
      }
      if (c.variant === "broll") {
        const bc = c as BrollConfig;
        return {
          icon: Clapperboard,
          accent: "var(--node-skill)",
          summary: `${cap(bc.pack)} · ${bc.intensity}%`,
          hasInput: true,
          hasOutput: true,
          inputPos: Position.Left,
          outputPos: Position.Right,
        };
      }
      const cc = c as CropConfig;
      return {
        icon: Crop,
        accent: "var(--node-skill)",
        summary: `${cc.ratio} · ${cap(cc.focus)}`,
        hasInput: true,
        hasOutput: true,
        inputPos: Position.Top,
        outputPos: Position.Bottom,
      };
    }
    case "publish": {
      // Auto-post (on/off), channels + schedule are owned by the Posting tab; the
      // node is a read-only mirror and no longer configures them. nodeVisual only
      // sees node config, so the canvas badge is a static router hint - the live
      // status shows in the inspector's Publish panel.
      return {
        icon: Send,
        accent: "var(--node-publish)",
        summary: "Auto-post set in Posting tab",
        hasInput: true,
        hasOutput: false,
        inputPos: Position.Left,
        outputPos: Position.Right,
      };
    }
    default:
      // Reached only by skill nodes with an unrecognised variant - keep them on
      // the same Left/Right horizontal flow as every other node.
      return {
        icon: Sparkles,
        accent: "var(--node-skill)",
        summary: "",
        hasInput: true,
        hasOutput: true,
        inputPos: Position.Left,
        outputPos: Position.Right,
      };
  }
}
