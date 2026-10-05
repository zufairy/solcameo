import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { BURN_FONT_FILES } from "@/lib/builder/burnFonts";
import { hookFontsDir } from "@/lib/server/hookFonts";

export const runtime = "nodejs";

/** Serves the bundled burn fonts (assets/fonts) to the editor preview so the
 *  browser renders captions/hooks with the exact files libass burns with.
 *  Whitelisted to BURN_FONTS — never a path from the request. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!BURN_FONT_FILES.has(file)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const buf = await readFile(join(hookFontsDir(), file));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
