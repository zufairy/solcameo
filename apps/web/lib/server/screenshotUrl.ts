// App-mode reference capture: headlessly screenshot a URL and return Kie-safe
// public `.png` URLs to use as product references in a hired-agent video.
//
// WHY Playwright (not @xata.io/screenshot): the latter is a client-side
// getDisplayMedia screen-share tool that requires the user to pick a tab and
// grant permission — it can't auto-capture a URL server-side. playwright-core
// drives a real headless Chromium, which is exactly what "auto screenshot the
// app/website" needs.
//
// NODE-ONLY: launches a native Chromium process. Import only from Next.js route
// handlers on the Node runtime — never from anything Convex bundles.
//
// BEST-EFFORT: every path is guarded. On any failure this returns [] so the
// caller falls back to the existing scrape flow — a screenshot problem must
// never block a paid render.

import { hostBase64ForKie } from "@/lib/server/imageForKie";

// The Docker image installs the distro Chromium here (see Dockerfile runner
// stage). Locally, set PLAYWRIGHT_CHROMIUM_PATH to a Chrome/Chromium binary, or
// leave it unset to let playwright-core use a `playwright install`-managed build.
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || "";

// Overall wall-clock ceiling for the whole capture. hire-generate runs with
// maxDuration 60 and does other work too, so keep this well under that.
const TOTAL_TIMEOUT_MS = 25_000;
const NAV_TIMEOUT_MS = 15_000;
const VIEWPORT_WEB = { width: 1280, height: 800 };
// "App" mode — a phone-shaped viewport so a mobile app landing page / app-store
// page screenshots in its native aspect instead of being letterboxed inside a
// desktop frame.
const VIEWPORT_APP = { width: 390, height: 844 };

/** Run `p`, but reject if it takes longer than `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Headlessly screenshot `url` and return up to 3 Kie-safe public `.png` URLs.
 * Captures the above-the-fold hero plus one or two scrolled sections so the
 * video model gets real, varied views of the app/site.
 */
export async function captureUrlScreenshots(url: string, opts?: { device?: "web" | "app"; timeoutMs?: number }): Promise<string[]> {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  const viewport = opts?.device === "app" ? VIEWPORT_APP : VIEWPORT_WEB;
  const timeoutMs = opts?.timeoutMs ?? TOTAL_TIMEOUT_MS;
  try {
    return await withTimeout(captureInner(url, viewport), timeoutMs, "screenshot capture");
  } catch (e) {
    console.warn("[screenshotUrl] capture failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Launch a headless Chromium, trying each viable source in order so the same code
 * works in prod AND local/dev without configuration:
 *   1. PLAYWRIGHT_CHROMIUM_PATH  — the distro Chromium provisioned in Docker.
 *   2. channel "chrome"          — a system Google Chrome/Chromium (dev machines).
 *   3. default                   — a `playwright install`-managed browser.
 * Returns the first browser that launches; throws only if every source fails.
 */
export async function launchChromium() {
  const { chromium } = await import("playwright-core");
  const baseArgs = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    // Headless-container noise reduction: the Docker runner has no GPU, audio, or
    // dbus daemon, so disabling those services (and, via the env below, the dbus
    // probe) silences the repeated `dbus/bus.cc:405 Failed to connect to the bus`
    // and GPU log spam WITHOUT changing the captured pixels. Best-effort capture
    // already falls back on any real failure, so these are purely cosmetic.
    "--disable-gpu", "--disable-software-rasterizer", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  ];
  // DBUS_SESSION_BUS_ADDRESS=/dev/null makes Chromium stop trying to reach a
  // system/session bus that doesn't exist in the container — the direct cause of
  // the "Failed to connect to the bus" errors. Merge (not replace) process.env so
  // the browser keeps PATH etc.; filter out undefined for the strict env type.
  const launchEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") launchEnv[k] = v;
  launchEnv.DBUS_SESSION_BUS_ADDRESS = "/dev/null";
  const strategies: Array<{ label: string; opts: Record<string, unknown> }> = [
    ...(CHROMIUM_PATH ? [{ label: `path:${CHROMIUM_PATH}`, opts: { executablePath: CHROMIUM_PATH } }] : []),
    { label: "channel:chrome", opts: { channel: "chrome" } },
    { label: "managed", opts: {} },
  ];
  let lastErr: unknown;
  for (const s of strategies) {
    try {
      return await chromium.launch({ headless: true, args: baseArgs, env: launchEnv, ...s.opts });
    } catch (e) {
      lastErr = e;
      console.warn(`[screenshotUrl] launch ${s.label} failed:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastErr ?? new Error("no chromium available");
}

async function captureInner(url: string, viewport: { width: number; height: number }): Promise<string[]> {
  const browser = await launchChromium();

  try {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 2, // crisp captures for the video model
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });

    // networkidle can hang on pages with long-poll/analytics sockets, so fall
    // back to domcontentloaded, then give the page a short beat to paint.
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    } catch {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    }
    await page.waitForTimeout(1200);

    // How far can we scroll? Decides whether the section frames are worth taking.
    const scrollHeight = await page
      .evaluate(() => document.body?.scrollHeight ?? 0)
      .catch(() => 0);

    const shots: Buffer[] = [];

    // 1) Hero / above-the-fold — the strongest single frame of the app.
    shots.push(await page.screenshot({ type: "png" }));

    // 2) A mid-page section, if the page is tall enough to have one.
    if (scrollHeight > viewport.height * 1.6) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollHeight * 0.4));
      await page.waitForTimeout(600);
      shots.push(await page.screenshot({ type: "png" }));
    }

    // 3) A lower section for even taller pages.
    if (scrollHeight > viewport.height * 2.8) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollHeight * 0.72));
      await page.waitForTimeout(600);
      shots.push(await page.screenshot({ type: "png" }));
    }

    // Host each frame as a Kie-safe public .png (hostBase64ForKie transcodes +
    // uploads via sharp/Supabase — the same path uploaded photos take).
    const hosted = await Promise.all(
      shots.slice(0, 3).map((buf, i) => hostBase64ForKie(buf.toString("base64"), i)),
    );
    const urls = hosted.filter((u): u is string => !!u);
    console.log(`[screenshotUrl] captured ${urls.length} frame(s) for ${url}`);
    return urls;
  } finally {
    await browser.close().catch(() => {});
  }
}
