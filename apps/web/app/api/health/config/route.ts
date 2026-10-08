import { NextResponse } from "next/server";
import { selfOrigins } from "@/lib/server/selfOrigin";
import { mediaPackConfigured } from "@/lib/server/mediaPackBase";
import { r2ImageConfigured } from "@/lib/server/imageStorage";

export async function GET(req: Request) {
  // Cheap self-probe target (see originChecks below). Answered BEFORE any work so
  // the probe can never recurse into another probe.
  if (new URL(req.url).searchParams.get("probe") === "1") {
    return NextResponse.json({ ok: true, probe: true });
  }

  // ?probe=youtube — can THIS server pull YouTube on its own (no proxy)? Runs a
  // real audio pull of a 19s public video through the production yt-dlp path
  // and reports the exact reason when it can't. Secret-gated (it spends a
  // download); answers "is it the bot wall / stale yt-dlp / POT provider?".
  if (new URL(req.url).searchParams.get("probe") === "youtube") {
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!secret || req.headers.get("X-Internal-Secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveDownloader, summarizeYtdlpError, proxyExhausted } = await import("@/lib/server/downloader");
    const workDir = await mkdtemp(join(tmpdir(), "yt-probe-"));
    const started = Date.now();
    const url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
    try {
      // ?via=warp: prove the free WARP route (scripts/warp.sh) instead of our own IP.
      const viaWarp = new URL(req.url).searchParams.get("via") === "warp";
      await resolveDownloader(url).fetchSource(url, { mode: "audio", workDir, directOnly: !viaWarp, retryBudgetMs: 90_000 });
      return NextResponse.json({ ok: true, direct: !viaWarp, via: viaWarp ? "warp" : "direct", ms: Date.now() - started, proxyExhausted: proxyExhausted() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({
        ok: false, direct: false, ms: Date.now() - started, error: summarizeYtdlpError(msg), raw: msg.slice(0, 600),
        potProvider: Boolean(process.env.YTDLP_POT_PROVIDER_URL?.trim()), cookies: Boolean(process.env.YTDLP_COOKIES?.trim()),
        proxyExhausted: proxyExhausted(),
        // Real user downloads fall back to the managed residential downloader
        // (lib/server/managedYoutube) when this is true; the probe itself never does.
        managedFallback: Boolean(process.env.APIFY_TOKEN?.trim()),
        warp: Boolean(process.env.YTDLP_WARP_PROXY?.trim()),
      });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const nextEnv = {
    NEXT_PUBLIC_CONVEX_URL: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim()),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()),
    NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
    NEXT_PUBLIC_SITE_URL: Boolean(process.env.NEXT_PUBLIC_SITE_URL?.trim()),
  };

  const serverEnv = {
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    // R2 holds EVERY image + video blob (avatars, Kie refs, renders). The Supabase
    // project is dead (402) so missing R2 env = every avatar mint / video save fails.
    R2_ACCOUNT_ID: Boolean(process.env.R2_ACCOUNT_ID?.trim()),
    R2_ACCESS_KEY_ID: Boolean(process.env.R2_ACCESS_KEY_ID?.trim()),
    R2_SECRET_ACCESS_KEY: Boolean(process.env.R2_SECRET_ACCESS_KEY?.trim()),
    R2_BUCKET: Boolean(process.env.R2_BUCKET?.trim()),
    R2_PUBLIC_BASE_URL: Boolean(process.env.R2_PUBLIC_BASE_URL?.trim()),
    R2_STORAGE: r2ImageConfigured(),
    GOOGLE_DRIVE_API_KEY: Boolean(process.env.GOOGLE_DRIVE_API_KEY?.trim()),
    GOOGLE_SERVICE_ACCOUNT_JSON: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()),
    UPLOAD_POST_API_KEY: Boolean(process.env.UPLOAD_POST_API_KEY?.trim()),
    // Pays the network fee when an agent wallet holds no SOL (generation payments and fee settlements depend on it).
    PLATFORM_FEE_PAYER_SECRET: Boolean(process.env.PLATFORM_FEE_PAYER_SECRET?.trim()),
    JUPITER_API_KEY: Boolean(process.env.JUPITER_API_KEY?.trim()),
    KIE_API_KEY: Boolean(process.env.KIE_API_KEY?.trim()),
    GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY?.trim()),
    INTERNAL_CRON_SECRET: Boolean(process.env.INTERNAL_CRON_SECRET?.trim()),
    // YouTube ingest unblocking (yt-dlp). At least one of PROXY/COOKIES is required
    // for YouTube sources — datacenter IPs get bot-walled. Drive/.mp4 are unaffected.
    YTDLP_PROXY: Boolean(process.env.YTDLP_PROXY?.trim()),
    YTDLP_COOKIES: Boolean(process.env.YTDLP_COOKIES?.trim()),
    YTDLP_PLAYER_CLIENT: Boolean(process.env.YTDLP_PLAYER_CLIENT?.trim()),
    // Free unblocker: bgutil PO-token provider (Dockerfile + scripts/start.sh).
    // Reported as REACHABLE, not merely configured — a dead provider means every
    // direct attempt is walled and the proxy pays for everything again.
    YTDLP_POT_PROVIDER: await (async () => {
      const base = process.env.YTDLP_POT_PROVIDER_URL?.trim();
      if (!base) return false;
      try {
        const r = await fetch(`${base.replace(/\/+$/, "")}/ping`, { signal: AbortSignal.timeout(1500) });
        return r.ok;
      } catch { return false; }
    })(),
    YTDLP_DIRECT_FIRST: process.env.YTDLP_DIRECT_FIRST?.trim() !== "0",
    // MEDIA PACKS. Reported as RESOLVABLE: a var pointing at the dead Supabase host
    // counts as unset (see mediaPackBase). This is here because the readiness
    // line an operator sees ("✓ Trending Audio ready") is printed by the CONVEX
    // action while the URL is resolved in THIS process — a var set in one env and
    // missing in the other produced a ready-looking run with a silent video.
    TRENDING_AUDIO_PACK: mediaPackConfigured("TRENDING_AUDIO_BASE_URL", "trending-audio"),
    REACTION_SFX_PACK: mediaPackConfigured("REACTION_SFX_BASE_URL", "sfx"),
    GAMEPLAY_PACK: mediaPackConfigured("GAMEPLAY_PACK_BASE_URL", "gameplay"),
  };

  const warnings: string[] = [];
  let feePayer: { sol: number | null; ready: boolean } | null = null;

  if (!nextEnv.NEXT_PUBLIC_CONVEX_URL) {
    warnings.push("Missing NEXT_PUBLIC_CONVEX_URL in the Next.js deployment. Client-side Convex data will not load.");
  }
  if (!serverEnv.R2_STORAGE) {
    warnings.push("Missing R2_* env (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL) in the Next.js deployment. Avatar generation, Kie reference hosting and video saves will fail.");
  }
  if (!serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    warnings.push("Missing SUPABASE_SERVICE_ROLE_KEY. Legacy reward submissions/views and stock clips still use Supabase; Stage campaigns and new media use Convex/R2.");
  }
  if (!serverEnv.GOOGLE_DRIVE_API_KEY && !serverEnv.GOOGLE_SERVICE_ACCOUNT_JSON) {
    warnings.push("No GOOGLE_DRIVE_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON. Google Drive FOLDER campaign sources cannot be listed/expanded (single public files still download).");
  }
  if (!serverEnv.UPLOAD_POST_API_KEY) {
    warnings.push("Missing UPLOAD_POST_API_KEY. Social connect + auto-post are disabled (skipped).");
  }
  if (!serverEnv.PLATFORM_FEE_PAYER_SECRET) {
    warnings.push("Missing PLATFORM_FEE_PAYER_SECRET. Agent wallets with no SOL cannot pay network fees, so their generation payments and fee settlements stall.");
  } else {
    // The fallback only works while this wallet holds SOL.
    const { feePayerSol } = await import("@/lib/server/solSwap");
    const sol = await feePayerSol();
    feePayer = { sol, ready: sol !== null && sol >= 0.0005 };
    if (!feePayer.ready) warnings.push(`The fee-payer wallet has ${sol === null ? "an unreadable balance" : `${sol.toFixed(5)} SOL`}. Fund it (about 0.05 SOL) so agent wallets with no SOL can still pay.`);
  }
  if (!serverEnv.GEMINI_API_KEY) {
    warnings.push("Missing GEMINI_API_KEY. Every chat (builder copilot, agent chat, control panel, help widget) falls back to Kie's queue — ~30s per reply instead of ~2s.");
  }
  if (!serverEnv.KIE_API_KEY) {
    warnings.push("Missing KIE_API_KEY in the Next.js deployment. Transcription + caption generation will fail.");
  }
  if (!serverEnv.TRENDING_AUDIO_PACK) {
    warnings.push("Trending Audio can't resolve its music pack: set R2_PUBLIC_BASE_URL (packs live on R2 under trending-audio/) or TRENDING_AUDIO_BASE_URL — the Music tool will render silently.");
  }
  if (!serverEnv.REACTION_SFX_PACK) {
    warnings.push("Reaction SFX pack can't resolve: set R2_PUBLIC_BASE_URL (sounds live on R2 under sfx/, uploaded by scripts/upload-reaction-sfx-to-r2.ts) or REACTION_SFX_BASE_URL — the Sound Effect tool / Meme SFX will be silent.");
  }
  if (!serverEnv.YTDLP_PROXY && !serverEnv.YTDLP_COOKIES && !serverEnv.YTDLP_POT_PROVIDER) {
    warnings.push("No YTDLP_COOKIES, no reachable PO-token provider, no YTDLP_PROXY. YouTube sources will be bot-blocked (\"confirm you're not a bot\"). Set YTDLP_COOKIES to a signed-in cookies.txt export (free), make sure the bgutil provider is running (scripts/start.sh), or set YTDLP_PROXY as the paid fallback. Google Drive + direct .mp4 sources still work.");
  } else if (!serverEnv.YTDLP_COOKIES) {
    warnings.push("YTDLP_COOKIES is unset. Direct (no-proxy) YouTube pulls pass far more often with a signed-in cookies.txt export — without it more videos fall back to the paid residential proxy.");
  } else if (!serverEnv.YTDLP_POT_PROVIDER && process.env.YTDLP_POT_PROVIDER_URL) {
    warnings.push("YTDLP_POT_PROVIDER_URL is set but the provider isn't answering /ping. Direct YouTube pulls will be walled until it's up (check scripts/start.sh logs); the proxy fallback is paying for every download meanwhile.");
  }

  // CALLBACK-ORIGIN TLS PROBE. Convex reaches this app over plain HTTPS with a
  // STRICT verifier (Rust/reqwest + BoringSSL). When Railway's custom-domain cert
  // is missing/stale the edge answers with its *.up.railway.app wildcard instead
  // and every Convex → Next hop dies at CONNECT with CERTIFICATE_VERIFY_FAILED —
  // which the builder only ever showed as "Clipping failed: error sending request".
  // Node's fetch verifies the same way, so probing here reproduces it exactly and
  // names the broken origin instead of leaving it to be guessed from a run log.
  const origins = selfOrigins();
  const originChecks = await Promise.all(
    origins.map(async (origin) => {
      try {
        const r = await fetch(`${origin}/api/health/config?probe=1`, { signal: AbortSignal.timeout(8000) });
        return { origin, ok: r.ok, status: r.status };
      } catch (e) {
        return { origin, ok: false, error: e instanceof Error ? (e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message) : String(e) };
      }
    }),
  );
  if (origins.length === 0) {
    warnings.push("No callback origin resolvable (INTERNAL_APP_URL / RAILWAY_PUBLIC_DOMAIN / NEXT_PUBLIC_APP_URL all empty). Convex cannot call back into this app — clipping, crons and oracle runs will all fail.");
  } else if (originChecks.every((c) => !c.ok)) {
    warnings.push(`Every callback origin failed a strict TLS/HTTP probe (${originChecks.map((c) => `${c.origin}: ${"error" in c ? c.error : c.status}`).join("; ")}). If this is CERTIFICATE_VERIFY_FAILED, the domain's cert is invalid — re-issue the Railway custom-domain cert, or set INTERNAL_APP_URL (Next + Convex env) to the *.up.railway.app origin.`);
  } else if (originChecks.some((c) => !c.ok)) {
    warnings.push(`Callback origin degraded — ${originChecks.filter((c) => !c.ok).map((c) => c.origin).join(", ")} unreachable; server-to-server calls are failing over to ${originChecks.find((c) => c.ok)!.origin}.`);
  }

  // THE OTHER HALF of the same question: what does CONVEX think this app's origin
  // is? Its env is edited in a separate console, so it goes stale on a domain move
  // and keeps calling a retired host — the failure the builder showed as
  // "error sending request … CERTIFICATE_VERIFY_FAILED". Reading the deployment's
  // own resolved list makes the mismatch visible here instead of in a run log.
  let convexOrigins: { origins: string[] } | { error: string } = { error: "not checked" };
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    convexOrigins = { error: "NEXT_PUBLIC_CONVEX_URL not set" };
  } else {
    try {
      const { ConvexHttpClient } = await import("convex/browser");
      const { api } = await import("@/convex/_generated/api");
      convexOrigins = (await new ConvexHttpClient(convexUrl).query(api.health.callbackOrigins, {})) as { origins: string[] };
      const first = convexOrigins.origins?.[0];
      const reachable = new Set(originChecks.filter((c) => c.ok).map((c) => c.origin));
      if (first && !reachable.has(first)) {
        warnings.push(`Convex calls this app on ${first} first, which is NOT a verified-reachable origin here (${[...reachable].join(", ") || "none"}). Update NEXT_PUBLIC_APP_URL in the CONVEX deployment env — that env is separate from Railway's and does not change when the domain does.`);
      }
    } catch (e) {
      convexOrigins = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    ok: warnings.length === 0,
    nextEnv,
    serverEnv,
    feePayer,
    originChecks,
    convexOrigins,
    warnings,
    notes: [
      "NEXT_PUBLIC_* values must be present before the Railway build starts.",
      "Convex authentication uses PRIVY_APP_ID and PRIVY_APP_SECRET in its own deployment env; it does not need Supabase auth keys.",
    ],
  });
}
