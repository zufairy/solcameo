export type Tier = "normal" | "freak" | "total";
export type CharModel = "soul" | "soul2" | "reference" | "qwen";
export type ModelChoice = "soul" | "soul2" | "both" | "qwen";

export interface CharOption {
  id: string;
  label: string;
  image?: string;
  swatch?: string;
  tiers: Tier[];
  slot?: string;
}

export interface CharCategory {
  id: string;
  label: string;
  kind: "media" | "color" | "text";
  /** Max options that can be selected at once. */
  max: number;
  options: CharOption[];
}

/** categoryId → selected option ids. */
export type Selection = Record<string, string[]>;

export interface CharacterImage {
  model: CharModel;
  url: string;
  /** Aspect ratio it was generated at, e.g. "3:4" (drives the masonry tile height). */
  ratio?: string;
}

/** The one saved character for an agent. Images live in R2, never in Convex. */
export interface SavedCharacter {
  version: 1;
  tier: Tier;
  selection: Selection;
  prompt: string;
  model: ModelChoice;
  /** The picked portrait (what the agent looks like). */
  image: CharacterImage;
  /** Every candidate generated for this character. */
  candidates: CharacterImage[];
  photoUrl?: string;
  photoUrls?: string[];
  updatedAt: number;
}
