/**
 * CHARACTER DESIGN SHEET — turn "chubby orange alien, three eyes, dented helmet"
 * into the locked reference frames a series renders from.
 *
 * Why a SHEET and not one picture: the video model holds a character by matching a
 * reference, and a single three-quarter portrait leaves it guessing at every other
 * angle — which is how a character silently drifts between episodes. Three
 * deliberate views (front, three-quarter, expression) pin the design down.
 *
 * The prompt is the load-bearing part. Two things must be true of every frame:
 *  - It is an ORIGINAL, non-celebrity character. The pipeline's de-identify pass
 *    exists for the same reason and this prompt is written not to fight it.
 *  - The MEDIUM is stated explicitly (2D cartoon, 3D animation, claymation…).
 *    The video pipeline matches the reference's medium and refuses to restyle, so
 *    the medium chosen here is the medium the whole series renders in.
 */

/** The views a sheet is generated at, in the order they are used as references. */
export const DESIGN_SHEET_VIEWS = [
  { id: "front", label: "Front", shot: "front-facing, full body, neutral pose, arms relaxed" },
  { id: "threequarter", label: "Three-quarter", shot: "three-quarter view, full body, mid-stride, confident posture" },
  { id: "expression", label: "Expression", shot: "chest-up, exaggerated signature expression, mouth open mid-line" },
] as const;

export type DesignSheetView = (typeof DESIGN_SHEET_VIEWS)[number]["id"];

/** Supported mediums. The first is the default because it is what "cartoon" means
 *  to most operators, and it is the cheapest for a model to hold consistently. */
export const CHARACTER_MEDIUMS = [
  { id: "2d", label: "2D cartoon", phrase: "flat 2D cartoon illustration, bold clean outlines, cel-shaded, saturated colours" },
  { id: "3d", label: "3D animated", phrase: "stylised 3D animated character render, soft studio lighting, Pixar-adjacent shapes" },
  { id: "claymation", label: "Claymation", phrase: "stop-motion claymation figure, visible fingerprints in the clay, practical set lighting" },
  { id: "pixel", label: "Pixel art", phrase: "chunky pixel-art sprite, limited palette, crisp pixel edges, no anti-aliasing" },
  // Live-action / realistic-drama series (the viral short-drama format): the
  // video pipeline's MEDIUM/STYLE-LOCK prompts already render realistic cinematic
  // live-action whenever the reference itself is photoreal (kie-video-pipeline.ts)
  // — this entry just makes the DESIGN SHEET produce a photoreal reference instead
  // of silently falling back to 2D cartoon (mediumPhrase's default) for an unknown id.
  { id: "realistic", label: "Realistic / live-action", phrase: "photorealistic human, natural skin texture and lighting, realistic cinematic film-still photography, no illustration or animation styling" },
] as const;

export type CharacterMedium = (typeof CHARACTER_MEDIUMS)[number]["id"];

export function mediumPhrase(medium: string | undefined): string {
  return (CHARACTER_MEDIUMS.find((m) => m.id === medium) ?? CHARACTER_MEDIUMS[0]).phrase;
}

/**
 * Build the image prompt for one view of a character.
 *
 * `description` is the operator's own words and is quoted almost verbatim — it is
 * the design. Everything around it exists to keep the frame USABLE as a reference:
 * plain background, whole character in frame, no text, and the same medium every
 * time.
 */
export function buildDesignSheetPrompt(args: {
  name: string;
  description: string;
  medium?: string;
  view: DesignSheetView;
}): string {
  const view = DESIGN_SHEET_VIEWS.find((v) => v.id === args.view) ?? DESIGN_SHEET_VIEWS[0];
  const description = args.description.trim().slice(0, 600);
  return [
    `Character design reference sheet for an ORIGINAL fictional character named "${args.name.trim().slice(0, 60)}".`,
    `This is an invented character — not a real, famous, or recognisable person, and not based on any existing franchise character.`,
    `DESIGN: ${description}`,
    `MEDIUM: ${mediumPhrase(args.medium)}. Render in this medium exactly; do not switch to a different style.`,
    `VIEW: ${view.shot}.`,
    // A reference frame with scenery in it teaches the video model that the scenery
    // is part of the character.
    `Plain flat neutral background (single solid colour). The whole character is inside the frame with margin around it. Even, shadowless lighting.`,
    `NO text, letters, numbers, logos, watermarks, captions, panels, or grids anywhere in the image.`,
    `Consistent, readable silhouette — this image will be used as the identity reference for every future video of this character.`,
  ].join("\n");
}

/** The three prompts that make up one character's sheet. */
export function buildDesignSheetPrompts(args: { name: string; description: string; medium?: string }): { view: DesignSheetView; prompt: string }[] {
  return DESIGN_SHEET_VIEWS.map((v) => ({
    view: v.id,
    prompt: buildDesignSheetPrompt({ ...args, view: v.id }),
  }));
}
