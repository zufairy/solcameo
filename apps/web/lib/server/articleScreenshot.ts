// Real article screenshot for the news-commentary reference-image overlay:
// instead of a loose photo pulled from search results (which may be a stock
// portrait, an unrelated image, or nothing at all), this captures the ACTUAL
// article page — headline, hero image, lede — the same thing a human would
// screenshot to show "here's the story I'm reacting to". Returns null on any
// failure so the caller falls back to the search-photo overlay instead.
//
// NODE-ONLY (launches a native Chromium via playwright-core) — see
// screenshotUrl.ts's own header comment for the same constraint.

import { launchChromium } from "@/lib/server/screenshotUrl";
import { hostBase64ForKie } from "@/lib/server/imageForKie";

const NAV_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 14_000;
// Full desktop viewport, not a mobile/narrow one — a wider capture shows more
// of the page's real layout (hero image + headline + lede together).
const VIEWPORT = { width: 1440, height: 960 };
// Thin white frame so the screenshot doesn't sit flush against the video's
// own pixels — just enough to read as "an inset", not a padded card.
const BORDER = 6;
// Headline-crop padding: how far above/below the <h1>'s own box to include,
// so the crop reads as "the story" (eyebrow/hero image above, lede below) and
// not a bare line of text pasted on a blank background.
const CROP_ABOVE_PX = 120;
const CROP_BELOW_PX = 420;
const MIN_HEADLINE_CHARS = 8;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`article screenshot timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Does this page/title text read as a bot-wall or CAPTCHA challenge rather
 * than the real article? These pages return a normal HTTP 200 (they ARE a
 * real response — just not the one anyone asked for), so the status check
 * alone can't catch them: a "Just a moment…" Cloudflare interstitial, an
 * hCaptcha/reCAPTCHA "verify you're human" page, or a generic "unusual
 * traffic" block would otherwise get screenshotted and shipped as if it were
 * the actual headline. This is the real bug reported: the reference image
 * shown in the finished video was a CAPTCHA page, not the news story.
 * Exported so the detection logic itself is unit-testable without a browser.
 */
export function looksLikeBotChallenge(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /just a moment|checking your browser|verify you are (a )?human|verify you're (a )?human|are you a human|i'm not a robot|attention required|access denied|unusual traffic|security check|enable javascript and cookies|please complete the security check|ray id|cloudflare|pardon our interruption|bot detection|captcha/i.test(t);
}

/**
 * Screenshot `url`'s real article content — a focused crop around the actual
 * headline (eyebrow/hero image above, lede below) when a clear <h1> is found,
 * falling back to the whole above-the-fold desktop view otherwise. Returns a
 * Kie-safe public .png URL, or null on any failure/timeout/bot-wall.
 */
export async function captureHeadlineScreenshot(url: string): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    return await withTimeout(captureInner(url), TOTAL_TIMEOUT_MS);
  } catch (e) {
    console.warn(`[articleScreenshot] capture failed for ${url}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function captureInner(url: string): Promise<string | null> {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: 2, // crisp text — this crop gets shown small, legibility matters most
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // A dead/moved link (404, 410, a redirect to a generic error page) still
    // "loads" — domcontentloaded fires and the page has a real <h1> ("Page
    // Not Found"), which would otherwise ship as if it were the actual
    // headline. Refuse anything but a real 2xx so a stale source link falls
    // back to the search-photo overlay instead of showing an error card.
    const status = res?.status() ?? 0;
    if (status < 200 || status >= 300) throw new Error(`article URL returned HTTP ${status}`);

    // BOT-WALL CHECK #1 (title + a DOM marker scan) — before wasting time
    // dismissing modals on a page that's never going to have the real story.
    // A challenge page's own title ("Just a moment...") is the single most
    // reliable signal; the marker scan (recaptcha/hcaptcha iframes, Cloudflare
    // Turnstile, a #challenge-form) catches the pages whose title doesn't say
    // it outright.
    const title = await page.title().catch(() => "");
    if (looksLikeBotChallenge(title)) throw new Error(`bot-challenge page (title: "${title.slice(0, 80)}")`);
    const challengeMarkers = await page
      .locator('iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="hcaptcha" i], .cf-turnstile, #challenge-form, [data-sitekey], #cf-challenge-running')
      .count()
      .catch(() => 0);
    if (challengeMarkers > 0) throw new Error("bot-challenge page (captcha/turnstile element present)");

    // Dismiss/close common overlay popups before capturing — cookie-consent
    // banners AND promo/rewards/newsletter/anniversary-ad modals all sit
    // directly on top of the exact hero+headline area we want to show, on a
    // huge share of news sites (confirmed live on thestar.com.my: a "Nexus
    // Rewards" modal AND, once that's closed, a SEPARATE "Star 55" ad
    // carousel underneath it — sites stack more than one). Loop a few passes
    // so a second overlay revealed after closing the first still gets
    // closed. Each pass: a close/X control (icon OR "CLOSE" text — safe to
    // click on any modal), else consent-banner text, else Escape. Guessing
    // promo-specific action text ("Next", "Maybe later"...) is deliberately
    // avoided — that risks advancing a real carousel instead of dismissing
    // it. Best-effort with short timeouts; never blocks the capture.
    try {
      for (let pass = 0; pass < 3; pass++) {
        // Not just <button> — a lot of ad/promo takeovers use a <div>/<a>/<span>
        // with a click handler instead of a real button element, so match on
        // accessible attributes OR exact visible text across any tag.
        const byAttr = page.locator('[aria-label*="close" i], [title*="close" i], [class*="close-button" i], [class*="btn-close" i]').first();
        const byText = page.getByText(/^close$/i, { exact: true }).first();
        const byGlyph = page.getByText(/^[×✕✖]$/, { exact: true }).first();
        let clicked = false;
        for (const cand of [byAttr, byText, byGlyph]) {
          if (await cand.isVisible({ timeout: 800 }).catch(() => false)) {
            await cand.click({ timeout: 800 }).catch(() => {});
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          const consent = page.getByText(/accept all|i agree|allow all|got it/i).first();
          if (await consent.isVisible({ timeout: 1000 }).catch(() => false)) {
            await consent.click({ timeout: 1000 }).catch(() => {});
            clicked = true;
          }
        }
        // Escape closes most remaining modal implementations regardless of
        // their button markup — harmless no-op when nothing is open.
        await page.keyboard.press("Escape").catch(() => {});
        if (!clicked) break; // nothing left to dismiss — stop looping
        await page.waitForTimeout(400);
      }
    } catch { /* dismiss loop failed entirely — fine, capture whatever's on screen */ }
    await page.waitForTimeout(300);
    // A short beat for above-the-fold layout/webfonts/images to settle (no
    // networkidle wait — news sites often keep long-poll/ad sockets open).
    await page.waitForTimeout(900);

    // BOT-WALL CHECK #2 — some challenge pages only reveal their real title
    // (or swap in a captcha widget) AFTER the initial script settles, which
    // is exactly the gap the two waits above cover. Same checks, cheap to
    // repeat, and this is the last chance to bail before spending the
    // screenshot + upload cost on a worthless image.
    const settledTitle = await page.title().catch(() => "");
    if (looksLikeBotChallenge(settledTitle)) throw new Error(`bot-challenge page (title after settle: "${settledTitle.slice(0, 80)}")`);
    const settledMarkers = await page
      .locator('iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="hcaptcha" i], .cf-turnstile, #challenge-form, [data-sitekey], #cf-challenge-running')
      .count()
      .catch(() => 0);
    if (settledMarkers > 0) throw new Error("bot-challenge page (captcha/turnstile element present after settle)");

    // FOCUSED CROP: find the real headline and frame a tight, clear crop
    // around it (eyebrow/hero image above, lede below) instead of shipping
    // the whole nav+sidebar+ad-laden viewport — a properly cropped card reads
    // instantly as "the story", where the full page buried it in chrome. Also
    // doubles as bot-wall check #3: a challenge page's own "headline" (e.g.
    // "Verify you are human") gets caught here even if the title/markers
    // above somehow missed it.
    let clip: { x: number; y: number; width: number; height: number } | undefined;
    try {
      const h1 = page.locator("h1").first();
      if (await h1.isVisible({ timeout: 1500 }).catch(() => false)) {
        const h1Text = (await h1.innerText().catch(() => "")).trim();
        if (looksLikeBotChallenge(h1Text)) throw new Error(`bot-challenge page (headline: "${h1Text.slice(0, 80)}")`);
        if (h1Text.length >= MIN_HEADLINE_CHARS) {
          const box = await h1.boundingBox().catch(() => null);
          if (box) {
            const top = Math.max(0, box.y - CROP_ABOVE_PX);
            const bottom = Math.min(VIEWPORT.height, box.y + box.height + CROP_BELOW_PX);
            if (bottom - top >= 200) clip = { x: 0, y: top, width: VIEWPORT.width, height: bottom - top };
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && /bot-challenge/.test(e.message)) throw e;
      // Any other headline-lookup failure just means "no good crop found" —
      // fall through to the full-viewport capture below.
    }

    const full = await page.screenshot({ type: "png", ...(clip ? { clip } : {}) });
    if (clip) console.log(`[articleScreenshot] focused headline crop for ${url} (${Math.round(clip.height)}px tall)`);

    // Thin white frame so it reads as an inset over the video, not flush
    // against it.
    const sharp = (await import("sharp")).default;
    const framed = await sharp(full)
      .extend({ top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, background: "#ffffff" })
      .png()
      .toBuffer();

    const hosted = await hostBase64ForKie(framed.toString("base64"));
    if (hosted) console.log(`[articleScreenshot] captured ${clip ? "cropped headline" : "full-page"} screenshot for ${url}`);
    return hosted ?? null;
  } finally {
    await browser.close().catch(() => {});
  }
}
