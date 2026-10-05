import type { EditOp } from "@/lib/server/clipEditOps";

// Internal asset identifier: resolved from the bundled brand image, never fetched.
export const VELLO_WATERMARK_ASSET = "vello:made-by-watermark";
export function withVelloWatermark(ops: EditOp[], enabled: boolean): EditOp[] {
  const clean = ops.filter((op) => !(op.op === "logo_overlay" && op.imageUrl === VELLO_WATERMARK_ASSET));
  return enabled ? [...clean, { op: "logo_overlay", imageUrl: VELLO_WATERMARK_ASSET, corner: "bl", opacity: 1 }] : clean;
}
