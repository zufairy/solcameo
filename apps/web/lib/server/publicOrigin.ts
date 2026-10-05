/**
 * The origin a BROWSER used to reach this app. Behind Railway's proxy the Node
 * server listens on 0.0.0.0:3000, so `req.nextUrl.origin` is that internal
 * address, and redirecting to it strands the user on https://0.0.0.0:3000.
 *
 * Order: proxy headers (the real host the browser hit) → the OAuth redirect URI
 * we registered (always the public host) → NEXT_PUBLIC_APP_URL → the request URL.
 */
function clean(raw: string | null | undefined): string {
  const v = (raw ?? "").split(",")[0].trim();
  if (!v) return "";
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).origin;
  } catch {
    return "";
  }
}

const isInternal = (origin: string) => {
  try {
    const h = new URL(origin).hostname;
    return h === "0.0.0.0" || h === "::" || h === "[::]";
  } catch {
    return true;
  }
};

export function publicOrigin(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const host = (req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim() || "https";
  const forwarded = host ? clean(`${proto}://${host}`) : "";
  const candidates = [
    forwarded,
    clean(process.env.X_REDIRECT_URI),
    clean(process.env.NEXT_PUBLIC_APP_URL),
    clean(req.nextUrl.origin),
  ];
  return candidates.find((o) => o && !isInternal(o)) ?? clean(req.nextUrl.origin);
}
