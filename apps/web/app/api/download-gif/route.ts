import { NextRequest, NextResponse } from "next/server";
import { safeFetchToBuffer } from "@/lib/server/downloader";

export const runtime = "nodejs";

// Same-origin download proxy for the generated NFT GIF.
//
// Fetching the Supabase-hosted GIF directly in the browser (fetch + blob) is
// fragile: it depends on the storage bucket's CORS config, and when it fails the
// player could only fall back to opening the file in a new tab — not a real
// download. Routing through this route means:
//   • the fetch happens server-side → no browser CORS at all
//   • we set Content-Disposition: attachment → a genuine "Save as" download
const ALLOWED_HOSTS = [
  "supabase.co",      // Supabase storage public URLs (vello-avatars bucket)
  "supabase.in",
  "kie.ai",
  "aiquickdraw.com",
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const rawName = req.nextUrl.searchParams.get("name") || "vello-nft.gif";

  if (!url) return new NextResponse("Missing url param", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  const host = parsed.hostname;
  if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return new NextResponse("URL not allowed", { status: 403 });
  }

  // SSRF-safe fetch: the one-time host allowlist above only guards the FIRST hop.
  // safeFetchToBuffer follows redirects MANUALLY and re-validates EVERY hop against
  // the private/loopback/link-local/metadata block-list (and caps byte size), so an
  // allowed host can't 30x-bounce the server onto an internal address (e.g. the
  // cloud metadata endpoint) and exfiltrate its response to the caller.
  let buffer: Buffer;
  let mime: string;
  try {
    const out = await safeFetchToBuffer(url, { timeoutMs: 30_000, maxBytes: 50 * 1024 * 1024 });
    buffer = out.buffer;
    mime = out.mime;
  } catch (err) {
    console.error("[download-gif] upstream fetch failed:", err);
    return new NextResponse("Upstream fetch failed", { status: 502 });
  }

  // Sanitize filename for the header (strip anything outside a safe set).
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "vello-nft.gif";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mime || "image/gif",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
