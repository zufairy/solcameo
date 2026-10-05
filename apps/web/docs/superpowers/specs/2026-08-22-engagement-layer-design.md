# Engagement Layer — Design Spec

**Date:** 2026-08-22
**Problem:** Vello agents post autonomously but never engage. Post-only accounts lose reach, look automated, and carry silent shadowban risk. This spec makes accounts genuinely engaged and active.
**Current stack:** Next.js `app/api/social/*` → **upload-post.com** aggregator; Convex (`agentAutonomy`, `agentTasks`, `autoClip`, `clipJobs`, `analytics`); oracle view-scraping.

---

## 0. The finding that shapes everything

**There is no public API for replying to comments on a purely organic TikTok video.** The Content Posting API exposes only `allow_comment: true/false` at post creation. The Research API is read-only and restricted to approved academics. Our current provider reflects this: upload-post's comment endpoints are **Instagram-only** (`docs/api/instagram-comments.md`, `platform: "instagram"`).

**But there is one sanctioned path, and it is worth taking: Spark Ads.**

Verified against the live docs (`business-api.tiktok.com/portal/docs/reply-to-a-comment/v1.3`, read 2026-08-22). The Business API's comment suite — **Get comments · Get related comments · Reply to a comment · Delete · Update status · Export** — lives under **Ad Comments** and requires `advertiser_id` **and `ad_id`**:

```
POST https://business-api.tiktok.com/open_api/v1.3/comment/post/
{ advertiser_id, ad_id, tiktok_item_id, comment_id,
  comment_type: "REPLY", text, identity_type, identity_id }
```

> "For TikTok ads created by users linked to TikTok User or Custom User identities (`identity_type = TT_USER | CUSTOMIZED_USER`), users linked to these identity types who have comment management permissions can reply to first-level comments under the ads."

**Spark Ads promote an existing organic post as an ad while keeping all engagement on the original organic video.** So the moment a post is running as a Spark Ad it has an `ad_id`, and programmatic comment replies become available on that post — legitimately, through the official API.

This solves two problems with one mechanism: it unlocks automated replies **and** it buys distribution, which is the actual cause of low views (see §0.1).

Also available and unused by us: **Mentions API** (reply to comments mentioning our handle) and the **Business Messaging API** (DMs with automated replies).

### 0.1 Read this before building replies to fix reach

**Comments are downstream of views, not upstream.** A video with 200 views has roughly zero comments. Auto-replying to them changes nothing, because there is nothing to reply to. Comment replies extend a post that is *already* being tested and distributed; they cannot rescue a post that never got distribution.

If clips are getting no views, the cause is — in order — completion rate and hook quality, cold account with no history, unengaged followers acting as a negative pre-filter, duplicate content across the fleet, or unlabelled AI. Not the absence of replies. Build §8 (generator) and §5 (health monitor) before expecting §3 to move reach.

### The design decision — three tiers

| Tier | Mechanism | Automation |
|---|---|---|
| **A** | **Spark Ads** on posts worth amplifying | Full API: read + reply |
| **B** | Licensed partner (Sprout Social, Sprinklr, Later — all carry TikTok comment management under partner-level access) | Full, but rented and priced per seat |
| **C** | Purely organic posts | Reply Desk, one-tap human |

**Default to C, promote winners into A.** A post that is performing is exactly the post worth putting $5–10/day behind — which is also the post whose comments are worth replying to. The two decisions collapse into one trigger.

This is not a compromise — it is a better product, for three reasons:

1. It keeps the human-review promise that already differentiates the managed offer.
2. In the managed model we post to the **client's existing account** — already warm, real followers, real history — so the cold-start and warm-up problem largely disappears. The client replying to their own commenters is normal behaviour, not simulated behaviour.
3. For a real estate client a comment *is a lead*. Routing it to them is worth more than the retainer. Comment handling becomes a billable feature instead of an algorithmic chore.

### What we explicitly will not build

No fingerprint spoofing, residential-proxy-per-account rotation, emulator farms, engagement pods, follow/unfollow loops, or simulated consumption to fake account trust. Reasons, in order of how much they should matter to us:

- In the managed business these run on **client-owned accounts**. A ban doesn't cost us a test account, it ends the client relationship and the company's reputation in a small, gossipy niche.
- It is an arms race against a detection team with more resources than us, where losing is retroactive and silent.
- Undisclosed automation and undisclosed AI are two of the three biggest 2026 shadowban triggers. We would be building our product out of the failure modes.

---

## 1. Component 0 — AIGC labelling (ship first, ~1 line)

**Highest risk-to-effort ratio in this document.** TikTok issues an *immediate strike* for unlabelled AI content — no warning — escalating warning → 7-day posting restriction → 30-day suspension → permanent ban. The label itself is **not** a negative ranking factor; labelled AI content performs close to comparable organic.

upload-post already supports it: **`is_aigc` (boolean)** on the TikTok upload payload.

**Implement:**

- Render pipeline sets `syntheticFace | voiceClone | aiBackground | aiProductImage` flags on the asset record.
- `app/api/social/post/route.ts` derives `is_aigc = any(flags)` and always sends it explicitly.
- Default **on** for all UGC-creator-agent output. Clipping real footage of a real person is normally `false`.
- Persist the determination and the reason on the post row for audit.

Do this before anything else in this spec.

---

## 2. Component 1 — Comment ingest, per-platform reality

| Platform | Read comments | Reply | Path |
|---|---|---|---|
| Instagram | ✅ upload-post | ✅ public reply + private DM | fully automated |
| YouTube | ✅ Data API | ✅ Data API | fully automated |
| X | ✅ API | ✅ API | fully automated |
| Facebook | ✅ Graph API | ✅ Graph API | fully automated |
| **TikTok — Spark Ad** | ✅ Business API | ✅ Business API | **fully automated** |
| **TikTok — organic** | ❌ none | ❌ none | **assisted (Reply Desk)** |

TikTok is the only split case. Build the automated loop for everything that supports it; organic TikTok routes through the Reply Desk until a post is promoted, at which point it moves to the automated path.

**Spark Ads promotion trigger (§5 supplies the data):** when a post clears ~2× the account's median views@24h, auto-nominate it for promotion. Operator approves a daily budget, the post becomes a Spark Ad, and its `ad_id` is written to the post row — which flips its comments from Reply Desk to fully automated. One trigger, two wins: paid distribution on a proven post, and automated replies on the post that actually has comments.

**Convex schema — `postComments`:**

```
postComments
  platform          "tiktok" | "instagram" | "youtube" | "x" | "facebook"
  agentId           Id<"agents">
  clientId?         Id<"clients">
  postId            string        // platform post id
  commentId?        string        // null for TikTok (manually captured)
  authorHandle      string
  text              string
  postedAt          number
  ingestedAt        number
  intent            "question" | "lead" | "compliment" | "objection" | "spam"
  draftReply?       string
  status            "new" | "drafted" | "approved" | "sent" | "skipped"
  sentAt?           number
  idemKey           string        // platform+commentId, dedup
```

Index on `by_status_platform` and `by_client_postedAt`.

---

## 3. Component 2 — The Reply Desk

**Why speed is the whole point:** the FYP tests a post on a small cohort and expands based on interaction. Replies land inside that window or they don't count. Target **draft ready within 10 minutes** of a comment appearing.

**Flow:**

1. **Poll** — cron every 5–10 min per active post for the first 48h, then hourly to 7 days. (Instagram private replies have a hard 7-day comment window.)
2. **Classify** — existing LLM infra. Intent enum above. Spam is dropped silently.
3. **Draft** — generate in the agent's voice using the existing **persona / show-bible** infrastructure. That system already exists; this is a new consumer of it, not new capability.
4. **Policy gate** — before any reply is sent or surfaced: no pricing claims, no performance guarantees, no personal data, no legal/financial/medical advice, length cap. Reject and re-draft on violation.
5. **Dispatch:**
   - *Automated platforms* → post the reply directly, honouring per-client auto-reply settings.
   - *TikTok* → push to the Reply Desk.

**The Reply Desk (mobile web, one screen):** comment, drafted reply, `Copy & open TikTok` deep link, and Skip. The client (or our delivery hire) taps through their queue in two minutes a day. Log `sent` when they confirm.

**Default posture per client:** managed clients start at **approve-then-send** on every platform. Auto-send is opt-in per client, never the default — this is their brand.

---

## 4. Component 3 — Lead router (the billable half)

The commercial reason this layer exists.

- Intent `lead` → immediate SMS/email to the client with the comment, the post, and a drafted response.
- For real estate: a buyer or vendor enquiry under a listing clip is worth more than the monthly retainer. Surface it in under five minutes.
- Weekly report gains a **"leads surfaced"** line. That number, not view counts, is what renews the contract and justifies the A$1,800–2,400 tier in `PATH_TO_10K_MRR.md`.

---

## 5. Component 4 — Reach health monitor

Shadowbans are silent; metrics drop with no notification. Detect it ourselves.

- Extend `analytics.ts` / `oracle/scrape-views`: per-account rolling baseline of **views@24h** and **engagement rate**, trailing 20 posts, median not mean.
- **Trigger:** 5 consecutive posts below ~40% of baseline → state `throttled`.
- **Action:** auto-pause posting for that account 48–72h, alert the operator, surface the likely trigger (recent duplicate, unlabelled AI, cadence spike). Recovery reportedly begins 48–96h after the trigger is removed.
- Never silently keep posting into a throttle — that burns a client month and we find out at the monthly call.

---

## 6. Component 5 — Originality guard (fleet cascade protection)

The existential one for the fleet model: near-identical videos across accounts trigger an originality penalty, and a trigger on one account can crater reach on every account sharing infrastructure.

**Pre-post check, blocking:**

- Perceptual hash (pHash) over N keyframes.
- Audio fingerprint.
- Caption/hook embedding cosine similarity.
- Compare against everything posted by **any agent in the fleet** in a trailing window (start at 30 days).
- Similarity over threshold → block and regenerate with a different hook/edit, don't just reword the caption.

Note this forces *actual* content variation. It is not an evasion technique; it is the thing that makes a fleet legitimate rather than a duplication farm.

---

## 7. Component 6 — Account eligibility gate (don't fake warm-up)

Warmed accounts sustain materially higher reach than cold ones, and the standard warm-up is 14–21 days of consumption-first activity. **We gate on this rather than simulate it.**

Account state machine: `unverified → eligible → active → throttled → paused`.

`eligible` requires: account age over a threshold, existing organic post history, a real follower base, and OAuth connected.

- **Managed clients pass automatically** — their account is genuinely real and warm. This is the model's biggest structural advantage and the main reason managed beats fleet on algorithmic risk.
- **House/fleet accounts** must be operated by a human for the warm-up period before an agent takes over posting. We do not automate consumption to manufacture trust.

---

## 8. Component 7 — Generator changes

The 2026 ranking data says shares, saves and rewatches outweigh likes, and that videos are tested on a small cohort then expanded on completion and meaningful interaction. Encode that in the generator (the hook-style controls landed 2026-08-21 are the hook for this):

- Optimise for completion and rewatch: loop-friendly cuts, payoff inside 3s, no dead tail.
- Bias hooks toward save/share intent over like intent.
- End captions on an answerable question — it generates the comments that feed §3, which is the flywheel: better hooks → more comments → faster replies → longer test window → more reach.

---

## 9. Provider risk — verify and hedge

Everything above sits on upload-post. Two actions:

1. **Confirm upload-post publishes to TikTok via the official Content Posting API with per-creator OAuth**, not unofficial automation. If it doesn't, every account we touch is exposed and this is a P0.
2. **Start our own TikTok Content Posting API audit now.** It is a manual review, typically **2–6 weeks**, and until it passes every direct post is forced to `SELF_ONLY`. It is the longest lead time in this document — starting it in November is starting it too late. Required: registered developer app, Content Posting API product added, correct scopes, per-creator OAuth, and the commercial-content disclosure toggle in our UX.

---

## 10. Build order

| # | Component | Effort | Why this order |
|---|---|---|---|
| 1 | **AIGC flag** (§1) | ~1 hour | Removes an immediate-strike-to-permanent-ban risk for one line of code |
| 2 | **Generator: completion + hook** (§8) | medium | **This is what fixes low views.** Credits spent into a poor completion rate are the actual waste; no reply system recovers them |
| 3 | **Reach health monitor** (§5) | small | Uses existing analytics; stops us burning client months blind, and supplies the Spark Ads promotion trigger |
| 4 | **Comment ingest + Reply Desk** (§2–3) | medium | Instagram/YouTube/X automated + TikTok assisted |
| 5 | **Spark Ads + Business API comment loop** (§0) | medium | Unlocks full TikTok automation on promoted posts; do it after §3 exists to pick winners |
| 6 | **Lead router** (§4) | small | Turns the layer into revenue; needed before the A$1,800 tier |
| 7 | **Account eligibility gate** (§7) | small | Cheap insurance, mostly a no-op for managed clients |
| 8 | **Originality guard** (§6) | medium | Only urgent once more than one account runs similar source material |
| — | **TikTok API audit** (§9) | 2–6 wks wall-clock | Start immediately, runs in parallel with everything above |

---

## 11. Success criteria

- Zero unlabelled AI posts.
- Median time from comment posted → reply drafted under 10 minutes.
- Every throttled account detected by the monitor before the client notices.
- Zero duplicate-content blocks reaching a platform.
- "Leads surfaced" appears on every weekly client report inside 30 days.
