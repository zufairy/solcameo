# Mach — Developer Role & Build Scope (Statement of Work)

**Role:** Founding Full-Stack / Solana Engineer
**Compensation:** USD $3,000 / month
**Engagement:** Full-time (contractor) · remote · reports to Founder
**Mission:** Build Mach — the platform where anyone launches an AI influencer/clipper agent that creates videos, posts them, and earns from a marketplace, with payments settled on Solana.

> This document defines what you'll build, in what order, and how we'll judge it done. It's the single source of truth for the role. The compensation/legal terms in §9 should be put into a short contractor agreement (lawyer-reviewed) — this SOW is the work scope that agreement points to.

---

## 1. What Mach is (so the build makes sense)

Mach lets a user **describe an AI creator** (persona, the kind of videos, posting schedule, budget) and the platform builds an agent that **generates short videos, posts them across TikTok/Reels/Shorts/X, and earns money** — either from the owner's own brand or from clients in a **marketplace** who pay per video or monthly. The agent runs on a **budget wallet**; payments and payouts settle in **USDC on Solana** with on-chain verification of delivered work. Focus is the **influencer + clipper** vertical only. (Trading agents and third-party investment are explicitly out of scope for now — see §11.)

---

## 2. The role in one line

You are the **first engineer**. You own the full stack — the web app, the agent infrastructure, the builder, and the Solana settlement layer — and ship a working V1 that real users can use to launch an earning agent. Pragmatism over perfection; ship, measure, iterate.

---

## 3. What you'll build — the four pillars

### Pillar A — The Web App (the product surface)
- Auth, onboarding, user dashboard (Next.js + TypeScript).
- The **Builder UI**: a user describes an agent in plain language and/or via forms — persona (name, tone, language, look), video types/formats, posting sequence, posting volume, and budget.
- The **Agent dashboard**: live status, content calendar, views/engagement, earnings, wallet balance.
- The **Marketplace UI**: clients browse/search agents, post jobs, pay per-video or monthly; owners manage incoming jobs.

### Pillar B — Agent Infrastructure (the engine)
- The **agent runtime**: a scheduled loop per agent that (1) checks budget, (2) generates content, (3) posts to platforms, (4) records results, (5) learns/optimizes.
- **Content generation pipeline**: integrate video-gen APIs (e.g. Seedance / Veo / Kling), voice, captions, and the clipper (one long video → many clips). Keep providers swappable behind one interface.
- **Distribution pipeline**: post to TikTok / Instagram Reels / YouTube Shorts / X via their content APIs, with per-platform reformatting and scheduling.
- **Persistence & memory**: store every agent action, post, and result; feed performance data back so the agent improves (the learning loop — our moat).
- **Job queue / workers**: reliable background processing (the repo already has a worker app pattern to follow).

### Pillar C — The Builder (no-code agent creation)
- Translate a user's description + form inputs into a stored **agent configuration** (persona, skills, schedule, budget rules).
- Sensible templates per niche so a user can launch in minutes.
- Sandbox/preview so the user sees sample output before going live.

### Pillar D — Solana Settlement Layer (the money)
- **Agent budget wallet** (Solana PDA / program-controlled) holding USDC for operating spend and earnings.
- **Marketplace payments**: client pays → escrow → work delivered & verified → payout released. Splits between owner, agent costs, and Mach's platform fee (~15–17%).
- **On-chain records** of payments, verified deliverables, and payouts for transparency.
- **Hybrid settlement** (standard pattern): on-chain USDC balance + off-chain compute credits, since on-chain wallets can't directly pay Web2 APIs — sweep/replenish periodically, log flows on-chain.
- Anchor program(s) for escrow + payout logic; security-first.

---

## 4. Technical stack (use the existing repo conventions)

| Layer | Tech |
|---|---|
| Frontend | Next.js 14+ (App Router), TypeScript, Tailwind |
| Backend / DB / Auth | Supabase (Postgres + Auth + Storage) and/or Convex (per existing app) |
| Background jobs | Worker service (follow the existing worker app pattern) |
| On-chain | Solana, Anchor (Rust), USDC, Phantom wallet |
| AI / media | Video-gen APIs (Seedance/Veo/Kling), TTS/voice, captioning — behind a provider-agnostic interface |
| Social posting | TikTok, Instagram Graph, YouTube, X content APIs |
| Validation | Zod for API validation; RLS on all tables |

Reuse what already exists in the monorepo (auth, Supabase clients, worker pattern, Solana scaffolding) rather than rebuilding.

---

## 5. Milestones & deliverables (the build sequence)

> One engineer covering app + AI infra + Solana is a large surface. We sequence deliberately: prove the core loop first, add the marketplace, then the money layer. Each milestone is a usable checkpoint.

### Milestone 1 — Core loop MVP (Weeks 1–6)
- Auth + onboarding + Builder UI (describe → agent config saved).
- Agent runtime that generates and posts to **one** platform (e.g. TikTok) on a schedule.
- Budget wallet (off-chain credit balance first), content + results stored, basic agent dashboard.
- **Done = a user can describe an agent and it posts real videos automatically.**

### Milestone 2 — Multi-platform + learning (Weeks 7–12)
- Posting to 3–4 platforms with reformatting + optimal-time scheduling.
- The clipper (long video → many clips).
- Performance tracking + the self-optimization feedback loop (agent learns what performs).
- **Done = an agent runs a real content operation across platforms and improves.**

### Milestone 3 — Marketplace + Solana settlement (Weeks 13–20)
- Marketplace: client posts a job, pays per-video or monthly, agent delivers, work verified.
- Solana: agent USDC wallet, escrow + payout program, platform-fee split, on-chain records.
- Payouts to owners (USDC / fiat off-ramp).
- **Done = a client can pay, an agent can earn, and money settles on-chain.**

### Milestone 4 — Hardening & scale (Weeks 21–24+)
- Reliability (retries, monitoring), security review of the Anchor program, fraud/bot-view checks, AI content labeling/compliance, cost controls.
- **Done = the platform is stable enough for real users and a grant/VC demo.**

*Timeline is a target, not a contract — we adjust as we learn. Quality and a working demo at each milestone beat hitting arbitrary dates.*

---

## 6. Day-to-day responsibilities

- Build, test, and ship features across the stack.
- Integrate and maintain third-party APIs (video-gen, social platforms, payments).
- Write and audit the Solana/Anchor programs handling real money — security is non-negotiable.
- Keep a deployable main branch; basic CI; document setup and architecture decisions.
- Short daily async update (what shipped, what's next, blockers) + a weekly demo of working software.

## 7. Skills required

- Strong **TypeScript + Next.js** full-stack.
- **Solana / Anchor (Rust)** — can write and deploy a secure escrow/payout program.
- Comfortable wiring **third-party APIs** and background job systems.
- Postgres/Supabase (or Convex), auth, RLS.
- Bonus: experience with AI/media pipelines or social-platform APIs.
- Founder mindset: ships pragmatically, owns problems end-to-end, communicates clearly.

## 8. Success metrics (how we judge the work)

- Milestones delivered as working, demoable software.
- A user can go **describe → deploy → first auto-post** with no manual help.
- An agent can complete a **paid marketplace job that settles on-chain.**
- Uptime/reliability of the agent runtime (target 95%+ once live).
- Clean, secure handling of funds (zero loss-of-funds incidents; Anchor program reviewed before mainnet).

---

## 9. Terms & logistics

| Item | Detail |
|---|---|
| Compensation | **USD $3,000 / month** |
| Engagement | Full-time contractor, remote |
| Hours | Full-time; flexible, async-friendly; ~weekly demo cadence |
| Payment | Monthly, in arrears (USDC or bank — agree method) |
| Probation / trial | First **1 month** as a paid trial; continue by mutual agreement on Milestone-1 progress |
| Equipment & accounts | Developer provides own machine; company provides API keys, test funds, repo access |
| IP ownership | **All code, designs, and work product are the exclusive property of the company.** Assigned on creation. |
| Confidentiality | NDA; no sharing of code, keys, or strategy |
| Termination | Either side with reasonable written notice (define in contract, e.g. 2 weeks) |
| Equity (optional) | If offered, specify separately (e.g. small founding-engineer grant with vesting) |

> Put §9 into a short, locally-valid contractor agreement and have it lawyer-reviewed before signing. This SOW becomes the "Scope of Work" exhibit it references.

## 10. Working expectations

- **Security-first** with anything touching wallets/funds — keys in a secrets manager, never in code; least-privilege; test on devnet before mainnet.
- Pragmatic code quality: readable, typed, validated (Zod), RLS on data. Ship over gold-plate, but no shortcuts on money or auth.
- Communicate blockers early; a weekly working demo is the heartbeat.

## 11. Out of scope (do NOT build now)

- **Third-party investment / “invest in an agent” feature** — deferred (securities risk); only the owner's own budget wallet + optional platform growth-credits.
- **AI Trader / trading agents** — roadmap vertical, not V1.
- **Native mobile apps**, SDK/developer platform, token launch — all later.
- Anything outside the influencer/clipper core loop + marketplace + Solana settlement.

## 12. Acceptance criteria (definition of done for V1)

1. A user can describe an agent in the Builder and it deploys.
2. The agent autonomously generates and posts videos across multiple platforms on schedule, within budget.
3. The agent's performance is tracked and feeds back into its optimization.
4. A client can hire an agent in the marketplace (per-video or monthly), the work is delivered and verified, and **payment settles in USDC on Solana** with the platform fee split correctly.
5. Owner can withdraw earnings. System is stable enough for a live demo.

---

*Mach — Developer Role & Build Scope. Pairs with the product/market docs in this folder. Scope and timeline are a working plan; the compensation terms in §9 require a separate, locally-valid, lawyer-reviewed contractor agreement.*
