import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { fetchSelf } from "@/lib/server/fetchInternal";
import { requireInternalOrUserAuth, siwsRequiredResponse } from "@/lib/server/requireAuth";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { getReadRpcUrl, getUsdcMint } from "@/lib/solana/network";
import { captureUrlScreenshots } from "@/lib/server/screenshotUrl";

export const runtime = "nodejs";
// This route does up to ~60s of synchronous product context work (scrape +
// vision + image selection) and THEN awaits /api/agents/run-task, which is
// itself maxDuration=300 and runs full LLM script generation before it returns
// the taskId. At the old 60s cap Vercel killed this invocation mid-await, so
// the client saw a failure even though run-task + the fire-and-forget render
// completed and the video posted to TikTok. Match run-task's 300s budget so the
// route can return { ok, taskId } instead of falsely reporting failure.
export const maxDuration = 300;

/**
 * Verify the hire USDC deposit, retrying over a short window against the
 * flake-tolerant READ rpc (BUG-025b). A tx the client just saw CONFIRMED may not
 * have propagated to the node THIS route hits yet — a single premature
 * "not found" 402 here made the client re-pay (double-charge). Reads never touch
 * the wallet, so getReadRpcUrl (Helius when set) is the right, more reliable
 * source — matching the app's "reads → getReadRpcUrl" convention. Only the
 * transient "not found / not confirmed" case is retried; a definite failure
 * (wrong amount / failed tx / wrong sender) throws immediately.
 */
async function verifyHireDepositWithRetry(
  opts: Parameters<typeof verifyUsdcDeposit>[0],
  cfg: { attempts: number; delayMs: number },
): Promise<void> {
  const connection = new Connection(getReadRpcUrl(), "confirmed");
  let lastErr: unknown;
  for (let i = 0; i < cfg.attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, cfg.delayMs));
    try {
      await verifyUsdcDeposit({ ...opts, connection });
      return;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only propagation lag is worth retrying; a definite mismatch won't change.
      if (!/not found|not confirmed/i.test(msg)) throw e;
    }
  }
  throw lastErr;
}

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const INTERNAL_SECRET = process.env.INTERNAL_CRON_SECRET ?? "";
const KIE_KEY = process.env.KIE_API_KEY ?? "";
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT ?? "";
const KIE_GEMINI_URL = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";

/** Vision-analyze the uploaded product shots into a concrete description the
 *  script generator can sell from (what it is, key visual features, packaging,
 *  who it's for). Returns "" when KIE is unavailable or analysis fails. */
async function describeProductImages(imageUrls: string[]): Promise<string> {
  if (!KIE_KEY || imageUrls.length === 0) return "";
  try {
    const res = await fetch(KIE_GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-6-flash-openai",
        stream: false,
        messages: [
          { role: "system", content: "You are a product copywriter analyzing reference photos for a short ad video. Be concrete and concise." },
          {
            role: "user",
            content: [
              ...imageUrls.slice(0, 3).map((url) => ({ type: "image_url" as const, image_url: { url } })),
              {
                type: "text" as const,
                text: "Describe THIS product for an ad script: what it is, the category, standout visual features (color, shape, packaging, materials, text/logo on it), and who it's for. 60 words max, plain prose, no preamble.",
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }> };
    return (data.choices?.[0]?.message?.content ?? "").trim().slice(0, 600);
  } catch {
    return "";
  }
}

/** Scrape a product page into a compact context block the script generator can
 *  reason over: title, meta/OG description, key headings, and a price hint. */
async function scrapeProduct(url: string): Promise<{ summary: string; image?: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0)" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const meta = (re: RegExp) => html.match(re)?.[1]?.trim();
    const title =
      meta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      meta(/<title[^>]*>([^<]+)<\/title>/i);
    const desc =
      meta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      meta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const siteName = meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
    // Product image, in priority: og:image → twitter:image → JSON-LD Product.image
    // (many e-commerce pages omit OG tags but ship schema.org Product data). The
    // JSON-LD `image` can be a string or an array — grab the first https URL.
    const jsonLdImage = (() => {
      const m = html.match(/"image"\s*:\s*(?:"(https?:\/\/[^"]+)"|\[\s*"(https?:\/\/[^"]+)")/i);
      return m?.[1] || m?.[2];
    })();
    const image =
      meta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      meta(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      jsonLdImage;
    const price =
      meta(/<meta[^>]+property=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/(?:["']price["']\s*:\s*["']?|\bprice["']?\s*:\s*)\$?\s*([0-9][0-9.,]{0,8})/i)?.[1];

    // Headings give product features / selling points.
    const headings = Array.from(html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi))
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 3 && t.length < 90)
      .slice(0, 6);

    const parts = [
      title && `Title: ${title}`,
      siteName && `Brand: ${siteName}`,
      desc && `About: ${desc}`,
      headings.length ? `Highlights: ${headings.join("; ")}` : "",
      price && `Price: ${price}`,
    ].filter(Boolean);

    if (parts.length === 0 && !image) return null;
    return { summary: parts.join(". ").slice(0, 700), image: image || undefined };
  } catch {
    return null;
  }
}

/** Quick preflight: does this URL actually return a fetchable raster image? KIE
 *  rejects the WHOLE request if any reference image 404s or isn't an image, so we
 *  drop bad ones before sending. */
async function isFetchableImage(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url) || /\.(gif|svg)(\?|#|$)/i.test(url)) return false;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0)" },
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return false;
    return /^image\//i.test(r.headers.get("content-type") ?? "");
  } catch {
    return false;
  }
}

/**
 * Hire-flow generation. A client commissions a real, persona-driven video from a
 * hired agent. We scrape the product URL for real context, fold in the client's
 * brief + the agent's standing "Charge Per Video" requirement prompt, then trigger
 * the standard create_video pipeline (run-task → videoJobsGenerate.generate) — which uses
 * the agent's own avatar, voice and persona, so every agent's video is unique.
 */
export async function POST(req: NextRequest) {
  // BUG-025b: track whether the single-use payment proof was consumed and whether
  // the render actually dispatched. The sig is consumed BEFORE dispatch (so
  // concurrent duplicates of one payment can't each fire a render); if anything
  // fails BETWEEN consume and a confirmed dispatch we RELEASE it, so a paying user
  // is never stranded "paid but no render, sig burned" and can retry the SAME
  // payment (no re-pay). Once renderDispatched flips true the consume is permanent.
  let hireConsumed = false;
  let renderDispatched = false;
  let releaseCtx: { convex: ConvexHttpClient; mint: string; txSignature: string } | null = null;
  const releaseHireSig = async () => {
    if (!hireConsumed || renderDispatched || !releaseCtx) return;
    try {
      await releaseCtx.convex.mutation(api.influencers.releaseHireSignature, {
        mintAddress: releaseCtx.mint,
        txSignature: releaseCtx.txSignature,
        authSecret: INTERNAL_SECRET,
      });
      hireConsumed = false; // freed — a retry of this sig may consume it again
    } catch (e) {
      console.warn(`[hire-generate] releaseHireSignature failed (mint=${releaseCtx.mint}): ${e instanceof Error ? e.message : e}`);
    }
  };
  try {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    const body = (await req.json()) as {
      mint?: string;
      productUrl?: string;
      description?: string;
      productImages?: string[];
      appMode?: boolean;
      txSignature?: string;
    };
    const mint = (body.mint ?? "").trim();
    const productUrl = (body.productUrl ?? "").trim();
    // App mode: headlessly screenshot the product URL and use those captures as
    // the product references (for businesses promoting a mobile/web app that
    // don't have product photos to upload).
    const appMode = body.appMode === true;
    const description = (body.description ?? "").trim();
    const productImages = (Array.isArray(body.productImages) ? body.productImages : [])
      .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
      .slice(0, 3);

    if (!mint) return NextResponse.json({ error: "Missing agent mint." }, { status: 400 });
    if (!description && !productUrl && productImages.length === 0) {
      return NextResponse.json({ error: "Add a product image, URL, or description." }, { status: 400 });
    }
    if (!CONVEX_URL) return NextResponse.json({ error: "Backend not configured." }, { status: 500 });

    // Agent persona context — niche, voice, and the standing requirement brief.
    const convex = new ConvexHttpClient(CONVEX_URL);
    const agent = (await convex.query(api.influencers.getByMint, { mintAddress: mint })) as
      | {
          name?: string;
          niche?: string;
          archetype?: string;
          voiceArchetype?: string;
          creatorWallet?: string;
          agentWallet?: string;
          monetization?: { requirementPrompt?: string; costPerVideo?: number };
        }
      | null;
    if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

    // Authoritative price (agent-configured, NEVER a client-supplied figure): the
    // per-video price, or the $1 the hire modal charges when unpriced (GEN_COST) —
    // the exact amount the client pays on-chain in the modal.
    const costUsdc =
      typeof agent.monetization?.costPerVideo === "number" && agent.monetization.costPerVideo > 0
        ? agent.monetization.costPerVideo
        : 1;
    // The wallet the hirer actually paid — the agent's own wallet if set, else the
    // creator's (mirrors the client's payoutWallet = agentWallet || creatorWallet).
    const payoutWallet = agent.agentWallet ?? agent.creatorWallet;

    // ── PAYMENT GATE (BUG-025) ────────────────────────────────────────────────
    // Hiring is a PUBLIC marketplace action — any authenticated user may commission
    // ANY agent (no ownership needed). Authorization is the ON-CHAIN PAYMENT: the
    // hirer pays the agent's per-video price in USDC → the agent's wallet in the
    // modal before this call. This route then forwards to run-task with
    // skipBalanceCheck:true and credits the agent's earnings, so that payment MUST
    // be enforced server-side (the route is independently reachable — trusting the
    // body alone let any signed-in user farm free KIE renders + inject fake
    // earnings). Verify the client's txSignature is a real, confirmed USDC transfer
    // of ≥ the price into the paid wallet, funded by the caller's own SIWS-proven
    // wallet, then consume it single-use — exactly like campaigns/topup,
    // market/buy-shares and nft/mint. Internal (cron/autonomy) callers are pre-trusted.
    if (!auth.internal) {
      const txSignature = (body.txSignature ?? "").trim();
      if (!txSignature) {
        return NextResponse.json({ error: "Missing payment signature." }, { status: 402 });
      }
      if (!payoutWallet) {
        return NextResponse.json({ error: "This agent has no payout wallet." }, { status: 400 });
      }
      // The Ed25519 SIWS-proven wallet is the hirer's identity; bind the on-chain
      // deposit to it so a caller can't present someone else's transfer. Missing →
      // 401 siws_required, which the client's fetch interceptor transparently signs
      // and retries (the same wallet it just paid from).
      const provenWallet = auth.provenWallet;
      if (!provenWallet) return siwsRequiredResponse();
      try {
        await verifyHireDepositWithRetry(
          {
            txSignature,
            escrowOwner: payoutWallet,
            usdcMint: USDC_MINT || getUsdcMint(),
            minAmountUsdc: costUsdc,
            expectedSender: provenWallet,
          },
          { attempts: 4, delayMs: 1500 },
        );
      } catch (e) {
        return NextResponse.json(
          { error: `hire payment not verified: ${(e as Error).message}` },
          { status: 402 },
        );
      }
      // Single-use: consume the signature so one real payment can't be replayed to
      // farm multiple renders/earnings. Mirrors influencers.invest (JOB-85). Consume
      // BEFORE the render dispatches (concurrent duplicates of ONE payment then can't
      // each fire a render); if the render fails to start we RELEASE it below, so a
      // legit payer is never left "paid but no render, sig burned" (BUG-025b).
      try {
        await convex.mutation(api.influencers.consumeHireSignature, {
          mintAddress: mint,
          txSignature,
          usdc: costUsdc,
          authSecret: INTERNAL_SECRET,
        });
        hireConsumed = true;
        releaseCtx = { convex, mint, txSignature };
      } catch (e) {
        const msg = (e as Error).message ?? "";
        return NextResponse.json(
          {
            error: /already processed/i.test(msg)
              ? "This payment was already used for a render."
              : `hire payment not verified: ${msg}`,
          },
          { status: 402 },
        );
      }
    }

    const requirement = agent.monetization?.requirementPrompt?.trim();

    // Gather product context from every source, in parallel:
    //  - scrape the product page (title, description, highlights, price, og:image)
    //  - vision-analyze the uploaded product photos (what it looks like)
    //  - App mode only: headlessly screenshot the URL (best-effort; [] on failure)
    const [scraped, uploadedVision, screenshotImages] = await Promise.all([
      productUrl ? scrapeProduct(productUrl) : Promise.resolve(null),
      describeProductImages(productImages),
      appMode && productUrl ? captureUrlScreenshots(productUrl) : Promise.resolve([]),
    ]);

    // Build the product reference set the RIGHT way — the buyer's UPLOADED photos
    // are authoritative and must be what's sent to Kie:
    //  1. If the buyer uploaded any product photos, those are the product refs.
    //     PREFLIGHT them (Kie rejects the whole request on one bad/unfetchable
    //     image), let Kie Vision pick the best-showing upload as the PRIMARY ref,
    //     and only tack the scraped page image on as a trailing supporting ref —
    //     it must NEVER outrank what the buyer actually uploaded.
    //  2. Only when there is NO usable upload do we fall back to the scraped
    //     og:image as the primary product reference.
    // The video model accepts up to 3 references; the pipeline pairs the primary
    // product image with the agent's face + the generated storyboard downstream.
    // Authoritative refs = the buyer's uploaded photos FIRST, then App-mode URL
    // screenshots (already hosted as Kie-safe .png). Screenshots rank like real
    // uploads so an app with no product photos still gets faithful references;
    // the scraped og:image stays a trailing supporting ref only.
    const uploadedImages = [
      ...productImages,
      ...screenshotImages,
    ].filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
    const scrapedImage = typeof scraped?.image === "string" && /^https?:\/\//i.test(scraped.image)
      ? scraped.image
      : undefined;

    const uploadOk = await Promise.all(uploadedImages.map(isFetchableImage));
    const fetchableUploads = uploadedImages.filter((_, i) => uploadOk[i]);

    let refImages: string[];
    if (fetchableUploads.length > 0) {
      // Buyer uploads win — the FIRST fetchable upload is the primary product ref,
      // remaining uploads next, scraped page image only as a trailing extra. (Dropped
      // a Gemini "pick best" vision call: the reorder gain was marginal and it added a
      // request per hire.)
      refImages = (scrapedImage ? [...fetchableUploads, scrapedImage] : fetchableUploads).slice(0, 3);
    } else {
      // No usable upload → fall back to the scraped page image (preflighted).
      const fallback = [...uploadedImages, scrapedImage].filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
      );
      const fetchOk = await Promise.all(fallback.map(isFetchableImage));
      const fetchable = fallback.filter((_, i) => fetchOk[i]);
      refImages = (fetchable.length > 0 ? fetchable : fallback).slice(0, 3); // last resort
    }

    // Identify the product from its chosen IMAGE when we don't already have an
    // uploaded-photo analysis, so the script knows what it actually looks like.
    let productVision = uploadedVision;
    if (!productVision && refImages[0]) {
      productVision = await describeProductImages([refImages[0]]);
    }

    // campaignContext drives the pipeline's PAID-CAMPAIGN mode: a conversion
    // script that sells THIS product + a storyboard panel that showcases it from
    // the attached reference images. Build a clear product brief from everything.
    const campaignContext = [
      productVision ? `PRODUCT (identified from image): ${productVision}` : "",
      scraped?.summary ? `PRODUCT PAGE: ${scraped.summary}` : "",
      productUrl ? `Link: ${productUrl}` : "",
      description ? `Client's request: ${description}` : "",
      requirement ? `Agent's standing brief: ${requirement}` : "",
      screenshotImages.length ? `${screenshotImages.length} live screenshot(s) of the app/site are attached as references — recreate the real app UI faithfully (same screens, colors, layout).` : "",
      productImages.length ? `${productImages.length} product photo(s) are attached as references — show the product faithfully (same colors, packaging, logo).` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // The topic is the one-line goal; the heavy product detail lives in context.
    const topic = [
      description || `Promote ${scraped?.summary?.split(".")[0] || productVision?.split(".")[0] || `the ${agent.niche ?? "brand"} product`}`,
      `In ${agent.name ?? "this creator"}'s style (${agent.niche ?? "lifestyle"}${agent.voiceArchetype ? ", " + agent.voiceArchetype + " voice" : ""}). Showcase the product.`,
    ]
      .filter(Boolean)
      .join(" — ");

    // Trigger the real create_video pipeline (async; returns the taskId).
    // fetchSelf tries loopback first then the public origin — a container often
    // can't fetch its OWN public URL, which surfaced here as "fetch failed".
    const res = await fetchSelf(`/api/agents/run-task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(INTERNAL_SECRET ? { "X-Internal-Secret": INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({
        mintAddress: mint,
        taskType: "create_video",
        title: `Commissioned · ${(productVision || scraped?.summary || description).slice(0, 40) || "video"}`,
        triggeredBy: "user",
        input: {
          topic,
          productImageUrl: refImages[0],
          campaignImageUrls: refImages,
          campaignContext: campaignContext || undefined,
          // AUTO-POST: a hired UGC agent must publish the video it makes to ALL its
          // connected socials (TikTok/IG/X/…), same as an autonomous run. `[]` =
          // post to every connected account (the all-connected fan-out convention
          // render-step → post_content already handle); the caption is auto-generated
          // from the agent's persona/video settings by create_video. Without this the
          // hire render finished as a silent deliverable and never posted (it only
          // posted when the possibly-stale `social.uploadpost` flag happened to be set).
          autoPost: { platforms: [] as string[] },
          // Client already paid the agent on-chain — don't gate on the agent's
          // own metered USDC balance.
          skipBalanceCheck: true,
          // Idempotency key: the hire modal retries this request up to 3× and the
          // render dispatches fire-and-forget before run-task returns, so a lost
          // response would re-dispatch a fresh Kie render. Keyed on the single-use
          // payment signature, run-task returns the existing render instead of a
          // second one — no wasted tokens, no "3 of the same video".
          renderKey: (body.txSignature ?? "").trim() || undefined,
        },
      }),
    }, req);

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean; taskId?: string; error?: string; message?: string;
    };

    if (!res.ok || !data.taskId) {
      // The render did NOT start — release the single-use payment proof so the
      // paying user can retry the SAME signature without paying again (BUG-025b).
      // create_video throws BEFORE kickoffVideoRender when script-gen fails, so
      // this common failure dispatched no render.
      await releaseHireSig();
      return NextResponse.json(
        { error: data.error ?? data.message ?? "Could not start the video render." },
        { status: res.status === 402 ? 402 : 502 },
      );
    }
    // Render dispatched — lock in the single-use consume (no release past here).
    renderDispatched = true;

    // The hire was paid on-chain to the agent's wallet → record it as the agent's
    // earnings so the marketplace (total earnings, chart, APR) reflects it live,
    // using the authoritative agent-configured price (costUsdc, computed above) —
    // never a client-supplied figure — so earnings can't be inflated.
    //
    // AWAIT + retry the credit (BUG-034): a bare fire-and-forget `.catch(console.warn)`
    // silently and permanently understated the agent's displayed earnings on any
    // transient Convex/network blip (cold start, deploy window). recordHireEarning is
    // idempotent on hireKey, so retrying past a transient failure is safe. The payment
    // and render already succeeded, so a persistent failure is logged as an error
    // (surfaced for follow-up) rather than swallowed — but does not fail the request.
    const hireKey = String(data.taskId ?? body.txSignature ?? Date.now());
    let recorded = false;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
      try {
        await convex.mutation(api.influencers.recordHireEarning, {
          mintAddress: mint,
          usdc: costUsdc,
          hireKey,
          authSecret: INTERNAL_SECRET,
        });
        recorded = true;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!recorded) {
      console.error(
        `[hire-generate] recordHireEarning FAILED after retries (mint=${mint} hireKey=${hireKey} usdc=${costUsdc}):`,
        lastErr instanceof Error ? lastErr.message : lastErr,
      );
    }

    return NextResponse.json({ ok: true, type: "video", taskId: data.taskId });
  } catch (e) {
    // Unexpected failure — if we consumed the sig but never confirmed a dispatch,
    // release it so the payment can be retried without re-paying (BUG-025b).
    await releaseHireSig();
    return NextResponse.json({ error: (e as Error).message ?? "Generation failed" }, { status: 500 });
  }
}
