const matches = (p: string, prefix: string) => p === prefix || p.startsWith(prefix + "/");

// Routes that render their own full-page nav/header (or are full-screen apps).
const OWN_CHROME = ["/create", "/ai-influencer", "/builder", "/login", "/pricing", "/docs", "/blog", "/vs", "/hiring", "/1b-club", "/node", "/landing", "/landing2"];

/**
 * Pure decision: should the global Solstar shell (left rail + top bar) wrap this path?
 * The shell owns all app chrome; routes with their own full nav opt out.
 * The legacy landing ("/" and "/ai-influencer") has its own nav, so it opts out only
 * when the legacy flag is on.
 */
export function shouldUseShell(pathname: string, legacy: boolean): boolean {
  if (OWN_CHROME.some((x) => matches(pathname, x))) return false;
  if (legacy && (pathname === "/" || matches(pathname, "/ai-influencer"))) return false;
  return true;
}
