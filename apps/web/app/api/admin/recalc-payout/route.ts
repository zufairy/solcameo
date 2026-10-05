import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { recalcSubmissionPayout, recalcAllPayouts } from "@/lib/server/contentRewardSubmissions";

export const maxDuration = 120;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const RECORD_EARNINGS = makeFunctionReference<"mutation">("submissions:recordContentRewardEarnings");
const LIST_AGENTS = makeFunctionReference<"query">("influencers:listAll");

type AgentLite = { mintAddress: string; creatorWallet?: string; name?: string };

/** Resolve a submission's agent mint from (ownerWallet, agentName) against the
 *  influencers list: exact wallet+name, else the owner's sole agent. */
function buildMintResolver(agents: AgentLite[]): (wallet: string, name: string) => string | null {
  const byWalletName = new Map<string, string>();
  const byWallet = new Map<string, string[]>();
  for (const a of agents) {
    const w = (a.creatorWallet ?? "").trim();
    if (!w) continue;
    byWalletName.set(`${w}::${(a.name ?? "").trim().toLowerCase()}`, a.mintAddress);
    (byWallet.get(w) ?? byWallet.set(w, []).get(w)!).push(a.mintAddress);
  }
  return (wallet, name) => {
    const w = (wallet ?? "").trim();
    if (!w) return null;
    const exact = byWalletName.get(`${w}::${(name ?? "").trim().toLowerCase()}`);
    if (exact) return exact;
    const mints = byWallet.get(w);
    return mints && mints.length === 1 ? mints[0] : null; // sole agent → unambiguous
  };
}

/**
 * Recompute content-reward payout(s) from the campaign reward rate × current views
 * and persist to calculated_payout. Same-origin + admin-gated (Supabase token).
 *  - `{ all: true }`          → "Sync Payout": recompute EVERY vello submission.
 *  - `{ submissionId: "…" }`  → per-row refresh: recompute that one submission.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { submissionId?: string; accessToken?: string; all?: boolean };
  if (!body.all && !body.submissionId) {
    return NextResponse.json({ ok: false, error: "submissionId or all required" }, { status: 400 });
  }

  // Authorize: internal secret OR an admin Supabase token (verified via Convex).
  if (!checkInternalSecret(req)) {
    const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
    if (!body.accessToken || !convex) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const chk = (await convex.action(CHECK_ADMIN, { accessToken: body.accessToken }).catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const r = body.all ? await recalcAllPayouts() : await recalcSubmissionPayout(body.submissionId!);

  // Mirror the computed payouts (converted to USD) into the Convex distributions
  // ledger → updates each agent's monthlyEarnings / lifetime / APR / PnL / chart.
  let earningsRecorded = 0;
  if (r.ok && r.items && r.items.length && CONVEX_URL) {
    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    try {
      const convex = new ConvexHttpClient(CONVEX_URL);
      const agents = (await convex.query(LIST_AGENTS, {})) as AgentLite[];
      const resolveMint = buildMintResolver(agents);
      const ledgerItems = r.items
        .map((it) => {
          const mint = resolveMint(it.ownerWallet, it.agentName);
          return mint
            ? { contentRewardSubmissionId: it.contentRewardSubmissionId, mintAddress: mint, usdc: it.usdc, ...(it.postedAtMs ? { postedAtMs: it.postedAtMs } : {}) }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (ledgerItems.length) {
        const res = (await convex.mutation(RECORD_EARNINGS, { authSecret: secret, items: ledgerItems })) as { agents?: number };
        earningsRecorded = ledgerItems.length;
        void res;
      }
    } catch (e) {
      console.warn("[recalc-payout] earnings mirror failed:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ...r, earningsRecorded }, { status: r.ok ? 200 : 500 });
}
