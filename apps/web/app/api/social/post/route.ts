import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { refundImage } from "@/lib/server/imageBilling";
import { randomUUID } from "node:crypto";
import { withTicker } from "@/lib/marketingCaption";
import { NextRequest, NextResponse } from "next/server";
import {
  isConfigured,
  NotConfiguredError,
  getProfile,
  uploadText,
  uploadPhotos,
  uploadVideo,
  UPLOAD_POST_PLATFORMS,
  PLATFORM_IDS,
  resolveUsername,
  extractPostUrlFromResult,
  getLatestPostLink,
  formatPlatformFailures,
  type PostResult,
} from "@/lib/server/uploadPost";
import { submitContentRewardLink } from "@/lib/server/contentRewardSubmit";
import { registerMeasurementHandle } from "@/lib/server/registerMeasurementHandle";
import { resolveDescriptionInstruction, generatePostCaption, generateYoutubeTitle, meaningfulBasis, isPlaceholderClipTitle } from "@/lib/server/captionTransform";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { runGuardrails, guardrailsEnabled, scrubProfanity } from "@/lib/server/guardrails";
import { readCoverImageUrl } from "@/lib/builder/coverImageConfig";
import { getTiktokCoverVideoUrl, TIKTOK_COVER_TIMESTAMP_MS } from "@/lib/server/tiktokCoverBurn";
import { prepareYouTubeShort, ShortsPreparationError } from "@/lib/server/verticalizeForShorts";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Video posts are slow (upload-post fetches the clip + pushes to each platform), so
// give the route room instead of letting it get cut off at a short default and
// surface as a gateway 502. Node runtime — the upload stack uses Node APIs.
export const runtime = "nodejs";
export const maxDuration = 300;

type PostType = "text" | "photo" | "video";

// Posts content to one or more connected platforms via upload-post.
// Body: { username, platforms[], type, title, mediaUrls?[], description? }
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "Social posting isn't configured yet (UPLOAD_POST_API_KEY missing)." },
      { status: 503 },
    );
  }

  let body: {
    username?: string;
    platforms?: string[];
    type?: PostType;
    title?: string;
    description?: string;
    mediaUrls?: string[];
    tiktokTitle?: string;
    postMode?: "DIRECT_POST" | "MEDIA_UPLOAD";
    privacyLevel?: string;
    autoAddMusic?: boolean;
    disableComment?: boolean;
    brandContentToggle?: boolean;
    brandOrganicToggle?: boolean;
    photoCoverIndex?: number;
    /** Instagram media_type ("IMAGE" | "STORIES") — carousels auto-handle. */
    mediaType?: string;
    /** carouselImages row ids (Photo Carousel Builder) to mark "posted" on success. */
    carouselImageIds?: string[];
    /** The caller's `title` IS the final caption the operator wrote/approved
     *  (Editor tab Post Captions tool → Apply modal). Skip the Smart Captions
     *  persona regeneration below — it used to silently replace what the
     *  operator typed, so the published post never matched the editor. */
    captionLocked?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const mintAddress = (body.username ?? "").trim();
  const username = resolveUsername(mintAddress);
  const title = (body.title ?? "").trim();
  const type: PostType = body.type ?? (body.mediaUrls?.length ? "video" : "text");
  // Normalize the X alias (upload-post's video endpoint keys X as "twitter") to our
  // canonical "x" before validating, so a client that sent "twitter" isn't dropped.
  const normPlatform = (p: string) => (p === "twitter" ? "x" : p);
  let requested = (body.platforms ?? []).map(normPlatform).filter((p) => PLATFORM_IDS.includes(p));

  if (!username) return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });

  // Ownership: body.username is the agent's public mintAddress, so verify the
  // caller owns this agent before posting on its behalf. This gate must fail
  // CLOSED — if Convex isn't configured we cannot resolve the owner, so deny
  // rather than skip the check. No-ops for legacy/pre-mint agents (getByMintServer
  // null → unset creatorWallet → checkOwnership skips); a query error (bad secret)
  // throws and denies (it propagates before any upload-post side-effect below).
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  // SMART CAPTIONS: generate the post caption from the agent's installed Smart
  // Captions persona (clip.captionstyle) instead of posting the bare clip title.
  // The persona governs language/tone/tags/hashtags; the clip's title/description is
  // the basis. Applies to media posts (video/photo); best-effort — any failure
  // falls back to the caller-supplied text so a post never blocks on the LLM.
  //
  // IMPORTANT: upload-post uses the `title` field as the CAPTION on TikTok /
  // Instagram / X / Threads / Facebook (description is largely a YouTube-only field),
  // so the generated caption must drive BOTH — otherwise the platforms keep showing
  // the original clip title. Mirrors the auto-post path (run-task sets title = text).
  // A placeholder clip label ("Clip 2") is a row title, not post copy — blank it so
  // Smart Captions (or the bare-post path) decides what actually gets published.
  let effectiveTitle = isPlaceholderClipTitle(title) ? "" : title;
  let effectiveDescription = body.description;
  let captionSource: "persona" | "no_persona" | "llm_empty" | "error" | "operator" = "no_persona";
  const captionLocked = body.captionLocked === true && effectiveTitle.length > 0;
  if (captionLocked) { effectiveDescription = effectiveDescription || effectiveTitle; captionSource = "operator"; }
  // The agent's installed AI-Clipper apps. Fetched once here and reused by the
  // guardrails gate below — a clipper's installs live in THIS table, never in
  // `installedSkills` (see guardrailsEnabled).
  let clipSkillRows: { skillId: string; wired?: boolean; config?: { captionPrompt?: string; descriptionPrompt?: string; descFromCaption?: boolean } }[] = [];
  // Cover Image tool (Editor tab) — same agentSkillFiles fetch as clipSkillRows
  // above, just read for the `clip.cover` row instead. See coverImageConfig.ts.
  let coverImageUrl: string | undefined;
  if (type !== "text") {
    try {
      const files = (await convex.query(api.agentSkillFiles.listByMint, { mintAddress })) as
        | { skillId: string; wired?: boolean; config?: unknown }[]
        | null;
      clipSkillRows = Array.isArray(files) ? (files as typeof clipSkillRows) : [];
      coverImageUrl = readCoverImageUrl((files ?? []).find((f) => f.skillId === "clip.cover")?.config);
      const captionStyleRow = clipSkillRows.find((f) => f.skillId === "clip.captionstyle");
      // INSTALLED (row present + node still wired) is what turns Smart Captions on —
      // not merely "a prompt was typed". An installed-but-unconfigured app used to
      // fall through silently, which is how a post went out titled "Clip 2".
      const captionStyleInstalled = !!captionStyleRow && captionStyleRow.wired !== false;
      const influencerX = requested.includes("x") && agent && (agent.agentType ?? "influencer") === "influencer";
      const instruction = captionLocked ? "" : resolveDescriptionInstruction(captionStyleRow?.config ?? {}, { installed: captionStyleInstalled }) || (influencerX
        ? `Write as ${agent.name}, a ${agent.archetype} influencer in ${agent.niche}, in ${agent.language || "English"}. ${agent.description ?? ""} Open with a specific hook grounded in the content, then one natural call to action when appropriate. No invented claims, hashtags, or preamble. Keep the complete X post under 280 characters.`
        : "");
      if (instruction) {
        // A placeholder title is not a description of anything — never feed it to
        // the model as "what the clip says".
        const basis = meaningfulBasis(body.description, title);
        const generated = await generatePostCaption({ instruction, basis });
        if (generated) {
          effectiveTitle = generated;
          effectiveDescription = generated;
          captionSource = "persona";
        } else {
          captionSource = "llm_empty";
        }
      }
    } catch {
      if (!captionLocked) captionSource = "error"; // best-effort — keep the caller-supplied text
    }
    console.log(`[social/post] caption source for ${mintAddress}: ${captionSource}`);
  }
  // ROBUST "post everywhere": if the caller sent no/invalid platforms (e.g. the
  // operator never pinned specific channels, so the client passes an empty list),
  // fall back to the agent's CONNECTED accounts (cached by /api/social/status) so
  // the post still goes out instead of a confusing 400. Only 400 when genuinely
  // nothing is connected to post to.
  if (requested.length === 0) {
    const connectedCache = ((agent as { connectedPlatforms?: string[] } | null)?.connectedPlatforms ?? [])
      .filter((p) => PLATFORM_IDS.includes(p));
    if (connectedCache.length > 0) {
      requested = connectedCache;
    } else {
      // No cache — resolve LIVE from the upload-post profile before giving up.
      try {
        const prof = await getProfile(username);
        requested = Object.entries(prof.connected)
          .filter(([, v]) => Boolean(v))
          .map(([k]) => k)
          .filter((p) => PLATFORM_IDS.includes(p));
      } catch { /* fall through to the 400 below */ }
    }
  }
  if (requested.length === 0) return NextResponse.json({ ok: false, error: "No connected accounts to post to. Connect X / YouTube / TikTok in the Posting tab first." }, { status: 400 });
  if (!title && type === "text") return NextResponse.json({ ok: false, error: "title (text) is required for text posts" }, { status: 400 });

  // Keep only platforms that support the requested post type.
  const capable = requested.filter((id) => {
    const cfg = UPLOAD_POST_PLATFORMS.find((p) => p.id === id);
    return cfg ? cfg[type] : false;
  });
  const skipped = requested.filter((p) => !capable.includes(p));
  if (capable.length === 0) {
    return NextResponse.json(
      { ok: false, error: `None of the selected platforms support ${type} posts.`, skipped },
      { status: 400 },
    );
  }

  // ATOMIC CROSS-PATH CLAIM (video posts only): before uploading a clip we flip
  // its clips row "ready" → "posting" so this manual "Post now" can't race the
  // drip cron (drainDueClips) or the inline auto-post (clipJobs.process) — both
  // of which claim the same clips row via claimClipForPostingByUrl. Whoever wins
  // the ready→posting transition posts; the losers skip. `clipClaimed` records
  // whether WE won, so a post FAILURE can revert the badge off "posting" (and we
  // never revert a clip another path is legitimately publishing).
  let clipClaimed = false;
  const videoClipUrl = type === "video" ? (body.mediaUrls ?? [])[0] : undefined;
  if (type === "video" && secret && videoClipUrl) {
    let clipClaim: { claimed: boolean; missing?: boolean; status?: string } = { claimed: false, missing: true };
    try {
      clipClaim = await convex.mutation(api.clipJobs.claimClipForPostingByUrl, {
        mintAddress, clipUrl: videoClipUrl, authSecret: secret,
      });
    } catch {
      // Best-effort: a claim-call failure (bad secret etc.) shouldn't strand a
      // legitimate post — treat as "no clip to guard" and post anyway. The
      // success-path markClipPostedByUrl below is likewise best-effort.
      clipClaim = { claimed: false, missing: true };
    }
    if (!clipClaim.claimed && !clipClaim.missing) {
      if (clipClaim.status === "posted") {
        // Already published by another path (drip/inline). SKIP — don't re-post.
        return NextResponse.json({ ok: true, alreadyPosted: true, skipped }, { status: 200 });
      }
      // RETRYABLE TERMINAL STATES: a clip that previously failed to post (status
      // "failed" or "guardrail_rejected") was locked in a non-ready state, so
      // claimClipForPostingByUrl returned claimed:false. Treating this as
      // posting_in_progress was wrong — nobody is actively posting it, the user
      // is explicitly retrying. Reset it to "ready" so markClipPostedByUrl on
      // success can flip it to "posted"; the claim race-guard doesn't apply here
      // (the clip is known-idle). Treat as missing (no claim row to guard).
      const retryableStatuses = ["failed", "guardrail_rejected"];
      if (clipClaim.status && retryableStatuses.includes(clipClaim.status)) {
        // Reset the clip badge to "ready" so markClipPostedByUrl can later
        // flip it to "posted" on success. Best-effort — if this fails the post
        // still goes out and markClipPostedByUrl handles the non-ready row.
        try {
          await convex.mutation(api.clipJobs.markClipPostedByUrl, {
            mintAddress, clipUrl: videoClipUrl, status: "ready", authSecret: secret,
          });
        } catch { /* best-effort — proceed with the post regardless */ }
        // Re-claim now that the clip is ready.
        try {
          const reClaim = await convex.mutation(api.clipJobs.claimClipForPostingByUrl, {
            mintAddress, clipUrl: videoClipUrl, authSecret: secret,
          });
          clipClaimed = reClaim.claimed === true;
        } catch { /* best-effort */ }
        // Post proceeds — fall through to the upload below.
      } else {
        // status === "posting" — another path is genuinely mid-posting this clip.
        return NextResponse.json({ ok: false, reason: "posting_in_progress", skipped }, { status: 409 });
      }
    } else {
      // claimed === true → we won; missing === true → no clip row to guard (post anyway).
      clipClaimed = clipClaim.claimed === true;
    }
  }

  const paymentRunId = `manual-post:${randomUUID()}`;
  let publishConfirmed = false;
  try {
    const charge = await chargeAgentGeneration(mintAddress, paymentRunId, "social_post");
    if (!charge.ok) throw new Error(`Agent payment failed (${charge.reason}); nothing was posted.`);
    let result: PostResult;
    // Set only inside the video branch below when a guardrails check blocks the
    // post — read afterward (outside that branch) so the failure-release logic
    // can tell a guardrails block apart from a genuine upload-post failure.
    let guardrailBlock: { reasons: string[] } | null = null;
    if (capable.includes("x")) {
      const coin = await convex.query(api.influencers.coinOfMint, { mintAddress }).catch(() => null);
      if (typeof coin?.ticker === "string") {
        const tag = { ticker: coin.ticker, url: "" };
        effectiveTitle = withTicker(effectiveTitle, tag);
        if (effectiveDescription) effectiveDescription = withTicker(effectiveDescription, tag);
      }
    }
    if (type === "text") {
      result = await uploadText({ username, platforms: capable, title: effectiveTitle });
    } else if (type === "photo") {
      const photoUrls = (body.mediaUrls ?? []).filter(Boolean);
      if (!photoUrls.length) return NextResponse.json({ ok: false, error: "mediaUrls is required for photo posts" }, { status: 400 });
      // Carousel-specific knobs (the Photo Carousel Builder posts TikTok carousels
      // via this same route). Only forwarded when the client actually set them.
      result = await uploadPhotos({
        username, platforms: capable, photoUrls, title: effectiveTitle, description: effectiveDescription,
        ...(body.tiktokTitle ? { tiktokTitle: body.tiktokTitle } : {}),
        ...(body.postMode ? { postMode: body.postMode } : {}),
        ...(body.privacyLevel ? { privacyLevel: body.privacyLevel } : {}),
        ...(typeof body.autoAddMusic === "boolean" ? { autoAddMusic: body.autoAddMusic } : {}),
        ...(typeof body.disableComment === "boolean" ? { disableComment: body.disableComment } : {}),
        ...(typeof body.brandContentToggle === "boolean" ? { brandContentToggle: body.brandContentToggle } : {}),
        ...(typeof body.brandOrganicToggle === "boolean" ? { brandOrganicToggle: body.brandOrganicToggle } : {}),
        ...(typeof body.photoCoverIndex === "number" ? { photoCoverIndex: body.photoCoverIndex } : {}),
        ...(body.mediaType ? { instagramMediaType: body.mediaType } : {}),
        // X ignores `description` on photo posts — the tweet text must ride in
        // x_title (upload-post docs), so send the caption there.
        ...(effectiveDescription || effectiveTitle ? { xTitle: effectiveDescription || effectiveTitle } : {}),
      });
    } else {
      const videoUrl = (body.mediaUrls ?? [])[0];
      if (!videoUrl) return NextResponse.json({ ok: false, error: "mediaUrls[0] is required for video posts" }, { status: 400 });
// GUARDRAILS word-scrub: keep the requested clip count intact. With the skill
    // installed, a flagged word in the caption would BLOCK the whole clip at the
    // gate below (guardrail_rejected — a dropped clip). Scrub-masking the words
    // lets the clip pass the word check while still posting the same number of
    // videos the operator asked for. Applies to video posts only (the only thing
    // the gate guards). `clipSkillRows` was fetched above in the smart-captions
    // block, so the install check is free here.
    const guardrailsInstalled = guardrailsEnabled({
      installedSkills: (agent as { installedSkills?: string[] } | null)?.installedSkills,
      clipSkillRows,
    });
    if (type === "video" && guardrailsInstalled) {
      const scrubbedTitle = scrubProfanity(effectiveTitle);
      const scrubbedDesc = scrubProfanity(effectiveDescription);
      const changed = scrubbedTitle !== effectiveTitle || scrubbedDesc !== effectiveDescription;
      if (changed) console.warn(`[social/post] guardrails installed — scrubbed flagged caption words so the clip posts (requested count preserved)`);
      effectiveTitle = scrubbedTitle;
      effectiveDescription = scrubbedDesc;
    }

    // YouTube caps titles at 100 chars (a long caption 400s the whole cross-post).
    // Write a short, persona-matched YouTube title in the agent's language (no em
    // dashes) when YouTube is a target. Guaranteed ≤100 chars; safe fallback on any
    // LLM issue. uploadVideo re-sanitises regardless, so this can never exceed 100.
    const a = agent as { name?: string; niche?: string; archetype?: string; description?: string; language?: string } | null;
    const youtubeTitle = capable.includes("youtube")
      ? await generateYoutubeTitle({
          caption: effectiveTitle || "New post",
          persona: a ? `${a.name ?? "creator"}${a.archetype ? ` — ${a.archetype} influencer` : ""}${a.niche ? ` in the ${a.niche} niche` : ""}. ${a.description ?? ""}`.trim() : undefined,
          language: a?.language,
        })
      : undefined;

    // GUARDRAILS: opt-in pre-post QA (profanity, technical quality, and — when
    // the agent enabled the paid tier — a vision pass for duplicate burned-in
    // captions / obvious AI-generation artifacts). Only runs when the operator
    // installed video.guardrails / clip.guardrails; blocks the upload-post call
    // entirely on failure so a bad clip never reaches the platform. The caption
    // was already word-scrubbed above (`guardrailsInstalled`) so the profanity
    // check passes and the requested clip count is preserved.
    if (guardrailsInstalled) {
        const gr = await runGuardrails({
          videoUrl,
          captionText: `${effectiveTitle} ${effectiveDescription ?? ""}`.trim(),
          visionEnabled: true,
          kieApiKey: process.env.KIE_API_KEY,
        });
        if (!gr.pass) guardrailBlock = { reasons: gr.reasons };
      }

      let youtubeVideoUrl = videoUrl;
      let shortsError: ShortsPreparationError | null = null;
      if (!guardrailBlock && capable.includes("youtube")) {
        try { youtubeVideoUrl = await prepareYouTubeShort(videoUrl); }
        catch (error) {
          shortsError = error instanceof ShortsPreparationError
            ? error
            : new ShortsPreparationError("Could not prepare this clip for YouTube Shorts. No platform was posted.");
        }
      }

      if (guardrailBlock) {
        result = { ok: false, status: 422, data: { error: "guardrails_blocked", reasons: guardrailBlock.reasons } };
      } else if (shortsError) {
        // Preflight ALL targets before sending anything. A bad YouTube clip must
        // not silently become a normal video or cause partial cross-posts that
        // the scheduler could duplicate on retry.
        result = {
          ok: false, status: 422, data: { error: shortsError.message },
          failed: capable.map((platform) => ({ platform, error: shortsError.message })),
        };
      } else {
        // Upload-Post cannot force a Short via metadata. Send YouTube the
        // verified 9:16 file, while other networks retain the original render.
        const tiktokVideoUrl = coverImageUrl && capable.includes("tiktok")
          ? await getTiktokCoverVideoUrl(videoUrl, coverImageUrl) : videoUrl;
        const tiktokBurned = tiktokVideoUrl !== videoUrl;
        const youtubeConverted = capable.includes("youtube") && youtubeVideoUrl !== videoUrl;
        const otherPlatforms = capable.filter((p) => !(youtubeConverted && p === "youtube") && !(tiktokBurned && p === "tiktok"));
        const groups = [
          ...(youtubeConverted ? [{ platforms: ["youtube"], videoUrl: youtubeVideoUrl }] : []),
          ...(tiktokBurned ? [{ platforms: ["tiktok"], videoUrl: tiktokVideoUrl, coverTimestampMs: TIKTOK_COVER_TIMESTAMP_MS }] : []),
          ...(otherPlatforms.length ? [{ platforms: otherPlatforms, videoUrl }] : []),
        ];
        const results = await Promise.all(groups.map((group) => uploadVideo({
          username, platforms: group.platforms, videoUrl: group.videoUrl,
          title: effectiveTitle || "New post", description: effectiveDescription,
          youtubeTitle, coverImageUrl,
          // X reads only x_title (not description) — send the caption there.
          ...(effectiveDescription || effectiveTitle ? { xTitle: effectiveDescription || effectiveTitle } : {}),
          ...("coverTimestampMs" in group ? { coverTimestampMs: group.coverTimestampMs } : {}),
        })));
        if (results.length === 1) result = results[0];
        else {
          const failed = results.flatMap((part) => part.failed ?? []);
          result = {
            ok: results.every((part) => part.ok),
            status: results.find((part) => !part.ok)?.status ?? results[0].status,
            data: Object.fromEntries(groups.map((group, index) => [group.platforms.join("+"), results[index].data])),
            failed: failed.length ? failed : undefined,
            requestId: results.find((part) => part.requestId)?.requestId,
            postIds: Object.assign({}, ...results.map((part) => part.postIds ?? {})),
          } satisfies PostResult;
        }
      }

      // A guardrails block is recorded distinctly below (guardrail_rejected, not
      // released back to "ready") — capture it before the shared failure-release
      // logic runs so it doesn't loop the drip cron on the same never-fixable clip.
      if (guardrailBlock && clipClaimed && videoClipUrl) {
        try {
          await convex.mutation(api.clipJobs.markClipPostedByUrl, {
            mintAddress, clipUrl: videoClipUrl, status: "guardrail_rejected",
            failReason: `Guardrails blocked: ${guardrailBlock.reasons.join("; ")}`.slice(0, 300),
            authSecret: secret,
          });
        } catch { /* best-effort */ }
        console.warn(`[social/post] guardrails blocked ${mintAddress}: ${guardrailBlock.reasons.join("; ")}`);
      }
    }
    // Post FAILED (and it wasn't already handled by the guardrails branch above)
    // but we won the claim → release the clip badge "posting" → "ready" so it
    // isn't stranded mid-posting (URL-keyed release, the same path the drip cron
    // uses on retry; markClipPostedByUrl only blocks regressing a *posted* clip,
    // so posting→ready is allowed). Best-effort.
    if (!result.ok && clipClaimed && videoClipUrl && !guardrailBlock) {
      try {
        await convex.mutation(api.clipJobs.markClipPostedByUrl, {
          mintAddress, clipUrl: videoClipUrl, status: "ready", authSecret: secret,
        });
      } catch { /* best-effort — leave badge as-is rather than fail the response */ }
    }
    // `posted` = platforms that actually published (capable minus any the body
    // reported as failed); `failed` carries the per-platform errors.
    const failedIds = (result.failed ?? []).map((f) => f.platform);
    const posted = capable.filter((p) => !failedIds.includes(p));
    // SILENT-SKIP GUARD: if upload-post returned HTTP 200 with no per-platform
    // failures but zero platforms were actually confirmed posted (e.g. the Python
    // service returned an empty results map), treat this as a real failure so
    // "Post now" doesn't show ✅ while the clip silently went nowhere. Only
    // applies when we had eligible platforms to post to (capable.length > 0).
    publishConfirmed = posted.length > 0;
    if (!publishConfirmed) await refundImage(mintAddress, paymentRunId);
    if (result.ok && posted.length === 0 && capable.length > 0) {
      // Release the claim badge "posting" → "ready" so the clip isn't stranded.
      if (clipClaimed && videoClipUrl) {
        try {
          await convex.mutation(api.clipJobs.markClipPostedByUrl, {
            mintAddress, clipUrl: videoClipUrl, status: "ready", authSecret: secret,
          });
        } catch { /* best-effort */ }
      }
      return NextResponse.json(
        {
          ok: false,
          error: "The connected accounts didn't accept the post. Check your social connections in the Posting tab and try again.",
          posted: [],
          skipped,
          failed: capable.map((p) => ({ platform: p, error: "no confirmation from upload-post" })),
        },
        { status: 200 },
      );
    }
    // Post-now: flip the originating clip → posted so the feed reflects it and a
    // page reload can't re-post the same clip. The mark ALSO returns the clip's
    // campaign provenance, so we auto-submit a posted CAMPAIGN clip to its
    // Submissions page — parity with the cloud auto-post (manual Post now used to
    // skip this). Best-effort; video posts only; never fails the post response.
    if (result.ok && type === "video" && secret) {
      const clipUrl = (body.mediaUrls ?? [])[0];
      if (clipUrl) {
        try {
          // PERMALINK for EVERY posted clip, not just campaign ones. The live post
          // URL used to be resolved only inside the campaign branch below, and only
          // handed to the submission — so an ordinary posted clip carried
          // status:"posted" with no link, and anything offering to open the post had
          // nothing to open. Resolved BEFORE the mark so the row lands complete in
          // one write, and reused by the campaign branch rather than polled twice.
          // The clip was already CLAIMED (ready→posting) above, so the extra seconds
          // spent resolving can't let the drip publish it again.
          const postPlatform = posted[0] || capable[0];
          const platformPostId = result.postIds?.[postPlatform];
          const uploadRequestId = result.requestId;
          let resolvedPostUrl = extractPostUrlFromResult(result.data, postPlatform);
          if (!resolvedPostUrl && (platformPostId || uploadRequestId)) {
            // Poll with the DURABLE ids only — never "the account's newest post",
            // which on a busy account is somebody else's video.
            for (let i = 0; i < 3 && !resolvedPostUrl; i++) {
              await new Promise((r) => setTimeout(r, 4000));
              resolvedPostUrl = await getLatestPostLink(username, postPlatform, { platformPostId, requestId: uploadRequestId });
            }
          }
          const marked = (await convex.mutation(api.clipJobs.markClipPostedByUrl, {
            mintAddress, clipUrl, status: "posted",
            ...(postPlatform ? { platform: postPlatform } : {}),
            ...(resolvedPostUrl ? { postUrl: resolvedPostUrl } : {}),
            ...(platformPostId ? { platformPostId } : {}),
            ...(uploadRequestId ? { uploadPostRequestId: uploadRequestId } : {}),
            ...((effectiveDescription || effectiveTitle)?.trim()
              ? { captionText: (effectiveDescription || effectiveTitle).trim() }
              : {}),
            authSecret: secret,
          })) as { campaignId?: string | null; contentRewardId?: string | null; ownerWallet?: string | null; clipId?: Id<"clips"> | null };

          const ownerWallet = marked?.ownerWallet || agent?.creatorWallet;
          if (ownerWallet && (marked?.campaignId || marked?.contentRewardId)) {
            // Already resolved above for the clip row — reuse it rather than paying
            // for a second round of polling.
            const platform = postPlatform;
            const postUrl = resolvedPostUrl;
            const ppid = platformPostId;
            const reqId = uploadRequestId;
            if (marked.campaignId) {
              await convex.mutation(api.submissions.submitForCampaign, {
                campaignId: marked.campaignId, influencerMint: mintAddress,
                influencerName: agent?.name ?? "Vello agent", submitterWallet: ownerWallet,
                platform, ...(postUrl ? { postUrl } : {}),
                // Durable post identity → the submission is measurable by
                // dueForVerification (a postUrl-only row is never attested/paid).
                ...(ppid ? { platformPostId: ppid } : {}),
                ...(reqId ? { uploadPostRequestId: reqId } : {}),
                postedAt: Date.now(), authSecret: secret,
              });
            } else if (marked.contentRewardId) {
              // Trusted agent post (the operator owns this agent) → auto-approve, same
              // as the cloud agent path. This is the DISPLAY submission on the campaign
              // page (jobtepi/ryze).
              const crRes = await submitContentRewardLink({
                contentRewardId: marked.contentRewardId, ownerWallet,
                contentUrl: postUrl || clipUrl, videoUrl: clipUrl, platform,
                title: title || undefined, ownerName: agent?.name ?? undefined,
                ownerAvatar: agent?.avatarUrl ?? undefined, autoApprove: true,
              });
              // Register the upload-post analytics handle so the sync worker can
              // later resolve this clip's real permalink + views by request_id —
              // essential when contentUrl fell back to the raw clip url above.
              if (crRes.ok && (reqId || ppid)) {
                await registerMeasurementHandle({
                  contentRewardId: marked.contentRewardId,
                  contentRewardSubmissionId: crRes.submissionId,
                  mintAddress, platform,
                  uploadPostRequestId: reqId, platformPostId: ppid,
                });
              }
              // BRIDGE → USDC rail (parity with the cloud auto-post + drip paths): if
              // this content_reward has a FUNDED on-chain v2 vault linked, mirror a
              // Convex submission so the oracle reads on-chain views + the claim keeper
              // pays the agent USDC. The funded-vault gate lives inside the secret-gated
              // bridgeContentRewardToCampaign mutation (ConvexHttpClient can't call the
              // internal-only query directly), so nothing leaks; it never credits
              // unbacked NAV and is idempotent via the per-(campaign, mint) upsert.
              if (marked.clipId) {
                await convex.mutation(api.submissions.bridgeContentRewardToCampaign, {
                  clipId: marked.clipId, contentRewardId: marked.contentRewardId,
                  influencerMint: mintAddress, influencerName: agent?.name ?? "Vello agent",
                  submitterWallet: ownerWallet, ...(postUrl ? { postUrl } : {}), platform,
                  // Durable post identity → the mirrored submission becomes due for
                  // on-chain view attestation + USDC claim (postUrl alone never pays).
                  ...(ppid ? { platformPostId: ppid } : {}),
                  ...(reqId ? { uploadPostRequestId: reqId } : {}),
                  postedAt: Date.now(), authSecret: secret,
                });
              }
            }
          }
        } catch (e) {
          console.warn(`[social/post] mark-posted / campaign auto-submit failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    // Photo carousels (Photo Carousel Builder): best-effort flag the source
    // generations as "posted" so the Carousel tab's history shows the badge. The
    // mark is never allowed to fail the post response.
    if (result.ok && type === "photo" && secret && body.carouselImageIds?.length) {
      for (const id of body.carouselImageIds) {
        try {
          await convex.mutation(api.carouselImages.markPosted, { id: id as unknown as Id<"carouselImages">, authSecret: secret });
        } catch { /* best-effort */ }
      }
    }
    // Pull upload-post's OWN top-level error text (its 4xx bodies carry
    // { error | message | detail }) so a rejection surfaces the REAL reason (bad
    // video URL, stale token, unsupported format…) instead of "Post failed (HTTP
    // 400)". Per-platform failures win; then the upstream message; then a generic.
    const upstreamMsg = (() => {
      const d = (result.data ?? null) as { error?: unknown; message?: unknown; detail?: unknown } | null;
      const m = d?.error ?? d?.message ?? d?.detail;
      return typeof m === "string" && m.trim() ? m.trim() : "";
    })();
    return NextResponse.json(
      {
        ok: result.ok, status: result.status, posted, skipped, failed: result.failed, result: result.data,
        ...(result.ok ? {} : { error: formatPlatformFailures(result.failed) || upstreamMsg || `Post failed (HTTP ${result.status})` }),
      },
      // 200 even on a platform-level failure: the request itself completed, and the
      // body's `ok:false` + `error` carry the reason. Returning 5xx here made the
      // browser log a scary "502 Bad Gateway" and some proxies mangle 5xx bodies,
      // hiding the real message. Genuine exceptions still 5xx in the catch below.
      { status: 200 },
    );
  } catch (err) {
    if (!publishConfirmed) await refundImage(mintAddress, paymentRunId);
    // The upload threw (network/5xx/etc.). If we won the clip claim, release the
    // badge "posting" → "ready" so it isn't stranded; mirrors the !result.ok path.
    if (clipClaimed && videoClipUrl) {
      try {
        await convex.mutation(api.clipJobs.markClipPostedByUrl, {
          mintAddress, clipUrl: videoClipUrl, status: "ready", authSecret: secret,
        });
      } catch { /* best-effort */ }
    }
    if (err instanceof NotConfiguredError) {
      return NextResponse.json({ ok: false, configured: false, error: err.message }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "post failed" }, { status: 502 });
  }
}
