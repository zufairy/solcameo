import { refreshAgentFunds } from "@/lib/server/agentWallet";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws, requireSiwsSession } from "@/lib/server/requireAuth";
import { resolveAgentOnchainUsdc } from "@/lib/economy/vaultSweep";
import { CLIP_SOURCE_MINUTE_ID, clipSkillRunCostWithOverrides, effectiveUnitPrice } from "@/lib/economy/servicePrices";
import { effectiveSpendableUsdc } from "@/lib/economy/nav";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Pre-flight for a canvas clip run: can this agent afford it TODAY?
 * "Don't do the work then fail to bill" — the canvas calls this before
 * spending a cent of compute; the per-route metering gates are the
 * never-trust-the-client backstop.
 *
 * Crucially this reconciles the escrow mirror to the agent's REAL on-chain
 * USDC first (settleAgent.ts pattern): a wallet freshly funded on devnet
 * otherwise reads $0 spendable until the next settle pass, and the run would
 * be wrongly denied.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: { mintAddress?: string; sessionId?: string; runId?: string; skillIds?: string[]; estimatedDurationSeconds?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const mintAddress = String(body.mintAddress ?? "").trim();
  const sessionId = String(body.sessionId ?? "").trim();
  const runId = String(body.runId ?? "").trim();
  const skillIds = Array.isArray(body.skillIds) ? body.skillIds.map(String) : [];

  // For minted agents we resolve+ownership-gate below (we need the agent record).
  // For the DRAFT (unminted) free-tier path there is no owner to scope, so require
  // only a valid SIWS session — a wallet-proof sign-in — for user callers. Internal
  // cron callers skip both. The minted-path ownership gate runs once the agent is
  // loaded (line ~57 region) before any charge.
  if (!auth.internal && !mintAddress && sessionId) {
    const siwsError = requireSiwsSession(auth);
    if (siwsError) return siwsError;
  }

  // Draft (unminted) agents: free tier, capped per day. Counting happens here
  // (one precheck = one run start) so the canvas needs no extra call.
  if (!mintAddress && sessionId) {
    try {
      const convexDraft = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      // Atomic check-and-count inside the mutation — no read/write race.
      const free = await convexDraft.mutation(api.usage.countFreeRun, { sessionId });
      if (!free.ok) {
        return NextResponse.json({ ok: false, reason: "free_tier_limit", runsToday: free.runsToday, capRuns: free.capRuns });
      }
      return NextResponse.json({ ok: true, freeTier: true, runsToday: free.runsToday, capRuns: free.capRuns });
    } catch {
      return NextResponse.json({ ok: true, freeTier: true, degraded: true }); // economy not deployed → don't block
    }
  }
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress or sessionId required" }, { status: 400 });

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  // One agent lookup serves both the ownership gate and the reconcile step below.
  const loadAgent = () => convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
  let agent: Awaited<ReturnType<typeof loadAgent>> | undefined;

  // Ownership gate for the MINTED path — user (Bearer) callers must be the
  // SIWS-proven owner before we reconcile/charge. Internal cron callers skip.
  if (!auth.internal) {
    agent = await loadAgent();
    const ownershipError = requireOwnerWithSiws(auth, agent);
    if (ownershipError) return ownershipError;
  }

  const walletOnly = agent?.generationFunding === "agent_wallet" || !!agent?.solstarCharacterId;
  if (walletOnly) {
    try { await refreshAgentFunds(mintAddress); }
    catch { return NextResponse.json({ ok: false, reason: "precheck_unavailable" }, { status: 503 }); }
  }

  // 1) Reconcile the mirror to the chain so the spendable math is real.
  try {
    if (agent === undefined) agent = await loadAgent();
    if (agent?.agentWallet) {
      // Read the VAULT ATA balance for vault-enabled agents (chain=truth), else the
      // legacy custodial wallet.
      const onchainUsdc = await resolveAgentOnchainUsdc({ mintAddress, fallbackWallet: agent.agentWallet });
      await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress, onchainUsdc, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    }
  } catch { /* best-effort — precheck still answers from the mirror */ }

  // 2) Skills-only pricing: a run costs the sum of the per-run fees of the skills
  //    wired into it. Clip render + transcription compute is absorbed (not billed
  //    separately). A run with no priced skills is free. Honor admin price
  //    overrides so this estimate AND the per-skill charge gate below match what
  //    usage.recordUsage (which reads the same override) actually bills.
  //    Best-effort — on a read failure fall back to the static defaults.
  let priceOverrides: Record<string, number> = {};
  try { priceOverrides = (await convex.query(api.adminPricing.effectiveSkillPrices, {})).overrides; }
  catch (e) { console.warn(`[clip-precheck] price-override read failed (using static defaults): ${e instanceof Error ? e.message : e}`); }
  const durationMinutes = Number.isFinite(body.estimatedDurationSeconds) && Number(body.estimatedDurationSeconds) > 0
    ? Math.max(1, Math.ceil(Number(body.estimatedDurationSeconds) / 60)) : 0;
  const durationUnitPrice = effectiveUnitPrice(CLIP_SOURCE_MINUTE_ID, priceOverrides[CLIP_SOURCE_MINUTE_ID]);
  if (durationUnitPrice === undefined) return NextResponse.json({ ok: false, error: "Clipping price is unavailable" }, { status: 503 });
  const durationCostUsdc = durationMinutes * durationUnitPrice;
  const estCostUsdc = +(clipSkillRunCostWithOverrides(skillIds, priceOverrides) + durationCostUsdc).toFixed(6);

  // 3) Verdict: account state + balance + daily headroom.
  //
  // FAIL CLOSED on a metering error. This precheck is the ONLY place the wired
  // skills' per-run fees are charged for the canvas (synchronous) path — the
  // charge loop below is the billing chokepoint. The downstream render/
  // transcription meters (meterAgentService) are themselves best-effort
  // fail-OPEN, so if we also fail-open here a metering outage lets a fully
  // priced clip run (captions, facetrack, hook, …) execute completely free.
  // A money gate must not let unmetered priced work slip through, so on a
  // metering-query error we return ok:false (block) rather than ok:true.
  //
  // To avoid blocking a legitimately-funded agent on a one-off transient
  // (network/Convex blip), we retry the read-only verdict queries ONCE before
  // giving up. Reconcile (step 1) already ran best-effort above.
  const readVerdict = async () => {
    // Three independent read-only queries — issued together; any rejection
    // still fails the whole verdict (and triggers the single retry below).
    const [account, today, creditsBalance] = await Promise.all([
      convex.query(api.agentAccount.getWithNav, { mintAddress }),
      convex.query(api.usage.todaysSpendQuery, { mintAddress }),
      // The owner's prepaid credit balance is spent FIRST by recordUsage, so the
      // funding gate below must count it — gating on the agent's own USDC alone
      // denied every credit-funded user before a single charge could be attempted.
      walletOnly ? Promise.resolve(0) : convex.query(api.userCredits.balanceForMint, { mintAddress }),
    ]);
    return { account, today, creditsBalance };
  };

  let account: Awaited<ReturnType<typeof readVerdict>>["account"];
  let today: Awaited<ReturnType<typeof readVerdict>>["today"];
  let creditsBalance: number;
  try {
    ({ account, today, creditsBalance } = await readVerdict());
  } catch (e1) {
    console.warn(`[clip-precheck] verdict read failed, retrying once: ${e1 instanceof Error ? e1.message : e1}`);
    try {
      ({ account, today, creditsBalance } = await readVerdict());
    } catch (e2) {
      // Both attempts failed → we cannot verify funds. FAIL CLOSED so the run
      // does not start unmetered. (Previously returned ok:true/degraded, which
      // let priced skill work run for free during a metering outage.)
      console.error(`[clip-precheck] precheck_unavailable (metering query failed twice): ${e2 instanceof Error ? e2.message : e2}`);
      return NextResponse.json({ ok: false, reason: "precheck_unavailable", estCostUsdc }, { status: 503 });
    }
  }

  if (!account) return NextResponse.json({ ok: false, reason: "no_account", estCostUsdc });
  // Combined balance: agent USDC + owner credits (the two pools recordUsage draws on).
  const spendable = effectiveSpendableUsdc(account, creditsBalance);
  const dailyRemainingUsdc = +(today.capUsdc - today.spentTodayUsdc).toFixed(6);

  if (account.status === "suspended") {
    return NextResponse.json({ ok: false, reason: "suspended", estCostUsdc, spendableUsdc: spendable, dailyRemainingUsdc });
  }
  if (spendable < estCostUsdc) {
    return NextResponse.json({ ok: false, reason: "needs_funding", estCostUsdc, spendableUsdc: spendable, dailyRemainingUsdc });
  }
  // cap <= 0 means "no limit" (matches recordUsage + the UI's "0 = off");
  // only enforce the daily ceiling when a positive cap is set.
  if (today.capUsdc > 0 && dailyRemainingUsdc < estCostUsdc) {
    return NextResponse.json({ ok: false, reason: "daily_cap", estCostUsdc, spendableUsdc: spendable, dailyRemainingUsdc });
  }

  // 4) CHARGE (skills-only): meter each wired+priced skill once for this run →
  //    the agent's tab → swept on-chain to the treasury. Idempotent per
  //    (runId, skillId) so a retry of the run never double-bills. We pre-checked
  //    the SUM above, so each charge fits the cap + balance — EXCEPT under two
  //    concurrent runs on the SAME agent (the canvas in-flight guard blocks
  //    same-session concurrency; cross-device is rare), where a later skill can
  //    hit the cap and be skipped → an UNDER-charge (agent's favor). Acceptable.
  //
  // A per-skill charge that THROWS is treated as a hard failure (fail closed):
  // we cannot prove the priced skill was metered, so we block the run rather
  // than let it proceed unbilled. A clean DENIAL (ok:false, e.g. daily_cap on a
  // later skill) is the documented under-charge edge above and is left as a
  // warning so the rest of the run can proceed.
  const charged: { skillId: string; costUsdc: number }[] = [];
  if (runId) {
    for (const skillId of [...new Set(skillIds)]) {
      // Skip free/unpriced AND zero-priced skills (e.g. clip.speed, priced 0 because
      // ffmpeg strips it) — metering a $0 skill only writes a noise ledger row and,
      // under the fail-closed charge path below, adds a needless 503 surface. Uses
      // the EFFECTIVE price (admin override ?? static) so a skill an admin has just
      // priced up from $0 is charged, and one zeroed by an admin is skipped.
      const effPrice = effectiveUnitPrice(skillId, priceOverrides[skillId]);
      if (!(typeof effPrice === "number" && effPrice > 0)) continue;
      try {
        const r = await convex.mutation(api.usage.recordUsage, { mintAddress, service: skillId, qty: 1, idemKey: `${runId}:skill:${skillId}`, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
        if (r.ok) charged.push({ skillId, costUsdc: r.costUsdc });
        else console.warn(`[clip-precheck] charge ${skillId} denied: ${r.reason}`);
      } catch (e) {
        console.error(`[clip-precheck] precheck_unavailable (charge ${skillId} threw): ${e instanceof Error ? e.message : e}`);
        return NextResponse.json({ ok: false, reason: "precheck_unavailable", estCostUsdc }, { status: 503 });
      }
    }
  }
  return NextResponse.json({ ok: true, estCostUsdc, spendableUsdc: spendable, dailyRemainingUsdc, charged });
}
