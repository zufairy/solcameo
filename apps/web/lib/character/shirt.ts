/**
 * Shirt studio: prompt construction for editing ONE finished character portrait
 * so the character wears a new shirt (optionally carrying the user's logo) and,
 * optionally, takes a new pose, while staying the same person.
 *
 * Pure and dependency-free so the prompt can be unit-tested and shared.
 */
export type ShirtMode = "logo" | "describe" | "auto";

export interface ShirtPose { id: string; label: string; prompt: string }

/** "keep" leaves the pose and framing untouched; every other entry re-poses the character. */
export const SHIRT_POSES: ShirtPose[] = [
  { id: "keep", label: "Keep pose", prompt: "" },
  { id: "front", label: "Standing front", prompt: "standing straight facing the camera, shoulders square, arms relaxed at the sides so the whole shirt front and chest print are clearly visible" },
  { id: "crossed", label: "Arms crossed", prompt: "standing confidently with arms crossed over the lower torso, below the chest print so the logo stays fully visible" },
  { id: "pockets", label: "Hands in pockets", prompt: "standing relaxed with both hands in the pockets, a slight casual lean, chest and shirt print unobstructed" },
  { id: "wave", label: "Waving", prompt: "smiling and waving one open hand next to the shoulder, the other arm relaxed, chest print unobstructed" },
  { id: "thumbs", label: "Thumbs up", prompt: "giving a clear thumbs-up with one hand held away from the chest, the other arm relaxed, chest print unobstructed" },
  { id: "point", label: "Pointing", prompt: "pointing one finger toward the viewer while the other hand rests at the side, chest print unobstructed" },
  { id: "peace", label: "Peace sign", prompt: "making a peace sign with one hand beside the face, the other arm relaxed, chest print unobstructed" },
  { id: "walk", label: "Walking", prompt: "caught mid-stride walking toward the camera, natural arm swing, shirt fabric moving slightly with the stride" },
  { id: "sit", label: "Sitting", prompt: "sitting on a stool leaning slightly forward with forearms on the knees, torso upright enough that the chest print stays readable" },
];

export const SHIRT_POSE_IDS = SHIRT_POSES.map(p => p.id);
export const SHIRT_COLORS = ["black", "white", "heather grey", "navy", "forest green", "burgundy", "cream", "lime"] as const;

/** When the user lets the AI choose, rotate through concrete directions rather than saying "something nice". */
const AUTO_DIRECTIONS = [
  "a premium heavyweight black cotton crew-neck tee with a clean, minimal, modern streetwear fit",
  "an off-white boxy heavyweight tee with a subtle washed vintage feel and a relaxed drop shoulder",
  "a charcoal oversized streetwear tee, soft garment-dyed cotton, slightly cropped hem",
  "a crisp cream ringer tee with contrasting collar trim, classic fit",
  "a forest-green premium cotton tee with a tailored modern fit",
  "a deep navy fitted tee in soft combed cotton with a clean crew neckline",
];

const clean = (value: unknown, max: number) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f<>`{}\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

export function sanitizeShirtMode(value: unknown): ShirtMode { return value === "logo" || value === "describe" ? value : "auto"; }
export function sanitizePoseId(value: unknown): string { return typeof value === "string" && SHIRT_POSE_IDS.includes(value) ? value : "keep"; }
export const sanitizeShirtDescription = (value: unknown) => clean(value, 240);

export interface ShirtPromptInput {
  mode: ShirtMode;
  /** Free text such as "oversized black tee, gold dragon on the chest". */
  description?: string;
  /** True when the SECOND input image is the user's logo. */
  hasLogo: boolean;
  poseId?: string;
  /** Seed for the "let AI choose" direction. */
  seed?: number;
}

export function buildShirtPrompt(input: ShirtPromptInput): string {
  const description = sanitizeShirtDescription(input.description);
  const pose = SHIRT_POSES.find(p => p.id === input.poseId) ?? SHIRT_POSES[0];
  const direction = AUTO_DIRECTIONS[Math.abs(Math.floor(input.seed ?? 0)) % AUTO_DIRECTIONS.length];
  const garment = input.mode === "describe" && description
    ? `Dress the character in this shirt: ${description}. Render it as a real, well-made garment`
    : input.hasLogo
      ? `Dress the character in ${description ? `this shirt: ${description}` : direction}. Render it as a real, well-made garment`
      : `Dress the character in ${direction}. Render it as a real, well-made garment`;
  const lines = [
    "Edit the FIRST image. It is a finished portrait of a character.",
    "IDENTITY LOCK: keep the exact same character - identical face, facial features, expression, eye colour, skin tone, hair, body proportions, rendering style, colour grading, lighting direction, camera angle, framing and background. Do not restyle, beautify, age or relight anything.",
    `CLOTHING CHANGE: replace ONLY the top the character is currently wearing. ${garment} with believable cotton weave, stitched hems and collar, natural fabric folds, gentle tension at the shoulders and chest, and a soft contact shadow against the skin. The shirt must fit this body and follow its pose, and be lit by the same light as the rest of the image. Any jacket, chain or accessory that is not the shirt stays as it was.`,
  ];
  if (input.hasLogo) {
    lines.push("LOGO: the SECOND image is the user's logo. Print it once on the centre of the shirt chest, upright and roughly one quarter of the chest width, reproduced exactly - same shapes, proportions, letters and colours, no redrawing, no added or invented text, no mirrored or warped version. Make it look screen printed on the fabric: the print follows the folds of the cloth, with fine ink texture and slight natural fabric grain showing through. If the logo has a flat or white background, use only the mark itself.");
  } else if (input.mode === "describe" && description) {
    lines.push("Add no other text or lettering to the shirt unless the description asks for it, and keep any requested graphic crisp and correctly spelled.");
  } else {
    lines.push("Keep the shirt clean: no brand names, no random text or lettering.");
  }
  lines.push(pose.prompt
    ? `POSE: change the pose to: ${pose.prompt}. Keep it the same character and the same camera framing and background, with natural anatomy, correct proportions and exactly five well-formed fingers on each visible hand.`
    : "POSE: keep the exact same pose, gesture, head angle and framing as the first image.");
  lines.push("QUALITY: photorealistic result with sharp fabric detail, consistent with the original image style. Avoid: changed face, different person, extra limbs or fingers, warped or garbled logo, watermarks, captions, floating text, blurry print, plastic-looking cloth, mismatched lighting.");
  return lines.join("\n");
}
