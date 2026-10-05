import { NextRequest, NextResponse } from "next/server";
import { dbcOptionsSchema } from "@/lib/meteora/options";
import { previewDbc } from "@/lib/meteora/curve";
import { readBoundedJson } from "@/lib/server/solstarRoute";
export async function POST(req: NextRequest) {
  const read = await readBoundedJson(req, 2048);
  if (!read.ok) return read.res;
  const parsed = dbcOptionsSchema.safeParse(read.body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose valid opening and graduation caps." },
      { status: 400 },
    );
  try {
    return NextResponse.json(previewDbc(parsed.data));
  } catch {
    return NextResponse.json(
      { error: "This curve cannot be constructed. Adjust the market caps." },
      { status: 400 },
    );
  }
}
