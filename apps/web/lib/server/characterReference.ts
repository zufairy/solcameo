import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { imageExists, imagePublicUrl, putImage, r2ImageConfigured } from "./imageStorage";
import { referencePlan } from "@/lib/character/spec";
import type { Selection } from "@/lib/character/types";

const TILE = 512;

/**
 * Soul accepts ONE reference image, so the picked options' scraped Higgsfield previews are composed
 * into a single trait sheet (1 tile as-is, 2 side by side, 3-4 in a 2x2 grid). The sheet is cached in
 * R2 by its option ids. Returns undefined when R2 isn't available or nothing has a preview.
 */
export async function buildReferenceSheet(sel: Selection): Promise<{ url: string; tiles: number } | undefined> {
  const plan = referencePlan(sel).options;
  if (!plan.length || !r2ImageConfigured()) return undefined;
  const key = `character-refs/sheet/${createHash("sha1").update(plan.map((o) => o.id).join("|")).digest("hex").slice(0, 20)}.jpg`;
  if (await imageExists(key)) return { url: imagePublicUrl(key), tiles: plan.length };
  try {
    const sharp = (await import("sharp")).default;
    const files = await Promise.all(plan.map((o) => {
      if (!/^\/character\/opt\/[a-z0-9_.-]+\.webp$/i.test(o.image)) throw new Error("bad preview path");
      return readFile(path.join(process.cwd(), "public", o.image));
    }));
    let jpeg: Buffer;
    if (files.length === 1) {
      jpeg = await sharp(files[0]).resize(TILE * 2, TILE * 2, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
    } else {
      const cols = files.length === 2 ? 2 : 2;
      const rows = files.length === 2 ? 1 : 2;
      const tiles = await Promise.all(files.map((f) => sharp(f).resize(TILE, TILE, { fit: "cover" }).toBuffer()));
      jpeg = await sharp({ create: { width: TILE * cols, height: TILE * rows, channels: 3, background: "#ffffff" } })
        .composite(tiles.map((input, i) => ({ input, left: (i % cols) * TILE, top: Math.floor(i / cols) * TILE })))
        .jpeg({ quality: 90 })
        .toBuffer();
    }
    await putImage(jpeg, "image/jpeg", { key });
    return { url: imagePublicUrl(key), tiles: plan.length };
  } catch {
    return undefined;
  }
}
