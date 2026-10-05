import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { hasActiveSubscription } from "@/lib/server/subscriptionStatus";

/** Free-plan ceiling on clips-per-source-run (manual slider AND "Let AI
 *  decide"). See the FREE-PLAN GATES comment below for why this has to be a
 *  hard count cap, not just a credit balance: a clip run is priced by SOURCE
 *  DURATION and charged once per run, so more clips from the same source cost
 *  nothing extra — the 300 free trial credits alone never actually limited
 *  clip count. */
const FREE_PLAN_MAX_CLIPS = 10;

export const runtime = "nodejs";

/**
 * Single SIWS-owner-gated entry point for the builder's agent-config writes.
 *
 * The four underlying Convex mutations (influencers.setClipConfig / setVideoConfig /
 * setMonetization / saveAgentConfig) are now INTERNAL_CRON_SECRET-gated — they can
 * no longer be called directly from the browser (audit #1/#2: ungated, anyone with
 * the public Convex URL could overwrite ANY agent's config). The client now POSTs
 * here instead; this route proves ownership of the target agent (SIWS) and injects
 * the secret, mirroring app/api/economy/clip-precheck/route.ts.
 *
 * Body: { mintAddress, kind: "clip"|"video"|"monetization"|"agent", payload }.
 * The mutation's result is returned verbatim as JSON so callers that read
 * `res.videoConfig` (etc.) keep working unchanged.
 */

// Payload types extracted from each gated mutation's args (no `any`). The route is
// the trust boundary; the gated mutation's Convex validators re-check the shape at
// runtime, so the per-branch cast below only narrows the client-supplied JSON.
type ClipPayload = FunctionArgs<typeof api.influencers.setClipConfig>["clipConfig"];
type VideoPayload = FunctionArgs<typeof api.influencers.setVideoConfig>["videoConfig"];
type MonetizationPayload = FunctionArgs<typeof api.influencers.setMonetization>["monetization"];
type AgentPayload = Omit<FunctionArgs<typeof api.influencers.saveAgentConfig>, "mintAddress" | "authSecret">;
// Persona edit (studio "Edit AI Agent"): the fields influencers.update patches, minus
// the row id + secret (the route resolves the id from mintAddress after the SIWS check).
type PersonaPayload = Omit<FunctionArgs<typeof api.influencers.update>, "id" | "authSecret">;
// Autonomous-clipping toggle (Home): just { enabled }.
type AutoClipPayload = Omit<FunctionArgs<typeof api.influencers.setAutoClip>, "mintAddress" | "authSecret">;

// Show Bible save (direct field edits from the Director tab's bible editor).
type BiblePayload = FunctionArgs<typeof api.influencers.setShowBible>["showBible"];
// Autonomy dial (Ideas tab): { mode: "full-auto" | "review-ideas" | "review-video" }.
type AutonomyPayload = Omit<FunctionArgs<typeof api.influencers.setAutonomyMode>, "mintAddress" | "authSecret">;
type AvatarPayload = Omit<FunctionArgs<typeof api.influencers.setAvatarUrl>, "mintAddress" | "authSecret">;

type ConfigKind = "clip" | "video" | "monetization" | "agent" | "persona" | "avatar" | "autoclip" | "bible" | "autonomy";

export async function POST(req: NextRequest) {
  // Whole-handler safety net. `requireInternalOrUserAuth` (Privy Bearer + SIWS
  // header verification) sits ahead of the request-scoped try/catch below and
  // was previously fully unguarded — direct testing against production ruled
  // out the mutation/data path (every setVideoConfig call succeeds cleanly with
  // real agent data), which points at something in this auth resolution step
  // specific to a live browser session I can't reproduce from here. Rather than
  // let an unexpected throw there crash the route into a bare, undiagnosable
  // 500, catch it here too so the NEXT occurrence comes back with a real error
  // message instead of nothing.
  try {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;
    return await handleConfigWrite(req, auth);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "config write failed" },
      { status: 500 },
    );
  }
}

async function handleConfigWrite(req: NextRequest, auth: Awaited<ReturnType<typeof requireInternalOrUserAuth>> & { error?: never }) {
  let body: { mintAddress?: string; kind?: string; payload?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const mintAddress = String(body.mintAddress ?? "").trim();
  const kind = body.kind as ConfigKind | undefined;
  const payload = body.payload;
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });
  if (kind !== "clip" && kind !== "video" && kind !== "monetization" && kind !== "agent" && kind !== "persona" && kind !== "avatar" && kind !== "autoclip" && kind !== "bible" && kind !== "autonomy") {
    return NextResponse.json({ ok: false, error: "invalid kind" }, { status: 400 });
  }
  if (payload == null || typeof payload !== "object") {
    return NextResponse.json({ ok: false, error: "payload required" }, { status: 400 });
  }

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  // Dispatch to the matching gated mutation, injecting the secret. Each result is
  // returned verbatim so the client sees the same shape the mutation produced.
  //
  // The ownership check below is now INSIDE this try/catch. It used to sit above,
  // outside any handler — so a bad/mismatched INTERNAL_CRON_SECRET (this route's
  // Next.js/Railway env vs. Convex's own separately-managed env — two deployments,
  // two env stores) made `getByMintServer` throw "unauthorized" UNCAUGHT, crashing
  // the whole route with a bare, undiagnosable 500 and no JSON body. Every Director
  // save (Styles, Creative Variety, anything routed through this endpoint) would
  // fail identically, and there was nothing in the response to tell you why — which
  // is exactly the "fixed this many times, still 500s" pattern: the bug was never
  // in this file's logic, it was a config drift between two separately-deployed
  // services. This doesn't fix that drift (only resetting Railway's
  // INTERNAL_CRON_SECRET to match Convex's does) — it makes the REAL error message
  // ("unauthorized") reach the client instead of an opaque crash, so it's finally
  // diagnosable from a network tab without server log access.
  try {
    // Ownership: only the SIWS-proven owner (or an internal caller) may write config.
    if (!auth.internal) {
      const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
      const err = requireOwnerWithSiws(auth, agent);
      if (err) return err;
    }
    if (kind === "clip") {
      // Always fetch the current row now (not just for the watermark-only merge
      // below) — the free-plan gate right after needs the owner's wallet, and a
      // second query here is cheap next to the render/billing work this config
      // actually controls.
      const current = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
      if (!current) return NextResponse.json({ ok: false, error: "Agent not found" }, { status: 404 });
      // Specials saves just this preference. Merge against the latest server
      // config so toggling a watermark cannot overwrite schedule/channel edits.
      const watermarkOnly = Object.keys(payload).length === 1 &&
        typeof (payload as { velloWatermark?: unknown }).velloWatermark === "boolean";
      const clipPayload: Record<string, unknown> = watermarkOnly
        ? { ...(current.clipConfig as Record<string, unknown> ?? {}), ...(payload as Record<string, unknown>) }
        : { ...(payload as Record<string, unknown>) };
      // FREE-PLAN GATES — both re-checked on every "clip" config save (not just
      // when the specific field being changed happens to be the gated one), so
      // an account that lapses from paid back to free gets re-clamped the next
      // time it touches clip settings, and one that upgrades gets its ceiling
      // lifted back up, instead of a stale value lingering either direction.
      let forcedFreePlan = false;
      if (!auth.internal) {
        const paid = await hasActiveSubscription((current as { creatorWallet?: string }).creatorWallet);
        if (!paid) {
          // 1) Watermark: removing "Made by Vello" is a paid-plan perk — force
          //    it back on instead of silently ignoring an off attempt.
          if (clipPayload.velloWatermark === false) { clipPayload.velloWatermark = true; forcedFreePlan = true; }
          // 2) Clip count: the credit/skill-fee charge for a clip run is priced
          //    by SOURCE DURATION and charged once per run, not per clip — so
          //    requesting more clips from the same short source costs nothing
          //    extra. Without a hard ceiling here, "Number of clips" (up to 60)
          //    and "Let AI decide" (up to 30) both let a free account pull far
          //    more than its 300 trial credits were ever meant to cover; this
          //    was the actual abuse path ("30 clips" on a free account). Cap at
          //    FREE_PLAN_MAX_CLIPS for both the manual slider AND the ceiling
          //    convex/clipJobs.ts uses for "Let AI decide" (autoPlanMaxClips —
          //    a NEW field read there; existing rows without it keep the old
          //    default-30 behavior for paid accounts, so this can't regress
          //    anyone already relying on autoPlan's natural yield).
          const requested = Number(clipPayload.maxClipsPerSource);
          if (Number.isFinite(requested) && requested > FREE_PLAN_MAX_CLIPS) { clipPayload.maxClipsPerSource = FREE_PLAN_MAX_CLIPS; forcedFreePlan = true; }
          clipPayload.autoPlanMaxClips = FREE_PLAN_MAX_CLIPS;
        } else {
          // Paid: make sure a PRIOR free-plan save's ceiling doesn't linger
          // after upgrading — reconcile back to "no special cap" every save.
          if (clipPayload.autoPlanMaxClips === FREE_PLAN_MAX_CLIPS) delete clipPayload.autoPlanMaxClips;
        }
      }
      const res = await convex.mutation(api.influencers.setClipConfig, {
        mintAddress,
        clipConfig: clipPayload as ClipPayload,
        authSecret: secret,
      });
      return NextResponse.json(forcedFreePlan
        ? { ...res, velloWatermark: clipPayload.velloWatermark, maxClipsPerSource: clipPayload.maxClipsPerSource, forcedFreePlan: true, freePlanMaxClips: FREE_PLAN_MAX_CLIPS }
        : res);
    }
    if (kind === "video") {
      const res = await convex.mutation(api.influencers.setVideoConfig, {
        mintAddress,
        videoConfig: payload as VideoPayload,
        authSecret: secret,
      });
      return NextResponse.json(res);
    }
    if (kind === "monetization") {
      const res = await convex.mutation(api.influencers.setMonetization, {
        mintAddress,
        monetization: payload as MonetizationPayload,
        authSecret: secret,
      });
      return NextResponse.json(res);
    }
    if (kind === "autoclip") {
      const res = await convex.mutation(api.influencers.setAutoClip, {
        mintAddress,
        ...(payload as AutoClipPayload),
        authSecret: secret,
      });
      return NextResponse.json(res);
    }
    if (kind === "bible") {
      const res = await convex.mutation(api.influencers.setShowBible, {
        mintAddress,
        showBible: payload as BiblePayload,
        authSecret: secret,
      });
      return NextResponse.json(res);
    }
    if (kind === "autonomy") {
      const res = await convex.mutation(api.influencers.setAutonomyMode, {
        mintAddress,
        ...(payload as AutonomyPayload),
        authSecret: secret,
      });
      return NextResponse.json(res);
    }
    if (kind === "persona") {
      // Resolve the row id from the (ownership-proven) mint, then patch the persona.
      const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
      if (!agent) return NextResponse.json({ ok: false, error: "Agent not found" }, { status: 404 });
      await convex.mutation(api.influencers.update, {
        id: agent._id,
        ...(payload as PersonaPayload),
        authSecret: secret,
      });
      return NextResponse.json({ ok: true });
    }
    if (kind === "avatar") {
      const avatarUrl = String((payload as Partial<AvatarPayload>).avatarUrl ?? "").trim();
      if (!/^https:\/\//i.test(avatarUrl)) {
        return NextResponse.json({ ok: false, error: "Profile image must be a secure public URL" }, { status: 400 });
      }
      try {
        const res = await convex.mutation(api.influencers.setAvatarUrl, { mintAddress, avatarUrl, authSecret: secret });
        return NextResponse.json(res);
      } catch (e) {
        // setAvatarUrl may not be pushed to the Convex deployment yet (Convex only
        // gets new functions on `npx convex deploy`; a missing function surfaces as a
        // masked "Server Error"). Fall back to the long-deployed persona `update`,
        // re-sending the row's current persona so only the avatar changes.
        console.warn("[agents/config] setAvatarUrl failed, falling back to update:", e instanceof Error ? e.message : e);
        const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
        if (!agent) return NextResponse.json({ ok: false, error: "Agent not found" }, { status: 404 });
        const a = agent as Partial<PersonaPayload>;
        const p = (a.personality ?? {}) as Partial<PersonaPayload["personality"]>;
        await convex.mutation(api.influencers.update, {
          id: agent._id,
          name: a.name ?? "",
          handle: a.handle ?? "",
          avatarUrl,
          niche: a.niche ?? "",
          language: a.language ?? "en",
          archetype: a.archetype ?? "",
          description: a.description ?? "",
          personality: { warmth: p.warmth ?? 50, humor: p.humor ?? 50, authority: p.authority ?? 50, boldness: p.boldness ?? 50 },
          authSecret: secret,
        });
        return NextResponse.json({ ok: true, avatarUrl });
      }
    }
    // kind === "agent"
    const res = await convex.mutation(api.influencers.saveAgentConfig, {
      mintAddress,
      ...(payload as AgentPayload),
      authSecret: secret,
    });
    return NextResponse.json(res);
  } catch (e) {
    // Surface the mutation's error message (e.g. "Agent not found") so callers'
    // existing try/catch + saveErrorMessage UX keeps working.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "config write failed" },
      { status: 500 },
    );
  }
}
