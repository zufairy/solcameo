# AI Clipper — Agent Settings, Delete & Cockpit Refresh

**Date:** 2026-06-29
**Status:** Approved (design) → ready for implementation plan
**Scope:** AI Clipper Home cockpit ONLY. The AI Influencer / classic Home must remain byte-for-byte unchanged.

---

## 1. Summary

Add an **agent-settings affordance** and a safe **Delete agent** flow to the AI Clipper Home, and give the whole clipper Home a **visual refresh** (restyle only — no data/logic changes).

Three deliverables:

1. **Settings cog → dropdown** on the identity card (gear icon, top-right).
2. **Delete agent** — a type-to-confirm modal wired to the *already-existing* owner-safe delete route.
3. **Cockpit visual refresh** — one consistent card system, a clearer Earnings ledger, refined task cards, skills status, tighter activity/chat — keeping the cream / bold-border brand identity.

The design was validated interactively with the user via the brainstorming visual companion (mockups: `clipper-settings-v1`, `delete-flow-v2`, `final-design`, `cockpit-refresh-v1`).

---

## 2. Goals / Non-goals

**Goals**
- Owner can delete their clipping agent from its own Home, safely (USDC refunded first, irreversible action gated by type-to-confirm).
- A discoverable settings menu (cog → dropdown) that also hosts a couple of light agent actions.
- A more polished, cohesive Home that looks "nice" without altering behaviour.

**Non-goals (this iteration)**
- No changes to the AI Influencer / classic Home, Trader, or Worker cockpits.
- No new backend for delete (the route already exists and is owner-safe).
- No wiring of **Rename** or **Edit persona** actions yet — they appear as `soon` placeholders.
- No restructuring of the clip pipeline, Earnings math, tasks, or chat logic.

---

## 3. Background — what already exists (verified in code)

- **The page:** `ClipperHomeCockpit` in `apps/web/components/builder/AgentWorkspace.tsx` (≈ lines 1802–2460). Clipping-only; rendered when `!homeClassic && isClipping` (guard at ≈ line 978). The classic/influencer Home is a separate inline block (≈ 1033–1748).
- **Identity header:** ≈ 1909–1964 (avatar, name, `@handle`, status badge, NFT link, the green hero CTA). **No settings UI exists today.**
- **Delete backend already built and owner-safe:** `POST /apps/web/app/api/agents/delete/route.ts`.
  - Owner-gated: `requireInternalOrUserAuth` + `requireOwnerWithSiws(auth, agent.creatorWallet)`.
  - **Refunds** the agent wallet's remaining USDC to the owner's wallet **first**; if a non-zero balance fails to transfer it **aborts the delete** (funds never orphaned). Sponsored gas via `PLATFORM_FEE_PAYER_SECRET`.
  - Frees the upload-post profile slot, then `convex.mutation(api.influencers.deleteByMint)` cascade-deletes: `influencers`, `agentAccount`, `clips`, `clipJobs`, `scheduledContent`, `agentSkillFiles`, `clipGraphs`, `agentTasks`.
  - Returns `{ ok, mintAddress, deleted, profileFreed, refund }`.
- **Working front-end reference:** `apps/web/app/studio/page.tsx` already calls this route (`handleDelete`, ≈ 86–110). Owner auth (Privy Bearer + `X-Siws-Session`) is auto-attached by the global fetch interceptor; the SIWS hook re-signs transparently on a `siws_required` 401. We mirror this pattern.
- **SIWS session helper:** `apps/web/hooks/use-siws-session.ts` → `ensureSiwsSession()` (sign once per session; safe to call before a money action).

---

## 4. Design

### 4.1 Settings cog + dropdown

- **Placement:** a gear icon button at the **top-right of the identity card**, vertically aligned with the name row (confirmed by the user against the live mock).
- **Style:** ~38px rounded-square, white, 2px ink border, hard offset shadow (`2px 2px 0`), gear glyph in zinc-800; hover lightens. Matches the cream / neo-brutalist language.
- **Visibility:** the cog renders **only when the agent is minted** (`isMinted === true`). Pre-mint there is no agent to manage, so no cog (consistent with the mint-first gating).
- **Interaction:** click toggles a dropdown anchored below-right; closes on outside-click and on `Escape`. Keyboard accessible (button is focusable; menu items are focusable; `aria-haspopup`, `aria-expanded`).
- **Menu contents (final):**
  | Item | State | Action |
  |---|---|---|
  | Rename agent | `soon` (disabled) | none — tooltip "Coming soon" |
  | Edit persona & knowledge | `soon` (disabled) | none — tooltip "Coming soon" |
  | Daily spend cap | active | smooth-scroll to + focus the existing daily-cap control in the Earnings panel |
  | — divider — | | |
  | **Delete agent** | active, **danger (red)** | opens the Delete modal (§4.2) |

  The `soon` items are visually present (with a small amber `soon` badge) but non-interactive. They reserve the spot and signal the roadmap; wiring them is future work (§7).

### 4.2 Delete agent — type-to-confirm modal

A new modal component (clipper-local), opened from the menu's **Delete agent** item.

**Contents**
- Red warning icon; title **"Delete {agentName}?"**.
- Body: "This permanently removes your agent and everything it made. **It can't be undone.**"
- "What happens" box, two lines:
  - ✓ **{refundAmount} USDC** refunded to your wallet first.
  - 🗑 All clips, scheduled posts, tasks & config deleted.
  - (The route also frees the social slot, but per user decision this line is **not** shown.)
- **Type-to-confirm:** an input labelled "Type **{agentName}** to confirm". The red **Delete agent** button stays disabled until the trimmed, case-insensitive input equals the agent name.
- Actions: **Cancel** (ghost) · **Delete agent** (red, disabled until confirmed).

**Refund amount display:** show the agent's current on-chain USDC (from the cockpit's existing `liveWallet?.usdc` / `onChainBalance`). If still loading/unknown, fall back to copy: "Any remaining USDC is refunded to your wallet first."

**Submit flow**
1. On confirm, set busy state (disable inputs, spinner on the Delete button).
2. `await ensureSiwsSession()` (intentional single wallet signature, matching money-action pattern).
3. `POST /api/agents/delete` with `{ mintAddress }` (auth headers auto-attached).
4. Parse `{ ok, deleted, refund, error }`.
   - **Success:** show a brief success state ("Deleted {name}. Refunded ${amount} USDC."), then **navigate away** to `/studio` (My Agents) — the agent no longer exists on this builder page.
   - **Failure:** keep the modal open and show the route's error inline. The most important case: refund failure returns HTTP 502 with a message like *"Refund of $X USDC to your wallet failed — agent NOT deleted (funds preserved)."* — surface it verbatim so the user understands nothing was deleted.
5. Re-enable controls on failure so the user can retry/cancel.

**Authorization:** ownership is enforced **server-side** (SIWS owner gate). The builder cockpit is the owner's surface; we additionally only show the cog when minted. If a non-owner somehow reaches it, the route returns 403 and the modal surfaces the error.

### 4.3 Cockpit visual refresh (restyle only)

Apply a cohesive visual system to the **inline markup inside `ClipperHomeCockpit`**. All content, data bindings, and handlers are preserved; every currently-wired affordance stays.

- **Unified card system:** white card, 2px ink border, hard offset shadow, consistent radius/padding. Applied to Earnings, Skills, Knowledge, Recent activity, Chat. Section headers become a mono-uppercase label with a small lime accent square (clipper-local style — **not** by editing the shared `SectionHeading`).
- **Identity hero:** unchanged content; add the cog (§4.1). Avatar gains the same hard shadow for consistency.
- **Earnings:** restructure the flat rows into:
  - a hero **"Available"** number (large serif),
  - a small meta line (On-chain / Spent),
  - a 2×2 grid of stat tiles (Burn rate, Runway, Revenue earned, Paid to treasury),
  - the daily cap as a **progress meter** (spent / cap, with "$X left today").
  Keep the wallet address + copy/explorer buttons, the **Deposit** button (→ `DepositModal`), and **Usage details** (→ `UsageDetailModal`).
- **Skills:** keep the Editing-skills empty-state and the Agent-skills list; present each agent skill with an on/off status dot + frequency tag. Keep **Browse** (→ marketplace).
- **Connections:** **keep** the existing `SocialConnectionsPanel` (the mock omitted it; the real refresh retains it in the card frame).
- **Knowledge:** keep the collapsed summary + expand + Upload affordance, in the card frame.
- **Autonomous tasks:** keep the run cards and their `Generate $X` actions and the "Full history → Tasks tab" link. **See §5 for the shared-component constraint** — the refined task-card look must not alter the influencer Home.
- **Recent activity:** tighter timeline rows (dot, label, relative time, status pill); keep the All tasks / All clips / Posting schedule links.
- **Chat:** keep the existing `AgentChatCard` (functional) inside the refreshed card frame — **do not rebuild chat** (it is shared; see §5).

---

## 5. Blast radius & shared-component constraints (critical)

The hard rule: **the AI Influencer / classic Home must render exactly as it does today.** These symbols are shared by both Homes (verified):

- `SectionHeading` — used across classic Home, cockpit, trader, director. **Do not change it.** Use clipper-local heading markup/classes in the cockpit.
- `PrimaryButton` — shared. Don't restyle globally. (The cockpit's green hero CTA is already a raw button, not `PrimaryButton`.)
- `TaskCardRunnable` (def ≈ 3678) — used by classic Home (≈ 1414) **and** cockpit (≈ 2318/2344). **Do not restyle globally.** **Chosen approach:** add an **opt-in** prop (e.g. `variant?: "classic" | "clipper"`, default `"classic"`) that gates the refined styling; **only the cockpit passes `variant="clipper"`**. The default path stays byte-identical, so influencer task cards are guaranteed unchanged.
- `AgentChatCard` — shared (classic 1693, cockpit 2426). **Leave unchanged** this iteration; only its surrounding card frame may change.
- `DepositModal`, `UsageDetailModal`, `SocialConnectionsPanel` — reused as-is.

All new styling for the refresh lives in **clipper-scoped** classNames/markup inside `ClipperHomeCockpit` (or a new clipper-only subcomponent/CSS module), never in shared primitives.

**Verification gate:** before/after the classic/influencer Home must be visually identical (manual check + the existing builder snapshot/e2e if present).

---

## 6. Data & handlers (unchanged)

- Delete reuses `POST /api/agents/delete` + `api.influencers.deleteByMint` (no backend change).
- All cockpit data continues to come from the existing props (`onChainBalance`, `liveWallet`, `spent`, `revenue`, `reserved`, `runnableTasks`, `allTasks`, `splitSkills`, etc.).
- New props the cockpit needs: the **agent name** (already has `displayName`), **mintAddress** (already passed), and the **refund/balance** value (already has `liveWallet`/`onChainBalance`). Delete needs no new data beyond `mintAddress`.
- New local state: `settingsOpen` (menu), `deleteOpen` (modal), `confirmText`, `deleteBusy`, `deleteError`.

---

## 7. Out of scope / future

- **Rename agent** — future: patch `influencers.name` (small mutation or via existing save path) + optimistic UI.
- **Edit persona & knowledge** — future: route into the existing persona/knowledge editor.
- Broader Budget/Posting tab restyles (this iteration is the Home tab).

---

## 8. Edge cases & error handling

- **Pre-mint:** no cog (gated on `isMinted`).
- **Refund transfer fails:** route returns 502 + preserved-funds message; modal stays open, shows it verbatim, agent NOT deleted.
- **Not the owner:** route 403; modal surfaces "only the owner can delete" style error.
- **Wallet not connected / SIWS rejected:** `ensureSiwsSession()` returns null → show "Connect your wallet to delete" and do not POST.
- **Double submit:** disabled Delete button + busy guard.
- **Post-delete navigation:** redirect to `/studio`; the deleted agent's builder URL would otherwise show a stale/empty agent.
- **Menu a11y:** Escape closes; outside-click closes; focus returns to the cog.

---

## 9. Testing / verification

- **Manual (primary):** mint a test clipper → open cog → confirm menu items + `soon` disabled → Delete → type-to-confirm gating → success path refunds + redirects → error path (simulate refund failure) keeps agent.
- **Regression:** open an **influencer** agent Home and confirm it is visually and behaviourally identical (no shared-component drift).
- **Unit (if harness present):** the type-to-confirm enable/disable predicate; the refund-amount formatting.
- Run the existing builder/clipping checks in `apps/web/scripts/` and the lint/build before completion.

---

## 10. Open questions

None blocking. Defaults chosen: refund line shows live on-chain USDC; post-delete redirect → `/studio`; `soon` items disabled (not hidden).
