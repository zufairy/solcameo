// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Regression for the reward-submit "missing email" loop (commit c4f6716,
// lib/server/contentRewardSubmit.ts) ──
// jobtepi's users.email is NOT NULL + unique, but wallet-auth creators have no
// real email. The auto-create insert must synthesize a deterministic placeholder
// (`<wallet>@wallet.vello.gg`); without it the submit looped forever on
// "null value in column email violates not-null". This pins that the inserted
// users row carries a non-empty, wallet-derived email — and that a successful
// insert does NOT retry.

// Supabase client is built via createClient at call time; capture every insert.
const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
let usersInsertError: { message?: string; code?: string; details?: string; hint?: string } | null = null;
let bindingsTableMissing = false;
let existingUserByEmail: { id: string } | null = null;
const wallet = "5jiduf1xAbCdEfGhJkLmNpQrStUvWxYz1234567890AB";

// Stateful stores so repeat submits resolve to the SAME jobtepi user (by
// deterministic email) and the dedup pre-read can find an already-filed
// submission — mirrors the real DB where the user (email) and a submission's
// (content_reward_id, user_id, content_url) are stable across a re-post.
const usersStore: Record<string, { id: string }> = {};
const submissionStore: { id: string; content_reward_id: string; user_id: string; content_url: string }[] = [];
let submissionCounter = 0;

// A fake query-builder that records inserts and returns sensible reads.
function makeFakeSupabase() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const api: Record<string, unknown> = {};
      const chain = () => api;
      api.select = chain;
      api.eq = (col: string, val: unknown) => { filters[col] = val; return api; };
      api.maybeSingle = async () => {
        if (table === "wallet_auth_bindings" && bindingsTableMissing)
          return { data: null, error: { code: "42P01", message: 'relation "public.wallet_auth_bindings" does not exist' } };
        if (table === "users") // the by-email lookup — stateful so a re-submit reuses the auto-created user
          return { data: existingUserByEmail ?? usersStore[String(filters.email)] ?? null };
        if (table === "content_rewards_submissions") {
          // the dedup pre-read: find an already-filed submission on (reward, user, url).
          const hit = submissionStore.find(
            (s) => s.content_reward_id === filters.content_reward_id
              && s.user_id === filters.user_id
              && s.content_url === filters.content_url,
          );
          return { data: hit ? { id: hit.id } : null };
        }
        return { data: null };
      };
      api.single = async () => {
        if (table === "content_rewards_submissions") return { data: { id: "sub_1" }, error: null };
        return { data: null, error: null };
      };
      api.insert = (rows: Record<string, unknown>[]) => {
        inserts.push({ table, rows });
        // users + wallet_auth_bindings inserts succeed (no error).
        if (table === "content_rewards_submissions") {
          const id = `sub_${++submissionCounter}`;
          const row = rows[0] ?? {};
          submissionStore.push({
            id,
            content_reward_id: String(row.content_reward_id),
            user_id: String(row.user_id),
            content_url: String(row.content_url),
          });
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        }
        if (table === "users" && !usersInsertError) {
          // remember the auto-created user by email so a repeat submit resolves the SAME id.
          const row = rows[0] ?? {};
          if (row.email) usersStore[String(row.email)] = { id: String(row.id) };
        }
        // A configured error on the `users` insert simulates jobtepi rejecting the
        // auto-create (RLS / trigger / permission) — the failure mode we self-diagnose.
        let err = table === "users" ? usersInsertError : null;
        if (table === "wallet_auth_bindings" && bindingsTableMissing)
          err = { code: "42P01", message: 'relation "public.wallet_auth_bindings" does not exist' };
        const result = { error: err };
        // .then for the fire-and-forget binding insert path.
        return { ...result, then: (res: (v: unknown) => void) => res(result) };
      };
      api.delete = () => ({ eq: () => ({ then: (res: () => void) => res() }) });
      // For content_rewards read: maybeSingle returns an active campaign.
      if (table === "content_rewards") {
        api.maybeSingle = async () => ({
          data: { id: "cr_1", community_id: "comm_1", reward_rate: 1, max_payout: 100, flat_fee_bonus: 0, status: "active" },
        });
      }
      return api;
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => makeFakeSupabase() }));

beforeEach(() => {
  inserts.length = 0;
  usersInsertError = null;
  bindingsTableMissing = false;
  existingUserByEmail = null;
  for (const k of Object.keys(usersStore)) delete usersStore[k];
  submissionStore.length = 0;
  submissionCounter = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
});
afterEach(() => vi.resetModules());

describe("contentRewardSubmit — auto-created jobtepi user has a non-empty email", () => {
  it("inserts a users row with email = <wallet>@wallet.vello.gg (satisfies NOT-NULL)", async () => {
    vi.resetModules();
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const out = await submitContentRewardLink({
      contentRewardId: "cr_1",
      ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1",
      platform: "tiktok",
      views: 5000,
    });
    expect(out.ok).toBe(true);

    const usersInsert = inserts.find((i) => i.table === "users");
    expect(usersInsert, "a users row must be auto-created").toBeTruthy();
    const row = usersInsert!.rows[0];
    expect(typeof row.email).toBe("string");
    expect(row.email).toBe(`${wallet}@wallet.vello.gg`);
    expect(String(row.email).length).toBeGreaterThan(0);
    // deterministic username from the wallet too.
    expect(String(row.username)).toContain("vello_");
  });

  it("does NOT loop: exactly one users insert on a successful create", async () => {
    vi.resetModules();
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    await submitContentRewardLink({
      contentRewardId: "cr_1",
      ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1",
      platform: "tiktok",
      views: 0,
    });
    const usersInserts = inserts.filter((i) => i.table === "users");
    expect(usersInserts).toHaveLength(1);
  });
});

describe("contentRewardSubmit — self-diagnose: surfaces the real DB error", () => {
  it("includes the raw users-insert error in the failure reason (not just the generic code)", async () => {
    vi.resetModules();
    usersInsertError = { message: 'permission denied for table "community_members"', code: "42501" };
    delete process.env.VELLO_FALLBACK_JOBTEPI_USER_ID;
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const out = await submitContentRewardLink({
      contentRewardId: "cr_1",
      ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1",
      platform: "tiktok",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    // keeps the machine-readable code (so explainSubmitFailure still maps it)…
    expect(out.reason).toContain("no_jobtepi_user_for_wallet");
    // …AND surfaces the ACTUAL Postgres error so it's diagnosable from one glance.
    expect(out.reason).toContain('permission denied for table "community_members"');
  });

  it("surfaces code/details when the DB error message is EMPTY (the lossy-capture bug from prod)", async () => {
    vi.resetModules();
    usersInsertError = { message: "", code: "42501", details: "permission denied for table users" };
    delete process.env.VELLO_FALLBACK_JOBTEPI_USER_ID;
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const out = await submitContentRewardLink({
      contentRewardId: "cr_1", ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1", platform: "tiktok",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.reason).toContain("no_jobtepi_user_for_wallet");
    // an empty .message must NOT yield an empty reason — code/details carry it.
    expect(out.reason).toContain("42501");
    expect(out.reason).toContain("permission denied for table users");
    expect(out.reason).not.toMatch(/no_jobtepi_user_for_wallet:\s*$/);
  });
});

describe("contentRewardSubmit — works WITHOUT the wallet_auth_bindings table (root cause)", () => {
  it("still provisions + submits when wallet_auth_bindings is MISSING (jobtepi has no such table)", async () => {
    vi.resetModules();
    bindingsTableMissing = true;
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const out = await submitContentRewardLink({
      contentRewardId: "cr_1", ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1", platform: "tiktok",
    });
    expect(out.ok).toBe(true); // user created + submission filed despite the missing binding table
    expect(inserts.find((i) => i.table === "users"), "a users row must be auto-created").toBeTruthy();
  });

  it("reuses the existing wallet-keyed user by email on a repeat submit (no duplicate insert)", async () => {
    vi.resetModules();
    bindingsTableMissing = true;
    existingUserByEmail = { id: "existing-user-id" };
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const out = await submitContentRewardLink({
      contentRewardId: "cr_1", ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1", platform: "tiktok",
    });
    expect(out.ok).toBe(true);
    expect(inserts.filter((i) => i.table === "users")).toHaveLength(0); // found by email, not re-created
  });
});

describe("contentRewardSubmit — per-agent identity (one wallet, many agents)", () => {
  it("folds the agent name into the user's email so each agent gets its OWN named user", async () => {
    vi.resetModules();
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    await submitContentRewardLink({
      contentRewardId: "cr_1", ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1", platform: "tiktok",
      ownerName: "Brainrot Master",
    });
    const row = inserts.find((i) => i.table === "users")?.rows[0];
    expect(row?.name).toBe("Brainrot Master");
    // email is wallet-derived AND agent-specific — so a second agent on this wallet
    // can't collapse onto the same user (which showed the first agent's name).
    expect(String(row?.email)).toContain("brainrot-master");
    expect(String(row?.email).startsWith(wallet)).toBe(true);
  });

  it("two agents on the SAME wallet get DISTINCT user emails (no shared name)", async () => {
    vi.resetModules();
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    await submitContentRewardLink({ contentRewardId: "cr_1", ownerWallet: wallet, contentUrl: "https://x/1", platform: "tiktok", ownerName: "Brainrot Master" });
    await submitContentRewardLink({ contentRewardId: "cr_1", ownerWallet: wallet, contentUrl: "https://x/2", platform: "tiktok", ownerName: "The Market Alchemist" });
    const emails = inserts.filter((i) => i.table === "users").map((i) => String(i.rows[0].email));
    expect(new Set(emails).size).toBe(2);
  });
});

describe("contentRewardSubmit — idempotent submission (dedupe duplicate /stage/reward rows)", () => {
  // A clip can be submitted twice for the SAME (content_reward, user, content_url):
  // an inline auto-post stalls "posting" → reapStaleJobs reverts it to ready → the
  // drip re-claims and posts+submits AGAIN (also reachable via drip + a later manual
  // /api/social/post of the same clip). The insert MUST be idempotent so the re-post
  // is a no-op instead of minting a 2nd display row on /stage/reward.
  it("a re-submit of the same (reward, user, url) returns the SAME id WITHOUT a second insert", async () => {
    vi.resetModules();
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const args = {
      contentRewardId: "cr_1",
      ownerWallet: wallet,
      contentUrl: "https://tiktok.com/@a/video/1",
      platform: "tiktok",
      views: 5000,
    };

    const first = await submitContentRewardLink(args);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("first submit should succeed");

    // Re-post of the identical clip (reap→re-post, or drip+manual) — must no-op.
    const second = await submitContentRewardLink(args);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("second submit should succeed");

    // Same submission id — the duplicate is a no-op, not a new row.
    expect(second.submissionId).toBe(first.submissionId);
    // Exactly ONE insert into content_rewards_submissions across BOTH calls.
    const subInserts = inserts.filter((i) => i.table === "content_rewards_submissions");
    expect(subInserts).toHaveLength(1);
  });

  it("a DIFFERENT content_url for the same reward+user still inserts (not over-deduped)", async () => {
    vi.resetModules();
    const { submitContentRewardLink } = await import("./contentRewardSubmit");
    const base = { contentRewardId: "cr_1", ownerWallet: wallet, platform: "tiktok", views: 5000 };
    const a = await submitContentRewardLink({ ...base, contentUrl: "https://tiktok.com/@a/video/1" });
    const b = await submitContentRewardLink({ ...base, contentUrl: "https://tiktok.com/@a/video/2" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("both distinct submits should succeed");
    expect(a.submissionId).not.toBe(b.submissionId);
    expect(inserts.filter((i) => i.table === "content_rewards_submissions")).toHaveLength(2);
  });
});
