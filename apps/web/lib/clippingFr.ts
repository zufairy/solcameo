/**
 * "Clipping FR" mirror — pure conversion, planning, and orchestration.
 *
 * Each jobtepi clipping content_reward (MYR-denominated, Supabase display rail)
 * gets its OWN funded on-chain USDC campaign treasury: a Convex `campaigns` row
 * linked back via `contentRewardId` + a vello-escrow vault PDA holding the
 * budget. Scale is RM 100 → 1 USDC (RM 5,000 budget → 50 USDC vault; RM 8/1K
 * reward rate → 0.08 USDC/1K).
 *
 * Everything here is side-effect-free (launchMachine style) so the money-path
 * decisions are unit-tested without a wallet, RPC, or React. The admin mirror
 * panel wires `MirrorOps` to the real Convex mutation + escrow client, reusing
 * the SAME double-charge safety as the campaign launch form: verify the vault
 * on-chain before signing, and re-verify after a sign error before ever calling
 * an attempt failed.
 */
import {
  campaignDeadlineError,
  classifyLaunchError,
  decideBeforeSign,
} from "./client/launchMachine";

export const CLIPPING_FR_ORIGIN = "clipping_fr";

/** Boss-set scale for the USDC mirror: RM 100 of jobtepi budget → 1 USDC. */
export const MYR_PER_USDC = 100;

/** Flat Vello reward rate shown on EVERY clipping campaign in the UI: $0.20 USDC
 *  per 1,000 verified views. Display-only — a uniform rate the boss chose over
 *  converting each jobtepi campaign's RM rate. The on-chain mirror vault still
 *  funds at its own converted per-1k rate; this constant only drives what the
 *  content-reward board card + detail page render. */
export const CLIPPING_REWARD_RATE_USDC = 0.2;

/** Mirror campaigns run 180 days — comfortably inside the on-chain
 *  create_campaign deadline window of [now + 6h, now + 365d]. */
export const CLIPPING_FR_DURATION_MS = 180 * 24 * 60 * 60 * 1000;

const USD_LIKE = new Set(["USD", "USDC"]);

/** Convert a content_reward money amount to USDC. MYR (the jobtepi default —
 *  also assumed when the currency is missing) scales at MYR_PER_USDC; USD/USDC
 *  pass through 1:1. Rounded to 6 decimals (USDC base-unit precision) so an
 *  integer-RM division never carries float dust into the on-chain deposit. */
export function contentRewardAmountToUsdc(
  amount: number,
  currency: string | null | undefined,
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const code = (currency ?? "MYR").toUpperCase();
  const usdc = USD_LIKE.has(code) ? amount : amount / MYR_PER_USDC;
  return Math.round(usdc * 1e6) / 1e6;
}

/** Pull http(s) URLs out of a content_reward's free-text `available_content`
 *  so the mirror campaign carries clippable source links (feeds the shared
 *  pre-transcribe cache + the campaign detail page). Deduped, capped. */
export function extractSourceLinks(text: string | null | undefined, max = 8): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const url = raw.replace(/[.,;]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** The subset of a jobtepi ContentReward the mirror reads (structural, so the
 *  real `ContentReward` from lib/content-rewards satisfies it). */
export type ClippingRewardSource = {
  id: string;
  campaign_name: string;
  type?: string;
  budget: number;
  currency?: string;
  reward_rate?: number;
  platforms?: string[];
  thumbnail_url?: string;
  available_content?: string;
  content_requirements?: string[];
  communityName?: string;
  ownerName?: string;
  status?: string;
};

/** Args for `api.campaigns.create` when minting a Clipping FR mirror row. */
export type ClippingFrCreateArgs = {
  creatorWallet: string;
  brandName: string;
  title: string;
  brief: string;
  budget: number;
  ratePerThousandViews: number;
  campaignType: "marketing";
  contentLinks?: string[];
  targetNiche: string[];
  targetLanguage: string[];
  platforms?: string[];
  deadline: string;
  contentRewardId: string;
  origin: string;
  campaignImageUrl?: string;
  /** MANDATORY campaign requirements (create() rejects an empty array). Mirrors the
   *  jobtepi content_reward's content_requirements; falls back to a generic clip
   *  rule when the reward carries none, so the now-required field is never empty. */
  requirements: string[];
};

export function buildClippingFrCreateArgs(
  reward: ClippingRewardSource,
  opts: { creatorWallet: string; nowMs: number },
): ClippingFrCreateArgs {
  const budget = contentRewardAmountToUsdc(reward.budget, reward.currency);
  const rate = contentRewardAmountToUsdc(reward.reward_rate ?? 0, reward.currency);
  const links = extractSourceLinks(reward.available_content);
  const requirements = (reward.content_requirements ?? []).filter(Boolean);
  const brief = [
    `On-chain USDC treasury for the jobtepi clipping campaign "${reward.campaign_name}" (Clipping FR).`,
    `Clip the source content and earn ${rate} USDC per 1,000 verified views, paid automatically from this campaign's vault.`,
    requirements.length > 0 ? `Requirements:\n${requirements.map((r) => `• ${r}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    creatorWallet: opts.creatorWallet,
    brandName: reward.communityName || reward.ownerName || "Jobtepi",
    title: reward.campaign_name,
    brief,
    budget,
    ratePerThousandViews: rate,
    campaignType: "marketing",
    contentLinks: links.length > 0 ? links : undefined,
    targetNiche: [],
    targetLanguage: [],
    platforms: reward.platforms && reward.platforms.length > 0 ? reward.platforms : undefined,
    deadline: new Date(opts.nowMs + CLIPPING_FR_DURATION_MS).toISOString(),
    contentRewardId: reward.id,
    origin: CLIPPING_FR_ORIGIN,
    campaignImageUrl: reward.thumbnail_url || undefined,
    requirements: requirements.length ? requirements : ["Clip the source content and post as instructed."],
  };
}

/** The subset of a Convex campaigns doc the planner reads. */
export type MirrorCampaignRow = {
  _id: string;
  contentRewardId?: string | null;
  origin?: string | null;
  pdaAddress?: string | null;
  onchainVersion?: number | null;
  budget: number;
  ratePerThousandViews: number;
  deadline: string;
};

export type MirrorPlanItem =
  | { kind: "create"; reward: ClippingRewardSource; args: ClippingFrCreateArgs }
  | {
      kind: "resume";
      reward: ClippingRewardSource;
      campaignId: string;
      /** Fund EXACTLY the draft's stored terms — a resume must deposit what the
       *  row records, not a recomputed amount (same rule as the launch form). */
      budget: number;
      ratePerThousandViews: number;
      deadline: string;
    }
  | { kind: "done"; reward: ClippingRewardSource; campaignId: string };

/** Decide what each active clipping reward needs:
 *  - ANY linked campaign already funded on the v2 rail → done (the vault exists;
 *    getFundedByContentRewardId will route agent clips to it).
 *  - an unfunded Clipping-FR draft → resume it (never insert a second row).
 *  - otherwise → create a fresh mirror row. A stray unfunded NON-mirror link
 *    (e.g. autoLinkContentReward) must not block the mirror. */
export function planClippingFrMirror(
  rewards: ClippingRewardSource[],
  campaigns: MirrorCampaignRow[],
  opts: { creatorWallet: string; nowMs: number },
): MirrorPlanItem[] {
  const byReward = new Map<string, MirrorCampaignRow[]>();
  for (const c of campaigns) {
    if (!c.contentRewardId) continue;
    const arr = byReward.get(c.contentRewardId) ?? [];
    arr.push(c);
    byReward.set(c.contentRewardId, arr);
  }

  const out: MirrorPlanItem[] = [];
  for (const reward of rewards) {
    if ((reward.type ?? "").toLowerCase() !== "clipping") continue;
    const linked = byReward.get(reward.id) ?? [];

    const funded = linked.find((c) => !!c.pdaAddress && (c.onchainVersion ?? 1) >= 2);
    if (funded) {
      out.push({ kind: "done", reward, campaignId: funded._id });
      continue;
    }

    const draft = linked.find((c) => c.origin === CLIPPING_FR_ORIGIN && !c.pdaAddress);
    if (draft) {
      // A stale draft deadline would revert InvalidDeadline on-chain — refresh it
      // (the vault was never created, so new terms are safe to lock).
      const deadline =
        campaignDeadlineError(Date.parse(draft.deadline), opts.nowMs) === null
          ? draft.deadline
          : new Date(opts.nowMs + CLIPPING_FR_DURATION_MS).toISOString();
      out.push({
        kind: "resume",
        reward,
        campaignId: draft._id,
        budget: draft.budget,
        ratePerThousandViews: draft.ratePerThousandViews,
        deadline,
      });
      continue;
    }

    out.push({ kind: "create", reward, args: buildClippingFrCreateArgs(reward, opts) });
  }
  return out;
}

/**
 * RUST-4 money guard: a vault funded at a 0 (or null/negative/non-finite) per-1k
 * rate — or a 0 budget — would lock USDC in a treasury that can NEVER pay a
 * clipper (the on-chain claim math multiplies views × rate = 0). Refuse to fund
 * such a vault. Returns a human-readable reason string when funding must be
 * refused, or `null` when the terms are payable. Pure — unit-tested directly.
 */
export function clippingFrFundingRefusal(
  budgetUsdc: number | null | undefined,
  ratePer1kUsdc: number | null | undefined,
): string | null {
  const budgetOk = typeof budgetUsdc === "number" && Number.isFinite(budgetUsdc) && budgetUsdc > 0;
  const rateOk = typeof ratePer1kUsdc === "number" && Number.isFinite(ratePer1kUsdc) && ratePer1kUsdc > 0;
  if (budgetOk && rateOk) return null;
  return (
    `Refusing to fund a 0-value vault (budget=${budgetUsdc ?? 0} USDC, rate=${ratePer1kUsdc ?? 0} USDC/1k). ` +
    `A funded vault at ${!rateOk ? "rate 0" : "budget 0"} pays clippers nothing — ` +
    `fix the reward's ${!rateOk ? "reward_rate" : "budget"} before mirroring it on-chain.`
  );
}

/** Per-campaign MANUAL override of the on-chain deposit + reward rate + deadline.
 *  The operator can replace the RM→USDC auto-conversion for a single mirror row
 *  (e.g. fund 30 USDC at 0.10/1k instead of the RM-derived 50 @ 0.08) and pick a
 *  custom on-chain deadline instead of the auto 180d default. A field left
 *  null/undefined keeps that field's auto value. */
export type MirrorOverride = {
  budgetUsdc?: number | null;
  ratePerThousandViews?: number | null;
  /** Absolute epoch ms for the on-chain create_campaign deadline. Replaces the
   *  auto now+180d default. Null/undefined/non-finite keeps the auto deadline. */
  overrideDeadlineMs?: number | null;
};

/** Resolve the EFFECTIVE on-chain deposit + per-1k rate for one mirror row.
 *  Default = the RM→USDC auto-converted `auto` values. An `override` field
 *  REPLACES its auto value whenever it is a finite number — including the
 *  operator's own smaller/larger/zero figure. A null/undefined/non-finite field
 *  keeps auto. Whether the resolved terms are actually PAYABLE (>0) is enforced
 *  separately by `clippingFrFundingRefusal`, so a ≤0 override flows through and
 *  is refused there rather than silently reverting to auto (the operator can't
 *  accidentally fund the auto amount by clearing a box to 0). `overridden` is
 *  true when either resolved value differs from auto. Pure — unit-tested. */
export function resolveMirrorAmounts(
  auto: { budgetUsdc: number; ratePerThousandViews: number },
  override?: MirrorOverride | null,
): { budgetUsdc: number; ratePerThousandViews: number; overridden: boolean } {
  const pick = (o: number | null | undefined, fallback: number): number =>
    typeof o === "number" && Number.isFinite(o) ? o : fallback;
  const budgetUsdc = pick(override?.budgetUsdc, auto.budgetUsdc);
  const ratePerThousandViews = pick(override?.ratePerThousandViews, auto.ratePerThousandViews);
  const overridden =
    budgetUsdc !== auto.budgetUsdc || ratePerThousandViews !== auto.ratePerThousandViews;
  return { budgetUsdc, ratePerThousandViews, overridden };
}

/** Resolve the EFFECTIVE on-chain deadline (ISO) for one mirror row and validate
 *  the operator's pick against the on-chain create_campaign window.
 *  - No override (or a null/undefined/non-finite `overrideDeadlineMs`) → keep the
 *    plan's auto `now+180d` deadline. The plan already guarantees that value is
 *    in-window, so it is never flagged.
 *  - An override REPLACES the auto deadline. It is validated with the SAME
 *    `campaignDeadlineError` used by the launch form: a pick outside
 *    [now+6h, now+365d] returns a non-null `error` so the caller can refuse the
 *    row before create_campaign reverts InvalidDeadline (6002).
 *  Pure — unit-tested. */
export function resolveMirrorDeadline(
  autoDeadlineIso: string,
  override: MirrorOverride | null | undefined,
  nowMs: number,
): { deadline: string; overridden: boolean; error: string | null } {
  const ms = override?.overrideDeadlineMs;
  if (typeof ms === "number" && Number.isFinite(ms)) {
    return {
      deadline: new Date(ms).toISOString(),
      overridden: true,
      error: campaignDeadlineError(ms, nowMs),
    };
  }
  return { deadline: autoDeadlineIso, overridden: false, error: null };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export type MirrorFunding = { ok: boolean; needUsdc: boolean; needSol: boolean };

/** Side effects injected by the admin panel (Convex mutation + escrow client). */
export type MirrorOps = {
  createRow: (args: ClippingFrCreateArgs) => Promise<string>;
  checkFunding: (budgetUsdc: number) => Promise<MirrorFunding>;
  vaultFunded: (campaignId: string, budgetUsdc: number) => Promise<boolean>;
  signCreateCampaign: (
    campaignId: string,
    budgetUsdc: number,
    ratePer1kUsdc: number,
    deadlineUnix: number,
  ) => Promise<{ pdaAddress: string }>;
  derivePda: (campaignId: string) => string;
  finalize: (
    campaignId: string,
    pdaAddress: string,
    terms: { budget: number; ratePerThousandViews: number; deadline: string; contentRewardId: string },
  ) => Promise<void>;
};

export type MirrorItemResult = {
  rewardId: string;
  title: string;
  status: "funded" | "already-funded" | "failed" | "skipped" | "halted-funds";
  campaignId?: string;
  pdaAddress?: string;
  error?: string;
};

/** Run a mirror plan sequentially (one wallet signature per campaign).
 *  - The wallet-balance gate runs BEFORE inserting a draft row, and a shortfall
 *    halts the whole run (every later item would fail the same way).
 *  - A sign error re-reads the vault before reporting failure, so a
 *    landed-but-timed-out deposit finalizes instead of double-charging.
 *  - Deterministic on-chain reverts fail only their own item; the run continues. */
export async function runClippingFrMirror(
  plan: MirrorPlanItem[],
  ops: MirrorOps,
  onProgress?: (done: MirrorItemResult[]) => void,
  /** Optional per-campaign manual override of deposit/rate/deadline, keyed by the
   *  source content-reward id. When a row has an override, its budget/rate REPLACE
   *  the RM→USDC auto-conversion and its deadline REPLACES the auto 180d default in
   *  the on-chain create_campaign call (and in the finalized row terms). Absent →
   *  the auto-converted values + 180d deadline are used. */
  overrides?: Record<string, MirrorOverride>,
  /** Wall clock used to validate a picked deadline against the on-chain
   *  [now+6h, now+365d] window. Defaults to now; the admin panel passes the same
   *  clock it planned with so plan and validation agree. */
  nowMs: number = Date.now(),
): Promise<{ results: MirrorItemResult[]; haltReason: "usdc" | "sol" | null }> {
  const results: MirrorItemResult[] = [];
  let haltReason: "usdc" | "sol" | null = null;
  const push = (r: MirrorItemResult) => {
    results.push(r);
    onProgress?.([...results]);
  };

  for (const item of plan) {
    const rewardId = item.reward.id;
    const title = item.reward.campaign_name;

    if (haltReason) {
      push({ rewardId, title, status: "skipped", error: `wallet needs more ${haltReason.toUpperCase()}` });
      continue;
    }
    if (item.kind === "done") {
      push({ rewardId, title, status: "already-funded", campaignId: item.campaignId });
      continue;
    }

    // Auto (RM→USDC) terms carried by the plan item, then apply any per-campaign
    // manual override. `terms.budget`/`ratePerThousandViews` are the EFFECTIVE
    // deposit + rate fed into signCreateCampaign (→ createCampaignTx: budget ==
    // deposit) AND into finalize — so an override flows to both the on-chain
    // vault and the written-back row. Deadline is never overridden.
    const autoAmounts =
      item.kind === "create"
        ? { budgetUsdc: item.args.budget, ratePerThousandViews: item.args.ratePerThousandViews }
        : { budgetUsdc: item.budget, ratePerThousandViews: item.ratePerThousandViews };
    const resolved = resolveMirrorAmounts(autoAmounts, overrides?.[rewardId]);
    // Deadline: the plan's auto now+180d value, unless the operator picked one.
    // THIS is the single seam where a per-row override REPLACES the 180d default —
    // the resolved deadline feeds signCreateCampaign (→ create_campaign's
    // `deadline`) AND the finalized row terms. Deposit/rate resolve just above.
    const autoDeadline = item.kind === "create" ? item.args.deadline : item.deadline;
    const resolvedDeadline = resolveMirrorDeadline(autoDeadline, overrides?.[rewardId], nowMs);
    const terms = {
      budget: resolved.budgetUsdc,
      ratePerThousandViews: resolved.ratePerThousandViews,
      deadline: resolvedDeadline.deadline,
    };

    // Deadline guard (twin of the RUST-4 funding refusal): a picked deadline
    // outside the on-chain [now+6h, now+365d] window would revert InvalidDeadline
    // (6002). Fail THIS item with the validator's message before signing — the
    // rest of the run is unaffected. The panel also blocks the button, so this is
    // the never-reach-create_campaign safety net.
    if (resolvedDeadline.error) {
      push({
        rewardId,
        title,
        status: "failed",
        campaignId: item.kind === "resume" ? item.campaignId : undefined,
        error: resolvedDeadline.error,
      });
      continue;
    }

    // RUST-4 pre-flight: never sign a deposit for a vault that would pay clippers
    // nothing (rate 0 or budget 0). Fail THIS item with a clear reason and move on
    // — the rest of the run is unaffected (a bad reward config shouldn't block the
    // others).
    const refusal = clippingFrFundingRefusal(terms.budget, terms.ratePerThousandViews);
    if (refusal) {
      push({
        rewardId,
        title,
        status: "failed",
        campaignId: item.kind === "resume" ? item.campaignId : undefined,
        error: refusal,
      });
      continue;
    }

    try {
      let campaignId: string | undefined = item.kind === "resume" ? item.campaignId : undefined;

      // Resume: a prior attempt may have landed the deposit — check the vault
      // FIRST so a retry finalizes instead of paying twice.
      let vaultAlreadyFunded = false;
      if (campaignId) {
        vaultAlreadyFunded = await ops.vaultFunded(campaignId, terms.budget).catch(() => false);
      }

      if (!vaultAlreadyFunded) {
        const funding = await ops.checkFunding(terms.budget);
        const decision = decideBeforeSign({ vaultFunded: false, funding });
        if (decision.action === "fund-wallet") {
          haltReason = decision.reason;
          push({
            rewardId,
            title,
            status: "halted-funds",
            campaignId,
            error: `wallet needs more ${decision.reason.toUpperCase()}`,
          });
          continue;
        }
      }

      if (item.kind === "create") {
        // Persist the effective (possibly overridden) budget/rate into the draft
        // row so a later RESUME funds what the operator set — not the auto amount
        // — and never diverges from the vault. Metadata (brief, links, thumbnail,
        // requirements, contentRewardId, origin) is left exactly as built.
        const createArgs = resolved.overridden
          ? { ...item.args, budget: terms.budget, ratePerThousandViews: terms.ratePerThousandViews }
          : item.args;
        campaignId = await ops.createRow(createArgs);
      }
      if (!campaignId) throw new Error("no campaign row");

      let pdaAddress: string;
      if (vaultAlreadyFunded) {
        pdaAddress = ops.derivePda(campaignId);
      } else {
        try {
          const signed = await ops.signCreateCampaign(
            campaignId,
            terms.budget,
            terms.ratePerThousandViews,
            Math.floor(Date.parse(terms.deadline) / 1000),
          );
          pdaAddress = signed.pdaAddress;
        } catch (err) {
          // Same rule as the launch form: verify on-chain before calling it a
          // failure — a confirmation timeout routinely fires after the deposit
          // actually landed.
          const landed = await ops.vaultFunded(campaignId, terms.budget).catch(() => false);
          if (landed) {
            pdaAddress = ops.derivePda(campaignId);
          } else {
            const cls = classifyLaunchError(err instanceof Error ? err.message : String(err));
            push({
              rewardId,
              title,
              status: "failed",
              campaignId,
              error: cls.deterministic
                ? cls.message
                : `Deposit unconfirmed — run the mirror again; it verifies on-chain and never charges twice. ${cls.message}`,
            });
            continue;
          }
        }
      }

      try {
        await ops.finalize(campaignId, pdaAddress, { ...terms, contentRewardId: rewardId });
      } catch (err) {
        push({
          rewardId,
          title,
          status: "failed",
          campaignId,
          pdaAddress,
          error: `Vault funded but finalizing failed — run the mirror again to finish (no re-charge). ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        continue;
      }

      push({ rewardId, title, status: "funded", campaignId, pdaAddress });
    } catch (err) {
      push({ rewardId, title, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { results, haltReason };
}
