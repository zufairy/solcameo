import { retailUsd } from "@/lib/pricing/retail";
/**
 * KIE image engines the operator can pick from.
 *
 * ONE list, imported by both the dropdown and the server, so a new model is a single
 * entry rather than a slug duplicated across a UI and a request builder — the way a
 * picker ends up offering something the backend can't actually call.
 *
 * Slugs are the real `model` values for POST /api/v1/jobs/createTask, taken from
 * docs.kie.ai. They are NOT display names: "Nano Banana 2" is `nano-banana-2`, and
 * the GPT model's slug carries its direction (`-text-to-image`).
 */

export interface ImageEngine {
  /** Stable id stored in the agent's config — never the slug, so a vendor rename
   *  doesn't invalidate every saved agent. */
  id: "nano-banana-pro" | "nano-banana-2" | "nano-banana-2-lite" | "gpt-image-2" | "qwen-image-3";
  label: string;
  /** The KIE `model` value. */
  slug: string;
  blurb: string;
  /** Highest resolution worth requesting from this model. */
  resolution: "1K" | "2K" | "4K";
  /**
   * Whether the model accepts a reference image. The nano-banana family reads
   * it directly on this same slug (`image_input`). gpt-image-2 and qwen-image-3
   * are each actually TWO separate Kie models — this engine's own `slug` is the
   * text-to-image one; lib/server/imagePost.ts's createImageTask reroutes to
   * that model's dedicated image-to-image slug (see IMAGE_TO_IMAGE_REROUTE_IDS)
   * whenever a reference is attached, so this is still `true` for the operator's
   * purposes — a reference genuinely works, just not on this literal slug.
   */
  acceptsReferences: boolean;
  /** Provider (Kie) list price per image. Customers pay this plus 15%: use imageRetailPriceUsd. */
  pricePerImageUsdc: number;
}

/** Engines whose catalog `slug` is a TEXT-ONLY model, but that have a separate,
 *  differently-shaped image-to-image sibling model on Kie that createImageTask
 *  reroutes to when a reference is attached. Shared by the server (imagePost.ts)
 *  and the Generate tab UI so both agree on which engines this applies to. */
export const IMAGE_TO_IMAGE_REROUTE_IDS: ReadonlySet<ImageEngine["id"]> = new Set(["gpt-image-2", "qwen-image-3"]);

export const IMAGE_ENGINES: ImageEngine[] = [
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    slug: "nano-banana-pro",
    blurb: "Gemini 3 Pro Image — native 2K, the best text rendering, keeps a character consistent from a reference.",
    resolution: "2K",
    acceptsReferences: true,
    pricePerImageUsdc: 0.04,
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    slug: "nano-banana-2",
    blurb: "Gemini 3.1 Flash Image — 4K and fast, strongest character consistency of the four.",
    resolution: "4K",
    acceptsReferences: true,
    pricePerImageUsdc: 0.04,
  },
  {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    slug: "nano-banana-2-lite",
    blurb: "1K and cheapest — the one to pick when posting several images a day.",
    resolution: "1K",
    acceptsReferences: true,
    pricePerImageUsdc: 0.02,
  },
  {
    id: "gpt-image-2",
    label: "ChatGPT (GPT Image 2)",
    slug: "gpt-image-2-text-to-image",
    blurb: "OpenAI GPT Image 2 — follows the prompt literally and renders legible text. Attach a reference and it automatically switches to GPT Image 2's image-to-image model.",
    resolution: "2K",
    acceptsReferences: true,
    pricePerImageUsdc: 0.04,
  },
  {
    id: "qwen-image-3",
    label: "Qwen Image 3",
    slug: "qwen3/text-to-image", // docs.kie.ai/market/qwen3/text-to-image
    blurb: "Alibaba Qwen Image 3 — strong prompt adherence and typography at 1K/2K. Attach up to 3 references and it switches to Qwen's image-to-image model.",
    resolution: "2K",
    acceptsReferences: true,
    // Best-effort price — no confirmed kie.ai dashboard rate at add-time; confirm
    // against the kie.ai model catalog before relying on this for real spend.
    pricePerImageUsdc: 0.03,
  },
];

/** What one image costs the customer: the provider price plus the 15% Solcameo fee. */
export function imageRetailPriceUsd(engine: Pick<ImageEngine, "pricePerImageUsdc">): number {
  return retailUsd(engine.pricePerImageUsdc);
}

export const DEFAULT_IMAGE_ENGINE: ImageEngine["id"] = "nano-banana-pro";

export const IMAGE_ENGINE_BY_ID: Record<string, ImageEngine> = Object.fromEntries(
  IMAGE_ENGINES.map((e) => [e.id, e]),
);

/**
 * Resolve a stored engine id. An unknown id (a model we retired, a hand-edited
 * config) falls back to the default rather than throwing — a stale preference must
 * not stop an agent from posting.
 */
export function resolveImageEngine(id: string | undefined | null): ImageEngine {
  return IMAGE_ENGINE_BY_ID[(id ?? "").trim()] ?? IMAGE_ENGINE_BY_ID[DEFAULT_IMAGE_ENGINE];
}
