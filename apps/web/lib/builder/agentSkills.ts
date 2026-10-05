export interface SkillDef {
  id: string;
  label: string;
  desc: string;
  tags: string[];
  /** Long, detailed operating guide (markdown) that tells the agent how to run this skill. */
  instructions?: string;
}

/**
 * Build a rich default operating guide for ANY skill from its label/desc/tags —
 * so a skill is never an empty shell even before the operator edits it.
 */
export function buildSkillGuide(skill: { label: string; desc: string; tags?: string[] }): string {
  const tags = (skill.tags ?? []).join(", ");
  return `## ${skill.label} — operating guide

**Mission:** ${skill.desc}.

**When to use:** whenever the task or conversation touches ${tags || "this skill's domain"} — recognise the trigger and apply this skill before acting.

**Playbook (step by step):**
1. Read the situation — what does the user / audience actually want right now? Gather the missing context first; never assume.
2. Apply the skill's craft to produce a concrete output (a plan, copy, post, brief, or decision) — specific, on-brand, and actionable. No generic filler.
3. Ground every claim in the agent's knowledge base, memories, and persona — cite real facts, never invent stats.
4. End with the single clear next step.

**Inputs to gather:** persona + niche, the goal, any relevant docs/knowledge, and recent results (what already worked / failed).

**Output quality bar:** if a stranger couldn't act on it immediately, it isn't done. Be sharp, specific, and in the agent's voice.

**Tags:** ${tags || "—"}`;
}

// Per-niche skill pools — 4 skills each
const NICHE_SKILL_POOL: Record<string, SkillDef[]> = {
  lifestyle: [
    { id: "sk-aesthetic",   label: "Aesthetic Curator",      desc: "Craft cohesive visual identity across platforms",         tags: ["aesthetics", "branding", "visual"] },
    { id: "sk-ritual",      label: "Daily Ritual Builder",   desc: "Turn routines into aspirational viral content series",    tags: ["routine", "content", "habits"] },
    { id: "sk-community",   label: "Community Magnet",       desc: "Build loyal aspirational audience communities",           tags: ["community", "growth"] },
    { id: "sk-trend",       label: "Trend Forecaster",       desc: "Identify and ride emerging lifestyle micro-trends",       tags: ["trends", "timing", "viral"] },
  ],
  tech: [
    { id: "sk-explain",     label: "Concept Simplifier",     desc: "Break complex tech into digestible storytelling",         tags: ["education", "clarity", "tech"] },
    { id: "sk-review",      label: "Product Reviewer",       desc: "Deep-dive product analysis with credibility signals",     tags: ["reviews", "trust", "authority"] },
    { id: "sk-builder",     label: "Build-in-Public Coach",  desc: "Document creator journey from idea to shipped product",   tags: ["bip", "product", "transparency"] },
    { id: "sk-thread",      label: "Thread Engineer",        desc: "Convert insights into high-performing X/Twitter threads", tags: ["threads", "twitter", "virality"] },
  ],
  fashion: [
    { id: "sk-ootd",        label: "Outfit Architect",       desc: "Compose daily OOTD with styling narrative hooks",         tags: ["ootd", "styling", "fashion"] },
    { id: "sk-haul",        label: "Haul Storyteller",       desc: "Transform shopping into entertaining discovery content",  tags: ["haul", "shopping", "entertainment"] },
    { id: "sk-collab",      label: "Brand Collab Strategist",desc: "Position influencer for premium fashion brand deals",     tags: ["collabs", "brands", "deals"] },
    { id: "sk-trend-set",   label: "Trend Setter",           desc: "Pioneer micro-trends before they hit mass market",        tags: ["trends", "innovation", "fashion"] },
  ],
  fitness: [
    { id: "sk-transform",   label: "Transformation Architect",desc: "Document body transformation journeys authentically",   tags: ["transformation", "fitness", "progress"] },
    { id: "sk-workout",     label: "Workout Programmer",     desc: "Create and distribute effective workout content",         tags: ["workout", "programming", "fitness"] },
    { id: "sk-nutrition",   label: "Nutrition Communicator", desc: "Simplify nutrition science into actionable meal content", tags: ["nutrition", "food", "health"] },
    { id: "sk-challenge",   label: "Challenge Designer",     desc: "Engineer viral fitness challenges for audience activation",tags: ["challenge", "viral", "engagement"] },
  ],
  food: [
    { id: "sk-recipe",      label: "Recipe Developer",       desc: "Create original recipes optimised for visual content",    tags: ["recipe", "food", "creativity"] },
    { id: "sk-restaurant",  label: "Restaurant Storyteller", desc: "Build narrative-rich restaurant review experiences",      tags: ["restaurants", "review", "food"] },
    { id: "sk-taste",       label: "Taste Educator",         desc: "Teach food culture with approachable storytelling",      tags: ["education", "culture", "food"] },
    { id: "sk-asmr",        label: "ASMR Food Engineer",     desc: "Produce high-retention food ASMR and satisfying content",tags: ["asmr", "video", "food"] },
  ],
  travel: [
    { id: "sk-itinerary",   label: "Itinerary Designer",     desc: "Craft must-do travel plans with insider local tips",     tags: ["travel", "planning", "itinerary"] },
    { id: "sk-budget",      label: "Budget Travel Hacker",   desc: "Unlock premium experiences on minimal budgets",          tags: ["budget", "travel", "hacks"] },
    { id: "sk-culture",     label: "Culture Immersionist",   desc: "Deep cultural immersion storytelling for global audiences",tags: ["culture", "travel", "storytelling"] },
    { id: "sk-vlog",        label: "Travel Vlog Director",   desc: "Cinematic travel storytelling across YouTube and Reels", tags: ["vlog", "video", "travel"] },
  ],
  finance: [
    { id: "sk-wealth",      label: "Wealth Educator",        desc: "Demystify personal finance for everyday audiences",       tags: ["finance", "education", "wealth"] },
    { id: "sk-invest",      label: "Investment Decoder",     desc: "Break down market moves into actionable insights",        tags: ["investing", "markets", "analysis"] },
    { id: "sk-crypto",      label: "Crypto Narrator",        desc: "Translate on-chain data into compelling content",         tags: ["crypto", "web3", "defi"] },
    { id: "sk-freedom",     label: "Financial Freedom Coach",desc: "Inspire audiences toward early financial independence",   tags: ["fire", "freedom", "motivation"] },
  ],
  gaming: [
    { id: "sk-meta",        label: "Meta Analyst",           desc: "Decode game meta changes into viral competitive content", tags: ["meta", "strategy", "gaming"] },
    { id: "sk-lore",        label: "Lore Storyteller",       desc: "Deep lore breakdowns that hook casual and hardcore fans", tags: ["lore", "story", "gaming"] },
    { id: "sk-clip",        label: "Clip Engineer",          desc: "Identify and amplify the most shareable gameplay moments",tags: ["clips", "viral", "gaming"] },
    { id: "sk-community-g", label: "Gaming Community Lead",  desc: "Build clan culture and cross-platform community systems", tags: ["community", "gaming", "growth"] },
  ],
};

// Per-voiceArchetype modifier skills (appended on top of niche base)
const ARCHETYPE_SKILL: Record<string, SkillDef> = {
  mentor:       { id: "sk-arch-mentor",    label: "Mentor Mode",         desc: "Step-by-step teaching frameworks that build long-term trust",   tags: ["mentoring", "education", "trust"] },
  entertainer:  { id: "sk-arch-entertain", label: "Entertainment Engine",desc: "Hook-driven storytelling that maximises watch time and shares",  tags: ["entertainment", "hooks", "retention"] },
  expert:       { id: "sk-arch-expert",    label: "Authority Amplifier", desc: "Position as go-to expert through data-backed deep-dives",       tags: ["authority", "expertise", "credibility"] },
  friend:       { id: "sk-arch-friend",    label: "Relatable Connector", desc: "Authentic vulnerability storytelling that drives deep parasocial bonds", tags: ["relatability", "authenticity", "connection"] },
  provocateur:  { id: "sk-arch-provoke",   label: "Controversy Catalyst",desc: "Craft edgy takes that spark debate and maximise impressions",    tags: ["controversy", "debate", "virality"] },
  storyteller:  { id: "sk-arch-story",     label: "Narrative Weaver",    desc: "Long-form story arcs that transform followers into loyal fans",  tags: ["storytelling", "narrative", "retention"] },
  comedian:     { id: "sk-arch-comedy",    label: "Comedy Timing",       desc: "Inject humour into every format for maximum shareability",       tags: ["comedy", "humour", "engagement"] },
  activist:     { id: "sk-arch-activist",  label: "Movement Builder",    desc: "Rally audiences around causes that align with brand values",     tags: ["activism", "movement", "impact"] },
};

// ── Detailed operating guides for the core builder skills ────────────────────

const G_READER = `## Situation Reader — operating guide

**Mission:** In 2 questions or fewer, figure out what the user ACTUALLY needs, then adapt tone + plan in real time.

**Listen for the 5 signals:**
1. **Traffic source** — paid ads, organic social, SEO, referrals, or nothing yet.
2. **Monetization stage** — pre-revenue, first sales, scaling, or established.
3. **Urgency** — "launching next week" vs "just exploring".
4. **Content library** — do they already have long-form (podcast / YouTube / webinars / VODs) to clip, or do they need fresh UGC created?
5. **Goal** — views & reach, signups, sales, or community.

**Playbook:**
- Open with ONE sharp routing question, never a generic "how can I help?". Example: "Do you already have long-form content we can clip, or are we creating fresh short-form?"
- Mirror their language and energy: a founder in a hurry gets crisp bullets; a creator exploring gets warmth.
- Detect intent shifts mid-conversation and re-route (e.g. they came for "growth" but really need a "first offer").

**Output:** a one-line read — who they are + what they need + the single next step.

**Quality bar:** if you can't name their goal + stage in one sentence, you haven't read the situation yet — ask again.`;

const G_CAMPAIGN = `## Campaign Selector — operating guide

**Mission:** Recommend the right Vello campaign primitive — **UGC** vs **Clipping** — with a clear reason, never both vaguely.

**Decision rule:**
- **Clipping** when they ALREADY have long-form assets: podcasts, long YouTube videos, webinars, course recordings, Twitch VODs, interview banks. Clippers chop these into 20–50 short-form clips and get paid per 1k views on approved clips.
- **UGC** when they have little/no long-form: creators film fresh short-form content about the brand; pay per 1k views or per approved post.
- If unsure, ASK: "Do you maintain a podcast, long YouTube, webinars, or VOD library?"

**Always check platform capability** (\`platformCaps.clipping_campaign\`): if clipping is off, never prescribe clipping — steer to UGC.

**Output:** the chosen primitive + a one-sentence why grounded in their assets, plus a starter bounty rate and the source assets / deliverables needed.

**Quality bar:** the recommendation must be defensible from what they actually have — no guessing.`;

const G_COMMUNITY = `## Community Architect — operating guide

**Mission:** Design the audience promise, member outcome, onboarding loop, and proof points. Every community must have a sharp who / why / join-now angle — never generic.

**Design the 4 pillars:**
1. **Audience promise** — one sentence: who it's for + the transformation. ("For early Solana founders shipping their first product.")
2. **Member outcome** — the concrete result a member gets (skill, network, revenue, status).
3. **Onboarding loop** — the first 3 steps a new member takes in their first 10 minutes (greet → quick win → next action).
4. **Proof points** — testimonials, results, named members, or numbers that make joining a no-brainer NOW.

**Naming:** derive the community name from the brand's real positioning (e.g. "Drift Founders Circle"), never placeholders like "Your Community".

**Output:** name + promise + outcome + onboarding loop + 3 proof points.

**Quality bar:** a stranger should understand who it's for and why to join now in under 10 seconds.`;

const G_OFFER = `## Offer Designer — operating guide

**Mission:** Turn the brand's website positioning into a flagship product (membership, course, service, drop, or campaign-linked offer) with outcome-first, immediately-purchasable copy.

**Playbook:**
1. Read the website / brand context: what they sell, who for, their voice, price range.
2. Choose ONE flagship format that fits their stage (membership for community, course for expertise, service for done-for-you, drop for scarcity).
3. Write outcome-first copy: lead with the transformation, not the features. ("Ship your first Solana app in 30 days" beats "12 video modules".)
4. Make it purchasable: name, headline, 1-paragraph description, 3–5 outcome bullets, a price idea, and a clear CTA.

**Inputs:** website hero copy, audience, niche, price range.

**Output:** a launch-ready product (name, headline, description, features, price idea).

**Quality bar:** never generic — every line must be specific to THIS brand and immediately sellable.`;

const G_VIRAL = `## Viral Growth Planner — operating guide

**Mission:** Author creator briefs with hook, body, CTA, deliverables, and the 3-second visual — optimised for remixability and short-form density.

**Every brief contains:**
1. **Hook** (≤3s) — the scroll-stopping first line + the visual that earns the watch.
2. **Body** — the value/story beats, dense and fast (no filler seconds).
3. **CTA** — the single action (follow, comment, link, code).
4. **Deliverables** — format, length, platform, count.
5. **3-second visual** — exactly what's on screen at second 0.

**Hook engineering:** open on tension, a bold claim, a result, or a pattern-break. Make it remixable so other creators can riff on it.

**Inputs:** the campaign angle, the brand's transformation, the target platform's norms.

**Output:** a brief a creator can shoot from today, plus 3 hook variations to A/B.

**Quality bar:** if the first 3 seconds don't stop the scroll, the brief fails — rewrite the hook.`;

const G_REVENUE = `## Revenue Operator — operating guide

**Mission:** Keep the agent solvent and earning — manage the USDC treasury and activate Vello campaigns to bring money in.

**Playbook:**
1. **Know the balance** — check the agent's on-chain USDC + SOL before deciding. Status: healthy / low / empty.
2. **Burn awareness** — know the daily skill-burn rate and runway (days of operation left at current spend).
3. **Earn** — when runway is short, prioritise revenue: find matching Vello campaigns, create the deliverable, post it, and submit to earn payouts.
4. **Top-up** — when balance is low and no campaigns fit, recommend funding the wallet to cover ~30 days of burn.
5. **Treasury hygiene** — keep enough SOL for gas; don't let USDC sit idle when campaigns are available.

**Inputs:** live wallet balance, daily burn, open campaigns, recent earnings.

**Output:** a clear economic decision — earn / top-up / hold — with the specific next action and amount.

**Quality bar:** never claim "all good" without the actual balance + runway numbers.`;

// Universal fallback skill (always appended as 6th if no archetype match)
const REVENUE_SKILL: SkillDef = {
  id: "sk-revenue",
  label: "Revenue Operator",
  desc: "USDC treasury management and Vello campaign activation",
  tags: ["revenue", "treasury", "solana"],
  instructions: G_REVENUE,
};

export const DEFAULT_SKILLS: SkillDef[] = [
  { id: "sk-reader",    label: "Situation Reader",     desc: "Detect audience intent and adapt tone in real time",        tags: ["routing", "intent", "adaptation"], instructions: G_READER },
  { id: "sk-campaign",  label: "Campaign Selector",    desc: "UGC vs Clipping recommendation engine",                     tags: ["campaigns", "strategy"],          instructions: G_CAMPAIGN },
  { id: "sk-community", label: "Community Architect",  desc: "Audience promise & onboarding loop design",                 tags: ["community", "onboarding"],        instructions: G_COMMUNITY },
  { id: "sk-offer",     label: "Offer Designer",       desc: "Website → flagship product copy",                           tags: ["product", "copy"],               instructions: G_OFFER },
  { id: "sk-viral",     label: "Viral Growth Planner", desc: "Creator briefs & hook engineering",                         tags: ["viral", "hooks", "creators"],     instructions: G_VIRAL },
  REVENUE_SKILL,
];

/**
 * Returns 6 unique skill defs tailored to the agent's niche, voiceArchetype,
 * and (optionally) their content pillars. Falls back to a generic set.
 */
export function generateAgentSkills(persona?: {
  niche?: string;
  voiceArchetype?: string;
  contentPillars?: string[];
}): SkillDef[] {
  if (!persona?.niche) return DEFAULT_SKILLS;

  const niche = persona.niche.toLowerCase();
  const nichePool = NICHE_SKILL_POOL[niche] ?? NICHE_SKILL_POOL.lifestyle;

  // Take 4 niche skills
  const skills: SkillDef[] = [...nichePool.slice(0, 4)];

  // Add 1 archetype skill (or default revenue skill if no match)
  const archKey = persona.voiceArchetype?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  const archetypeSkill = ARCHETYPE_SKILL[archKey] ?? REVENUE_SKILL;
  skills.push(archetypeSkill);

  // 6th skill: content-pillar-derived if available, else fallback
  if (persona.contentPillars && persona.contentPillars.length > 0) {
    const pillar = persona.contentPillars[0];
    skills.push({
      id: `sk-pillar-${pillar.toLowerCase().slice(0, 12).replace(/\s+/g, "-")}`,
      label: `${pillar.slice(0, 20)} Specialist`,
      desc: `Deep content expertise in ${pillar} for maximum audience resonance`,
      tags: [pillar.toLowerCase().slice(0, 20), "specialization", "content"],
    });
  } else {
    skills.push({
      id: "sk-growth",
      label: "Audience Growth Engine",
      desc: "Data-driven follower growth and engagement rate optimisation",
      tags: ["growth", "analytics", "engagement"],
    });
  }

  return skills;
}
