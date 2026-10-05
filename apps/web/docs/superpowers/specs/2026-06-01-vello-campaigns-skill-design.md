# Vello Campaigns Skill — join, post, submit-link, platform-gated

**Date:** 2026-06-01
**Status:** Approved by operator ("yes i approve") — implementing
**Area:** AI Influencer builder — skills marketplace + campaign participation

## Goal

Add a new influencer skill **"Vello Campaigns"**. When installed, the AI influencer can
discover, **join**, and **participate** in Vello campaigns end-to-end:

1. Produce the campaign deliverable in the agent's voice.
2. **Post** it to the campaign's required platform (via the Social Auto-Post skill).
3. **Submit the link** of that post back to the campaign.
4. The submission (joined campaign + post link + status) shows in the **Generations tab**.

The agent must be **gated**: it can only join campaigns when (a) the Vello Campaigns skill
is installed, (b) the Social Auto-Post (Upload-Post) skill is installed, and (c) it has a
**connected social account on the platform that campaign requires**. If a prerequisite is
missing, the AI guides the operator: install skill → connect accounts → then join only the
campaigns whose platform they've connected.

## How Vello campaigns work today (grounding)

- `campaigns` table (`convex/campaigns.ts`): brand-created gigs with `brief`, `budget`,
  `ratePerThousandViews`, `targetNiche[]`, `targetLanguage[]`, `deadline`, `status`,
  `submissionsCount`. **No platform-requirement field today.**
- `submissions` table (`convex/submissions.ts`): one row per (campaign, influencerMint).
  `submit()` records `{campaignId, influencerMint, influencerName, submitterWallet, status:"pending"}`.
  **No post-link / platform field today.** Oracle later calls `markVerified()` →
  `computePayoutUsdc(views, ratePerThousandViews, budget)` → payout per 1k views.
- Posting: `social.uploadpost` skill → `lib/server/uploadPost.ts` (TikTok, Instagram,
  YouTube, Facebook, LinkedIn, X, Threads). Connect via hosted JWT page; post via
  `uploadText/uploadPhotos/uploadVideo`.
- AI capabilities are described in `INFLUENCER_SYSTEM_PROMPT` (`lib/builder/agentTypes.ts`):
  `search_campaigns`, `join_campaign`, `post_to_social`, `create_video`, `check_agent_wallet`.
  The chat route injects `AVAILABLE_CAMPAIGNS`, `MY_SUBMISSIONS`, `SOCIAL_SKILL_INSTALLED`,
  `CONNECTED_SOCIALS` context. The client `executeInfluencerActions` runs the actions.
- Generations tab (`AgentWorkspace.tsx` `GenerationsPanel`) renders succeeded `agentTasks`.
  It does **not** query `submissions` yet.

This is the same model as jobtepi-web content-rewards: brand funds a budget, creators post
to a platform, submit the post link, an oracle measures views, payout is per-1k-views from
the budget.

## Data model changes (additive, optional — no breaking migration)

`campaigns` (`convex/schema.ts` + `campaigns.create`):
- `platforms?: v.array(v.string())` — platform ids this campaign accepts (e.g. `["tiktok","instagram"]`).
  Absent/empty ⇒ any connected platform is acceptable.

`submissions` (`convex/schema.ts` + `submissions.submit` + new mutation):
- `platform?: v.string()` — the platform the deliverable was posted to.
- `postUrl?: v.string()` — the live link of the post (the "submission link").
- status vocabulary: `"pending"` (joined, not yet posted) → `"submitted"` (post link attached)
  → `"verified"`/`"approved"`/`"rejected"` (oracle, unchanged).
- New `submissions.setPostLink({submissionId, postUrl, platform})` — attaches the link and
  flips status `pending → submitted`. Idempotent-safe.

## Skill catalog entry (`lib/builder/skillsCatalog.ts`)

Add to `INFLUENCER_SKILLS_CATALOG`:
- `id: "vello.campaigns"`, name **"Vello Campaigns"**, category `"distribution"`,
  `recommendedFor: ["influencer"]`, `requires: []` (native to Vello), small per-use price.
- A **long `markdownTemplate`** (the instructional skill doc): explains the campaign model,
  the hard dependency on Social Auto-Post, the connect flow, platform-matching, and the
  exact join → produce → post → submit-link → verify → payout lifecycle, plus etiquette and
  failure handling. Written to `agentSkillFiles` on install (existing mechanism).

## Gating logic (the heart of the request)

Enforced in BOTH the prompt (so the AI guides correctly) and the client executor (hard gate,
so it can't misfire even if the model slips):

```
join_campaign(campaignId):
  if !installed("vello.campaigns")      → guide: install Vello Campaigns skill first.
  if !installed("social.uploadpost")    → guide: install Social Auto-Post skill first.
  connected = CONNECTED_SOCIALS (live from upload-post)
  if connected.length == 0              → guide: open Connections, link an account.
  required = campaign.platforms ?? []   // empty = any
  eligible = required.length ? required ∩ connected : connected
  if eligible.length == 0               → tell operator: connect one of [required] to join this campaign.
  else                                  → join + post to eligible[0] + attach link.
```

The chat route adds, per campaign in `AVAILABLE_CAMPAIGNS`, a `platforms=[...]` field and a
`JOINABLE`/`NEEDS:<platform>` marker computed against `CONNECTED_SOCIALS`, plus a
`CAMPAIGNS_SKILL_INSTALLED: true|false` line. The prompt instructs: only emit `join_campaign`
for `JOINABLE` campaigns; otherwise guide install/connect.

## Participation flow (client `executeInfluencerActions`)

`join_campaign` becomes the full participation step:
1. Run the gate above; on any failure, push a guiding chat message (with the exact next step)
   and stop — **no spend, no submission**.
2. `submitToCampaign` → create the submission (status `pending`).
3. Produce the deliverable (reuse the agent's voice; text/photo/video per campaign type) and
   **post** it to the eligible platform via the existing `post_to_social` path.
4. Extract the live post URL from the upload-post result; if present, call `setPostLink`
   (status → `submitted`). If the platform didn't return a URL, ask the operator to paste the
   link and record it via `setPostLink`.
5. Confirm in chat and surface it in Generations.

`search_campaigns` stays, but the list now annotates each campaign with its platform
requirement and whether it's joinable given connected accounts.

## Generations tab (`AgentWorkspace.tsx`)

Add a **Campaigns** section to `GenerationsPanel`, fed by a reactive
`useQuery(api.submissions.listByInfluencer, { influencerMint })`. Each row:
`brand · title · platform · status badge · [View post] link (postUrl) · payout (if verified)`.
This is independent of `agentTasks`, so joined campaigns show even though the post itself is
also an agentTask.

## Error handling

- Missing skill / connection / platform → guiding message, never a silent spend.
- Duplicate join → `submit` already throws "Already submitted"; surface "already joined".
- Post fails → submission stays `pending`; tell operator, offer retry; don't fake a link.
- upload-post returns no URL → prompt operator to paste it; `setPostLink` records it.

## Out of scope

- Brand-side campaign-creation UI for `platforms` beyond adding the optional field (the field
  is wired through `create`; surfacing a picker in the campaign form is a follow-up).
- Changing the oracle/payout math (`computePayoutUsdc` already correct).
- View-count tracking (oracle owns it).

## Testing

- Unit: gating helper (skill+connection+platform → eligible[] / guidance reason).
- Convex: `submissions.submit` with platform/postUrl, `setPostLink` status transition.
- Manual: install Vello Campaigns without social skill → AI guides to install; install social,
  no connections → guides to connect; connect TikTok → only TikTok-requiring (or any) campaigns
  are joinable; join → post → link attached → appears in Generations with the post link.
