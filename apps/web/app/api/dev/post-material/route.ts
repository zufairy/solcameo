import { NextRequest, NextResponse } from "next/server";
import { renderMaterial, type MaterialData } from "@/lib/server/postMaterialRender";
import { validMaterial } from "@/lib/server/postMaterialInput";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { format?: string; data?: MaterialData };
    if (!validMaterial(body.data)) return NextResponse.json({ error: "Invalid material data" }, { status: 400 });
    const format = body.format === "gif" ? "gif" : "png";
    const bytes = await renderMaterial(body.data, format);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": `image/${format}`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[post-material] render failed", error);
    return NextResponse.json({ error: "Could not render material" }, { status: 500 });
  }
}
