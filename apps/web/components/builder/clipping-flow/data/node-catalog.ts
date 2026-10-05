import type { NodeKind, NodeConfig } from "@/components/builder/clipping-flow/types/clipping";

export type CatalogKey =
  | "source"
  | "compose"
  | "broll"
  | "crop"
  | "publish";

export type CatalogGroup = "Sources" | "Skills" | "Publish";

export interface CatalogItem {
  key: CatalogKey;
  /** maps to react-flow node.type */
  kind: NodeKind;
  title: string;
  group: CatalogGroup;
  description: string;
  makeConfig: () => NodeConfig;
  /** Greyed out + non-draggable in the palette (not wired into the local clip
   *  pipeline yet). */
  disabled?: boolean;
}

export const CATALOG: CatalogItem[] = [
  {
    key: "source",
    kind: "source",
    title: "Source",
    group: "Sources",
    description: "Video URL to clip (YouTube or direct file)",
    makeConfig: () => ({
      provider: "google-drive",
      sourceUrl: "",
      clipLengthMin: 20,
      clipLengthMax: 45,
      maxClips: 1,
    }),
  },
  {
    key: "compose",
    kind: "compose",
    title: "Compose",
    group: "Skills",
    description: "Skill hub - drop skills here",
    makeConfig: () => ({}),
  },
  {
    key: "broll",
    kind: "skill",
    title: "B-roll Overlay",
    group: "Skills",
    description: "Layer cinematic b-roll - coming soon",
    disabled: true, // not wired into the local clip pipeline yet
    makeConfig: () => ({ variant: "broll", pack: "city", intensity: 40 }),
  },
  {
    key: "crop",
    kind: "skill",
    title: "Aspect Crop",
    group: "Skills",
    description: "Smart-crop to format",
    makeConfig: () => ({ variant: "crop", ratio: "9:16", focus: "auto" }),
  },
  {
    key: "publish",
    kind: "publish",
    title: "Publish",
    group: "Publish",
    description: "Post to your connected socials",
    // platforms [] = all connected; caption "" = auto-generate per clip.
    makeConfig: () => ({ platforms: [], caption: "", schedule: "now" }),
  },
];

export const CATALOG_BY_KEY = Object.fromEntries(
  CATALOG.map((c) => [c.key, c])
) as Record<CatalogKey, CatalogItem>;

export const CATALOG_GROUPS: CatalogGroup[] = [
  "Sources",
  "Skills",
  "Publish",
];
