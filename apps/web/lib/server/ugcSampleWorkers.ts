// UGC-Sample slot workers — shared by the generate route (all slots) and the
// retry route (ONE slot re-run, so a single failure never costs a full re-run).
// Each worker owns its slot's status writes and never throws.
//
// NODE-ONLY (ffmpeg/sharp downstream): import only from Node route handlers.
import type { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { generateVideoFromScript } from "@/lib/server/kie-video-pipeline";
import { getVideoEngine } from "@/lib/builder/agentTypes";
import { fetchSelf } from "@/lib/server/fetchInternal";
import { TRENDING_AUDIO } from "@/lib/server/trendingAudioPack";
import { putVideo } from "@/lib/server/videoStorage";

const UPDATE_SLOT = makeFunctionReference<"mutation">("ugcSampleRuns:updateSlot");

/** Burn the slide caption onto the image OURSELVES (sharp + SVG) instead of
 *  asking the image model to draw it. Model-drawn text was different on every
 *  slide (random fonts/placements, misspellings); this gives every slide the
 *  IDENTICAL simple IG-story style: one small semi-bold sans line group, white
 *  on a soft dark pill, lower third, centered. Returns a hosted URL (or the
 *  original on any failure — a caption must never kill a rendered slide). */
async function burnCaptionOnImage(imageUrl: string, caption: string, idx: number): Promise<string> {
  try {
    const text = caption.trim();
    if (!text) return imageUrl;
    const res = await fetch(imageUrl);
    if (!res.ok) return imageUrl;
    const src = Buffer.from(await res.arrayBuffer());
    const sharp = (await import("sharp")).default;
    const meta = await sharp(src).metadata();
    const W = meta.width ?? 1080;
    const H = meta.height ?? 1920;
    // Wrap into ≤ 22-char lines (IG-story sticker proportions at 9:16).
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > 22 && cur) { lines.push(cur); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 3);
    const fontSize = Math.round(W * 0.042);
    const lineH = Math.round(fontSize * 1.35);
    const padX = Math.round(fontSize * 0.7);
    const padY = Math.round(fontSize * 0.45);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const widest = Math.max(...shown.map((l) => l.length));
    const pillW = Math.min(W - 40, Math.round(widest * fontSize * 0.58) + padX * 2);
    const pillH = shown.length * lineH + padY * 2;
    const pillX = Math.round((W - pillW) / 2);
    const pillY = Math.round(H * 0.72) - Math.round(pillH / 2);
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${Math.round(fontSize * 0.55)}" fill="rgba(0,0,0,0.45)"/>
  ${shown.map((l, i) => `<text x="${W / 2}" y="${pillY + padY + (i + 0.78) * lineH - Math.round(lineH * 0.25)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="${fontSize}" fill="#ffffff">${esc(l)}</text>`).join("\n  ")}
</svg>`;
    const out = await sharp(src).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    const { uploadRefToSupabase } = await import("@/lib/server/nftKie");
    const hosted = await uploadRefToSupabase(out.toString("base64"), "image/png", 3000 + idx);
    return hosted ?? imageUrl;
  } catch (e) {
    console.warn(`[ugc-sample] caption burn failed (keeping raw slide): ${e instanceof Error ? e.message : e}`);
    return imageUrl;
  }
}

export type ClientType = "physical" | "app" | "service";
export interface UgcConcept { format: "reaction" | "cartoon" | "review"; title: string; idea: string; hookText: string }

export const SLOT_DEFS: Record<UgcConcept["format"], { label: string; engineId: string; durationSeconds: number }> = {
  reaction: { label: "Reaction + Text", engineId: "grok-imagine-15", durationSeconds: 8 },
  cartoon: { label: "Anime Soft-Sell", engineId: "seedance-1-5-pro", durationSeconds: 20 },
  review: { label: "Realistic Review", engineId: "gemini-omni", durationSeconds: 10 },
};

export const CLIENT_GUIDE: Record<ClientType, { script: string; visual: string }> = {
  physical: {
    script: "PHYSICAL PRODUCT: the presenter physically has it — write lines that reference holding, touching, using, unboxing it. Concrete tactile details beat abstract claims.",
    visual: "the presenter HOLDS and uses the actual physical product on camera — reproduce it FAITHFULLY from the attached product image (same shape, packaging, colors, logo); the product is clearly visible in-hand in the key moments",
  },
  app: {
    script: "APP / SOFTWARE: the star is what's ON SCREEN — write lines that react to the real UI, a specific screen or feature, what it does for the user.",
    visual: "the app's real interface (from the attached website screenshot) shown on a phone or laptop screen the presenter looks at / points at / taps — never invent a fake UI",
  },
  service: {
    script: "SERVICE / SHOP: sell the experience and the outcome — before/after, the moment it pays off, how it feels to use it.",
    visual: "show the experience and the outcome — the website (attached screenshot) may appear on a screen as the way in; keep everything grounded in the site's real branding",
  },
};

/** Language nuance — Malay must be Malaysian colloquial, never Indonesian;
 *  Manglish is Malaysian English (English base, Malay particles mixed in). */
function languageRule(language: string): string {
  if (/manglish/i.test(language)) {
    return ` MANGLISH RULE: this is Malaysian English — ENGLISH sentences the way Malaysians actually speak, naturally mixed with Malay particles and words: "lah", "lor", "kan", "meh", "sia", "walao", "eh", "damn nice", "confirm", "can or not", "why so susah", "tak payah lah". English carries the meaning; the Malay seasoning carries the vibe. It must sound like a KL/PJ twenty-something voice-noting a friend — NEVER textbook English, NEVER full Malay sentences, NEVER forced (one or two particles per sentence max, where a Malaysian would truly put them).`;
  }
  if (/malay|melayu/i.test(language) && !/indones/i.test(language)) {
    return ` MALAY RULE: this is MALAYSIAN Malay (Bahasa Melayu Malaysia), colloquial daily speech — natural Malaysian phrasing and particles (lah, kan, je, "nak", "macam mana", "korang", "best gila"). ABSOLUTELY NO Indonesian vocabulary or spelling (never "mau", "bagaimana", "kalian", "banget", "gak", "aja", "bisa" in the Indonesian sense). It must read like a Malaysian texting a friend — simple, very understandable, no formal textbook Malay.`;
  }
  return "";
}

function scriptSystem(format: UgcConcept["format"], durationSeconds: number, clientType: ClientType, language: string): string {
  const base = `You write short-form UGC video scripts. Respond ONLY JSON: {"hook": string, "script": string}. "script" is what is SAID (or narrated) — natural spoken words sized to ~${durationSeconds} seconds (~${Math.round(durationSeconds * 2.3)} words max). LANGUAGE: write the hook AND every spoken line entirely in ${language} (natural native phrasing, not a translation).${languageRule(language)}
CLIENT REPUTATION RULE (this is a REAL client's brand — an off-sounding sample loses them): everything must be realistic, logical, and true to the product. Never describe the product doing something it doesn't do, never a fantasy version of it, never a claim the context doesn't back. TRUST RULE: only claim things present in the provided product context. Never invent stats, prices, discounts, or guarantees.
VOICE REALISM: write lines a real human can SAY with natural intonation — vary sentence length, put the stress where a person would ("this. actually. works" beats a flat clause), allow tiny spoken imperfections ("okay so", a mid-thought restart), end on a falling or rising tone that matches the emotion. If it reads like ad copy or a robot, rewrite it.
CLIENT TYPE — ${CLIENT_GUIDE[clientType].script}`;
  if (format === "reaction") {
    return `${base}\nFormat: a 6-8s multi-cut candid reaction clip. ZERO hard sell — this works by REVERSE PSYCHOLOGY: the on-screen text is an OBSERVER's dry, understated remark about someone casually doing the hard thing with the product ("she really just did that on her phone", "not sure how that's even allowed" energy) — it never addresses the viewer, never pitches, never says a feature name like an ad. The viewer should feel like they walked in on something, not like they were sold to.
"hook" = that observer text (max 8 words, lowercase-leaning, deadpan, specific to what THIS product actually does — pull the "hard thing done casually" from the context).
"script" = OPTIONAL. Best versions are often silent (ambient room sound + her reaction carries it) — then return "". If a line genuinely helps, ONE short muttered half-to-herself remark (never a pitch, never "you guys have to try this"). Decide based on the product: visual products → silent; abstract products → one murmured line.`;
  }
  if (format === "cartoon") {
    return `${base}\nFormat: a ~20s ANIME mini-episode with synced narration, rendered as TWO stitched 10s clips — so the script MUST be written as TWO clean ACTs of roughly equal spoken length, and NO sentence may straddle the midpoint (the cut lands exactly between them).
ACT 1 (0-10s, "the struggle"): cold-open on a NAMED character ALREADY mid-problem (no setup narration — drop us in). The problem is the REAL problem this product solves, made physical and visual (papers avalanche, clock spinning, phone buzzing swarm). Two beats: the problem, then it gets comically WORSE. End Act 1 on the low point — a beat of silence, the character deflated. Cliff, not resolution.
ACT 2 (10-20s, "the turn"): the discovery — the character finds/uses ONE real feature from the context, and the world visibly flips (the avalanche folds itself away, the swarm becomes one calm card). Then the payoff: a small human moment showing what they DO with the win (closes the laptop, actually watches the sunset), plus ONE light closing line — ideally a callback to something from Act 1.
STORY CRAFT: give the character a one-word want (sleep, quiet, time). Concrete nouns over abstractions. The product is the turning point, never the hero — the character's relief is the hero.
VIRAL PLOT RULE (reverse-engineer the business): from the product context, find the single most DRAMATIC before/after this business enables — the transformation a customer would actually brag about. Act 1 is the worst believable day of that "before" (so relatable it hurts); Act 2 is that exact "after". One transformation, played big — never a feature tour.
CONTINUITY RULE: both acts are the SAME scene continued — same named character, same location (it can transform, never teleport), Act 2 picks up the exact moment Act 1 ends. Write Act 2's first beat as a direct physical continuation of Act 1's last beat.
VOICEOVER CRAFT: warm, expressive narrator with an emotional arc — sympathy (Act 1) → a smile you can hear on the turn → quiet delight (payoff). Short performable sentences with natural pauses. No monotone list-reading, no ad-speak. The narration must land the story even with the screen off.`;
  }
  return `${base}\nFormat: a 10s hyper-realistic selfie review, talking straight to camera. First person, genuinely human: casual phrasing, small imperfections ("okay so", "honestly"), ONE concrete specific detail from the product context. Zero ad-speak, no superlatives you can't back up.`;
}

// Both stories are POV reverse-psychology, modeled on the reference style:
// "pov you just saw a creator in the cafe open vello and start a whole campaign
//  from scratch. no lighting rigs. no camera crew. no script drafts. no editing
//  team. literally just them clicking buttons like a maniac. not sure how they
//  actually pull that off"
// — you're WATCHING someone else casually do the impossible with the product;
// the product is never pitched, the observer just can't explain what they saw.
export const STORY_DIRECTIONS: Record<"story-fomo" | "story-emotional", string> = {
  "story-fomo": `SARCASTIC POV (reverse psychology): the reader is watching a STRANGER casually use the product in a mundane place (cafe, bus, kitchen table) and do something that should be hard. Structure: "pov you just saw/watched <someone> <do the hard thing with the product>." → then a dry list of everything that SHOULD have been needed but wasn't ("no X. no Y. no Z." — pull the X/Y/Z from what the product genuinely replaces per the context) → one deadpan closing aside that undersells it ("not sure how they actually pull that off" energy). Never address the product to the reader, never pitch — the observer is mildly annoyed/impressed, that's the whole sell.`,
  "story-emotional": `EMOTIONAL POV (reverse psychology, DIFFERENT audience than the sarcastic one): the reader is watching someone they care about (their mum, their tired friend, the person who almost quit) quietly succeed with the product. Structure: "pov you <caught/watched> <them> <doing the thing>" → 2-3 small observed details that show the REAL benefit changed something (from the product context — no invented details) → one soft understated closer ("she didn't even ask anyone for help" energy). Warm, quiet, zero ad-speak — the feeling sells it, not a pitch.`,
};

export interface UgcSlotCtx {
  convex: ConvexHttpClient;
  runId: string;
  /** For fetchSelf's public-origin fallback candidates. */
  req?: NextRequest;
  websiteUrl: string;
  productContext: string;
  clientType: ClientType;
  language: string;
  /** Kie-safe presenter photo (normalized), original as last resort. */
  normalizedPhotoUrl: string;
  /** Kie-safe (normalized) — "" when absent/dropped. */
  screenshotUrl: string;
  productImageUrl: string;
  /** Vision-ranked product references (best first, ≤3, Kie-normalized). ALL of
   *  them ride every image/video generation so the model sees the product from
   *  multiple views (physical) / real UI screens (app). */
  productImageUrls?: string[];
}

function slotWriter(ctx: UgcSlotCtx, index: number) {
  return (patch: Record<string, unknown>) =>
    ctx.convex.mutation(UPDATE_SLOT, { runId: ctx.runId, index, authSecret: process.env.INTERNAL_CRON_SECRET ?? "", ...patch }).catch((e) =>
      console.error(`[ugc-sample] slot ${index} status write failed: ${e instanceof Error ? e.message : e}`));
}

/** Multi-clip stitcher for the render pipeline (Seedance frame-chain, Veo
 *  stitch-fallback): concat via the local ffmpeg route (loopback-first fetch),
 *  host the joined file on Convex storage. Without this, a 20s Seedance render
 *  (2 chained clips) silently returned ONLY the first clip. */
function makeStitcher(ctx: UgcSlotCtx) {
  return async (clipUrls: string[], opts?: { crossfadeSeconds?: number; trimSeconds?: number; headTrimSeconds?: number }): Promise<string> => {
    const res = await fetchSelf("/api/video/concat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({ clipUrls, crossfadeSeconds: opts?.crossfadeSeconds, trimSeconds: opts?.trimSeconds, headTrimSeconds: opts?.headTrimSeconds }),
    }, ctx.req);
    if (!res.ok) throw new Error(`concat HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const bytes = await res.arrayBuffer();
    const { url } = await putVideo(bytes, { keyPrefix: "videos" });
    return url;
  };
}

/** Engine result URLs live on the provider's temp storage (tempfile.aiquickdraw
 *  expires, a dead Convex deployment 400s forever) — every URL saved to a slot
 *  must first be copied to R2. The overlay-burn route already returns durable
 *  URLs; this guards the burn-skipped/burn-failed fallback path, which used to
 *  persist the raw temp URL and rot the history. On copy failure the temp URL
 *  is still returned — a video that plays today beats a failed slot. */
async function ensureDurableVideoUrl(url: string): Promise<string> {
  const publicBase = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (publicBase && url.startsWith(publicBase)) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const { url: durable } = await putVideo(await res.arrayBuffer(), { keyPrefix: "renders" });
    return durable;
  } catch (e) {
    console.warn(`[ugc-sample] could not persist video to durable storage (${e instanceof Error ? e.message : e}) — keeping temp URL`);
    return url;
  }
}

async function burnOverlay(ctx: UgcSlotCtx, body: Record<string, unknown>): Promise<{ ok?: boolean; videoUrl?: string; captionsApplied?: boolean; error?: string }> {
  const res = await fetchSelf("/api/video/overlay-burn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
    },
    body: JSON.stringify(body),
  }, ctx.req);
  return (await res.json().catch(() => ({}))) as { ok?: boolean; videoUrl?: string; error?: string };
}

// ── Video concept slots (reaction / cartoon / review) ───────────────────────
export async function runConceptSlot(ctx: UgcSlotCtx, index: number, concept: UgcConcept): Promise<void> {
  const def = SLOT_DEFS[concept.format];
  const engine = getVideoEngine(def.engineId as Parameters<typeof getVideoEngine>[0]);
  const setSlot = slotWriter(ctx, index);
  try {
    await setSlot({ status: "scripting", error: "" });
    const scripted = await callClaudeJSON<{ hook?: string; script?: string }>({
      system: scriptSystem(concept.format, def.durationSeconds, ctx.clientType, ctx.language),
      user: `${ctx.productContext}\n\nCONCEPT TO EXECUTE: ${concept.title} — ${concept.idea}${concept.hookText ? `\nON-SCREEN HOOK TEXT: ${concept.hookText}` : ""}`,
      maxTokens: 600,
    });
    let hook = String(scripted.hook ?? concept.hookText ?? "").trim().slice(0, 120) || concept.title;
    const script = String(scripted.script ?? "").trim();

    // REVIEW HOOK REFINE: the review's burned hook only shows for the first 2
    // seconds now, so it has to be a genuinely scroll-stopping line, grounded
    // in what the video actually SAYS (the script is the transcript) and in
    // the product — never a generic teaser. One Claude pass writes candidates
    // and self-selects the best; the operator's run selections (language,
    // client type) shape the voice. Best-effort: failure keeps the draft hook.
    // REACTION HOOK REFINE: the observer text IS the whole sell (the clip is
    // near-silent), so it must be genuinely viral reverse psychology — a dry
    // bystander remark about someone casually doing the impossible thing,
    // NAMING the actual product/service so the brand registers without a
    // pitch. Candidates + self-select; failure keeps the draft hook.
    if (concept.format === "reaction") {
      try {
        const refined = await callClaudeJSON<{ candidates?: string[]; best?: string }>({
          system: `You write the burned-on OBSERVER TEXT for candid "caught on camera" reaction videos (the TikTok reverse-psychology format). Respond ONLY JSON: {"candidates": string[], "best": string}. Write 5 candidates, then copy the single strongest into "best".
THE FORMAT: the viewer is watching a stranger casually do something that should be hard. The text is a BYSTANDER'S dry, understated remark about what they're witnessing — never addressed to the viewer, never a pitch, never ad-speak, no exclamation marks, no emojis, no hashtags.
RULES: max 10 words, lowercase-leaning, deadpan ("she really just did that on her phone" / "not sure how that's even allowed" energy), in ${ctx.language} (natural native phrasing${languageRule(ctx.language)}).
NAME RULE: the remark must NAME the product/service (its actual name or unmistakable service, from the context below) as the thing being casually used — that's how the brand registers without selling.
VIRAL RULE: anchor on the SPECIFIC hard thing this product makes casual (pull it from the context — the thing that normally needs a team/hours/money, done alone in seconds). Specific beats clever. TRUST RULE: only what the context supports.`,
          user: `PRODUCT CONTEXT (from ${ctx.websiteUrl}):\n${ctx.productContext.slice(0, 1500)}\n\nCONCEPT BEING FILMED: ${concept.title} — ${concept.idea}\n\nDRAFT HOOK TO BEAT: ${hook}`,
          maxTokens: 400,
        });
        const best = String(refined.best ?? "").trim().slice(0, 90);
        if (best.split(/\s+/).length >= 3) {
          hook = best;
          console.log(`[ugc-sample] reaction hook refined: "${best}"`);
        }
      } catch (e) {
        console.warn(`[ugc-sample] reaction hook refine skipped: ${e instanceof Error ? e.message : e}`);
      }
    }

    if (concept.format === "review" && script) {
      try {
        const refined = await callClaudeJSON<{ candidates?: string[]; best?: string }>({
          system: `You write on-screen HOOK text for short-form product review videos (the 1-line sticker at the top of the video). Respond ONLY JSON: {"candidates": string[], "best": string}. Write 5 candidates, then copy the single strongest one into "best".
RULES: max 8 words each, lowercase-leaning, in ${ctx.language} (natural native phrasing${languageRule(ctx.language)}). The hook must be SPECIFIC to this product and to what the speaker actually says in the transcript — pull the most surprising/concrete claim or moment from it. It shows for only the FIRST 2 SECONDS, so it must stop the scroll instantly: curiosity gap, bold specific claim, or relatable pain — never generic ("you need this", "wait for it"), never clickbait the transcript can't back. TRUST RULE: only claim what the transcript/context supports.`,
          user: `PRODUCT CONTEXT:\n${ctx.productContext.slice(0, 1500)}\n\nVIDEO TRANSCRIPT (what the reviewer says):\n${script}`,
          maxTokens: 400,
        });
        const best = String(refined.best ?? "").trim().slice(0, 80);
        if (best.split(/\s+/).length >= 2) {
          hook = best;
          console.log(`[ugc-sample] review hook refined: "${best}"`);
        }
      } catch (e) {
        console.warn(`[ugc-sample] review hook refine skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    // The reaction format may legitimately return NO spoken line (a silent
    // candid reaction + the observer text carries it — the strongest
    // reverse-psychology version). Every other format needs its script.
    if (!script && concept.format !== "reaction") throw new Error("script pass returned empty");
    await setSlot({ status: "rendering", script: script || `(silent) ${hook}` });

    const { screenshotUrl, productImageUrl, normalizedPhotoUrl, clientType } = ctx;
    // ALL ranked product refs + the site screenshot ride the render as visual
    // references — one image was routinely ambiguous ("can't see the product").
    const rankedProductRefs = ctx.productImageUrls?.length ? ctx.productImageUrls : [productImageUrl].filter(Boolean);
    const productRefs = [...new Set([...rankedProductRefs, screenshotUrl])].filter(Boolean);
    const shared = {
      agentName: "Sample Presenter",
      agentNiche: "product reviews",
      noPersona: true as const,
      language: ctx.language,
      topic: `${concept.title} — sample for ${ctx.websiteUrl}`,
      hook,
      scriptText: script,
      durationSeconds: def.durationSeconds,
      aspectRatio: "9:16",
      videoModel: engine.kieModel,
      campaignContext: ctx.productContext,
      ...(productImageUrl ? { productImageUrl } : {}),
      ...(productRefs.length ? { campaignImageUrls: productRefs } : {}),
      // Rides every storyboard + clip prompt (ordersBlock). This is a REAL
      // client's product — fidelity and realism are the whole pitch.
      standingOrders: [
        "PRODUCT ORIGINALITY — NON-NEGOTIABLE: the product/brand/UI must be reproduced EXACTLY from the attached reference images — same shape, packaging, colors, logo, screens. Never redesign, restyle, invent features, or show a 'concept' version. If a detail isn't visible in the references, keep it neutral/out of focus rather than inventing it.",
        "REALISM: every moment must be physically logical and believable — real hands, real physics, real screens showing real UI. Nothing uncanny, nothing impossible, no AI-artifact weirdness (extra fingers, morphing objects, gibberish text).",
        "VOICE: the spoken audio must sound like a REAL person — natural intonation with rises and falls, emphasis on the words that matter, small breaths and pauses, emotion matching the moment. Never flat, never text-to-speech monotone, never announcer-y.",
      ].join("\n"),
      stitchClips: makeStitcher(ctx),
      timeBudgetMs: 540_000,
    };
    const result = await generateVideoFromScript(
      concept.format === "reaction"
        ? {
            ...shared,
            avatarUrl: normalizedPhotoUrl,
            ...(screenshotUrl ? { productImageUrl: screenshotUrl } : {}),
            // Silent when the script pass decided no line helps — ambient room
            // sound + her reaction carry it; the burned observer text sells.
            speech: script ? "on_camera" : "silent",
            // No model-rendered text: the hook is burned by US after the render
            // (one consistent design) — asking the model too produced doubled /
            // misspelled on-frame text.
            creativeBrief: {
              format: "6-8s candid multi-cut reaction (2-3 quick jump cuts, like someone trimmed their own phone clips)",
              angle: `REVERSE PSYCHOLOGY, ZERO SELL: she is caught mid-moment casually doing the impressive thing with the product — absorbed in it, NOT presenting it. She never addresses the camera, never points at features like a demo, never performs excitement. Beats across the cuts: (1) candid mid-action glance, (2) the product moment seen naturally over her shoulder / in her hand (${CLIENT_GUIDE[clientType].visual}), (3) a small real reaction — an eyebrow raise, a half smile, a slow "huh". The burned observer text does the selling; the footage just looks like real life; ${concept.idea}`,
              topic: concept.idea,
              visualTreatment: "vertical phone footage that looks self-shot then roughly trimmed: 2-3 HARD INSTANT jump cuts — frame changes in a single frame like a real TikTok edit. ABSOLUTELY NO fades, no dissolves, no cross-fades, no morphing between shots, no transition effects of any kind. Slightly different framing each cut, natural mixed light, imperfect off-center composition, mild handshake, a real lived-in room — NOTHING staged, NOTHING that reads as an ad or a presenter setup",
            },
          }
        : concept.format === "cartoon"
          ? {
              ...shared,
              avatarUrl: productImageUrl || screenshotUrl || normalizedPhotoUrl,
              // Seedance's lead input IS the literal opening frame — leading
              // with the product photo / website screenshot opened every anime
              // on a photograph. Lead with the anime STORYBOARD instead (or go
              // pure text-to-video when no storyboard rendered); the product
              // photo still rides as a trailing reference so it's drawn
              // faithfully IN the anime style.
              seedanceLead: "storyboard" as const,
              speech: "voiceover",
              aesthetic: "premium modern anime (Ghibli-meets-late-night-TV-anime): clean confident line art, soft cel shading with two-tone shadows, painterly detailed backgrounds with depth, expressive large-eye character acting, cinematic key lighting, studio-quality 2D animation — never stiff, never generic flat cartoon",
              creativeBrief: {
                format: "20s anime mini-episode in two 10s acts (struggle → turn), stitched at exactly the act break",
                angle: `an anime short whose conflict IS the real problem this product solves; the product's actual feature is the turning point — soft sell, the story carries it; ${CLIENT_GUIDE[clientType].visual}`,
                topic: concept.idea,
                visualTreatment: [
                  "ONE consistent character model in EVERY shot — same face, hair, outfit, proportions across both acts (treat the first shot as the model sheet)",
                  "ACT 1 look: slightly desaturated cool palette, cluttered oppressive framing, comic exaggeration of the problem (object avalanches, spiral eyes, sweat drops, drooping posture)",
                  "ACT 2 look: the palette warms and opens up on the turn — golden light, cleaner compositions, the character visibly breathes",
                  "MOTION: real anime cinematography, not slideshow pans — dynamic push-ins on reactions, whip-pans on the escalation, an impact freeze-frame with speed lines at the low point, a slow dolly-out on the payoff; characters ACT with their whole body (head tilts, shoulder slumps, the double-take on discovery)",
                  "the product drawn faithfully from its reference image, recognizable in the anime style",
                  "never photorealistic, never western-cartoon flat, no mouth-flap-only stillness — something moves in every shot",
                ].join("; "),
              },
            }
          : {
              ...shared,
              avatarUrl: normalizedPhotoUrl,
              speech: "on_camera",
              creativeBrief: {
                format: "10s selfie-style talking-head review",
                angle: `genuine humanized first-person review grounded ONLY in the site's real claims; ${CLIENT_GUIDE[clientType].visual}`,
                topic: concept.idea,
                visualTreatment: "handheld selfie realism: constant subtle camera shake and micro-jitter, one small push-in zoom mid-clip, brief autofocus hunt/refocus blur at the start, slightly tilted off-center framing that drifts — NEVER a locked-off tripod shot. Environment: a lived-in, cluttered, ASYMMETRICAL real room (things half out of frame, imperfect background) — never a clean symmetrical studio or staged set. Natural mixed lighting with imperfect white balance — indistinguishable from a real creator's phone video",
              },
            },
    );
    if (!result.videoUrl) throw new Error(result.videoError || "engine returned no video");

    // Reaction clips get burned captions (line mode, white + black outline).
    // Transcription-based first (word-synced, same engine as the AI Clipper);
    // if the clip's audio transcribes to nothing (short/quiet Grok takes do
    // this), fall back to burning the SPOKEN LINE as static text so the video
    // always carries its caption.
    let finalUrl = result.videoUrl;
    // EVERY concept slot burns captions + the auto text hook in ONE overlay-burn
    // pass. Captions are transcription-synced when the audio transcribes;
    // `scriptText` makes them GUARANTEED — when STT yields nothing (quiet/short
    // takes, STT outages: the exact reason captions "weren't showing") the burn
    // route synthesizes evenly-timed words from the known script. Per-format
    // caption style + hook design; the hook is our burn, never left to the video
    // model's unreliable in-frame text.
    // Trending-audio bed on EVERY slot — a random SHORT track (root of the pack,
    // never the long "podcast" beds) whose mood fits the format: reaction = a
    // funny/viral sting, anime = emotional score, review = hype/energy. Mixed
    // UNDER the voiceover; the burn route clamps it to the clip length (its
    // graph runs -shortest). Loudness: talking formats keep it low (a bed, not
    // a fight with the voice), the reaction is speech-light so it sits higher.
    // Reaction: a funny/viral sting can sit up (speech-light). Review: casual
    // INSTRUMENTAL bed — the "chill" pool (lo-fi/instrumental trending beds),
    // low under the spoken review. Anime: emotional score.
    const wantMoodByFormat: Record<UgcConcept["format"], string> = { reaction: "funny", cartoon: "emotional", review: "chill" };
    const shortTracks = TRENDING_AUDIO.filter((t) => !t.folder);
    // The review's casual INSTRUMENTAL beds (lo-fi etc.) live in the "podcast"
    // folder — long, but the burn clamps audio to the clip (-shortest), so they
    // work as a 10s bed. Other formats keep the short-tracks-only pool.
    const trackSource = concept.format === "review" ? TRENDING_AUDIO : shortTracks;
    const moodPool = trackSource.filter((t) => t.mood === wantMoodByFormat[concept.format]);
    const musicPool = moodPool.length ? moodPool : shortTracks;
    const musicTrack = musicPool.length ? musicPool[Math.floor(Math.random() * musicPool.length)] : undefined;
    const burnSpec: Record<string, unknown> = {
      videoUrl: result.videoUrl,
      // "Shot on a phone" grain/vignette pass on the LIVE-ACTION formats (the
      // Grok reaction + the Gemini Omni review) — kills the too-clean AI sheen.
      // The anime episode stays clean (grain fights cel shading).
      ...(concept.format !== "cartoon" ? { phoneLook: true } : {}),
      ...(musicTrack ? { music: { trackId: musicTrack.id, volumePct: concept.format === "reaction" ? 65 : 35 } } : {}),
      // Captions: the anime narration + the spoken review get word-synced
      // captions. The REACTION never does — its observer text hook carries it,
      // captions over a candid clip read as clutter.
      ...(script && concept.format !== "reaction" ? {
        captions: concept.format === "cartoon"
          // Anime: playful rounded karaoke ("bounce" — the anime-subtitle look).
          ? { mode: "karaoke", preset: "bounce", fontSize: 46, position: "bottom", scriptText: script }
          // Review: clean word-synced karaoke, white, bottom.
          : { mode: "karaoke", preset: "karaoke", fontColor: "#ffffff", fontSize: 44, position: "bottom", scriptText: script },
      } : {}),
      hookText: concept.format === "review"
        // Review: the IG-story sticker look — lowercase white text on a SOLID
        // BLACK rounded box, rounded modern sans, no outline. (Reference: the
        // "wow," sticker style — box does the contrast work, not an outline.)
        ? {
            text: hook.toLowerCase(),
            position: "top",
            font: "jakarta",
            fontColor: "#ffffff",
            boxColor: "#000000",
            outlineWidth: 0,
            // Smaller + pinned near the very top (yPct) so the sticker never
            // covers the presenter's face — the "top" band alone sat too low.
            fontSize: 44,
            yPct: 6,
            // First 2 seconds only — the hook stops the scroll, then gets out
            // of the way of the spoken review + captions.
            durationSeconds: 2,
          }
        : concept.format === "cartoon"
          // Anime: soft rounded sticker — Poppins (friendly geometric, the
          // anime-subtitle look) in white on a solid black rounded box, no
          // harsh outline. (Bebas' tall condensed caps read aggressive and
          // off-style over cel shading.)
          ? {
              text: hook.toLowerCase(),
              position: "top",
              font: "poppins",
              fontColor: "#ffffff",
              boxColor: "#000000",
              outlineWidth: 0,
              fontSize: 54,
              durationSeconds: Math.min(4, def.durationSeconds),
            }
          : {
              text: hook,
              position: "top",
              font: "montserrat",
              fontColor: "#ffffff",
              outlineColor: "#000000",
              outlineWidth: 3,
              fontSize: 72,
              durationSeconds: Math.min(6, def.durationSeconds),
            },
    };
    try {
      const burned = await burnOverlay(ctx, burnSpec);
      if (burned.ok && typeof burned.videoUrl === "string" && /^https?:\/\//i.test(burned.videoUrl)) {
        finalUrl = burned.videoUrl;
        if (burnSpec.captions && !burned.captionsApplied) console.warn(`[ugc-sample] ${concept.format}: hook burned but captions unavailable`);
      } else {
        console.warn(`[ugc-sample] ${concept.format} overlay burn unavailable (${burned.error ?? "unknown"}) — using raw clip`);
      }
    } catch (e) {
      console.warn(`[ugc-sample] ${concept.format} overlay burn failed: ${e instanceof Error ? e.message : e} — using raw clip`);
    }
    await setSlot({ status: "done", videoUrl: await ensureDurableVideoUrl(finalUrl) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ugc-sample] slot ${concept.format} failed: ${msg}`);
    await setSlot({ status: "failed", error: msg.slice(0, 400) });
  }
}

// ── Text-story slots (stock clip + long burned overlay — zero render spend) ──
export async function runStorySlot(
  ctx: UgcSlotCtx,
  index: number,
  storyType: "story-fomo" | "story-emotional",
  stockUrl?: string,
): Promise<void> {
  const setSlot = slotWriter(ctx, index);
  try {
    let clip = stockUrl;
    if (!clip) {
      const { listStockClips, pickRandomClips } = await import("@/lib/server/stockClips");
      clip = pickRandomClips(await listStockClips(), 1)[0];
    }
    if (!clip) {
      throw new Error(`No stock clips found — upload short 9:16 .mp4 clips (reactions, people walking) to the Supabase storage bucket "vello-stock-clips" first.`);
    }
    await setSlot({ status: "scripting", error: "" });
    const out = await callClaudeJSON<{ story?: string }>({
      system: `You write the on-screen TEXT STORY for a short vertical video (the TikTok format where a text block sits over a clip and the viewer reads the whole thing while it plays). Respond ONLY JSON: {"story": string}. The story is 40-60 words, ONE continuous flowing block (NO line breaks — the renderer wraps it), all lowercase like a typed thought, starting with "pov". Short clipped sentences separated by periods. LANGUAGE: write it entirely in ${ctx.language}, natural native phrasing ("pov" stays "pov" — it's internet-universal).${languageRule(ctx.language)} It MUST be specifically about this product (the hard thing being done casually = the product's REAL capability from the context). TRUST RULE: only claim what the product context actually says. TONE — ${STORY_DIRECTIONS[storyType]}`,
      user: ctx.productContext,
      maxTokens: 400,
    });
    const story = String(out.story ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
    if (!story) throw new Error("story pass returned empty");
    await setSlot({ status: "rendering", script: story });
    // Audio bed: one of the SHORT clipping trending tracks (root of the pack —
    // the "podcast" folder holds the LONG beds, so it's excluded), mood-matched
    // to the story: sarcastic FOMO gets a funny/viral sting, emotional gets an
    // emotional track. There's no speech in these videos, so the track can sit
    // prominent. Resolved by id through the same overlay-burn music path the
    // clipper uses; if TRENDING_AUDIO_BASE_URL is unset the route logs + skips
    // music and the burn still succeeds.
    const wantMood = storyType === "story-fomo" ? "funny" : "emotional";
    const shortTracks = TRENDING_AUDIO.filter((t) => !t.folder);
    const moodPool = shortTracks.filter((t) => t.mood === wantMood);
    const trackPool = moodPool.length ? moodPool : shortTracks;
    const track = trackPool.length ? trackPool[Math.floor(Math.random() * trackPool.length)] : undefined;

    // Classic TikTok text-story look: big rounded bold sans (Poppins), white
    // with a solid black outline, centered tall stack — readable at arm's
    // length like a native TikTok text post. maxLines 14 (the burn route's
    // ceiling) + wrapDrawtext's auto-shrink guarantee the WHOLE story shows
    // (the old 200-char sanitize cap that cut stories mid-sentence is fixed
    // in clipFilterGraph.sanitizeText).
    const burned = await burnOverlay(ctx, {
      videoUrl: clip,
      hookText: {
        text: story,
        position: "center",
        font: "poppins",
        fontColor: "#ffffff",
        outlineColor: "#000000",
        outlineWidth: 3,
        fontSize: 54,
        maxLines: 14, // whole story as a tall centered stack — never ellipsis-cut
        durationSeconds: 15, // clamped to clip length; stock clips are short
      },
      ...(track ? { music: { trackId: track.id, volumePct: 80 } } : {}),
    });
    if (!burned.ok || !burned.videoUrl || !/^https?:\/\//i.test(burned.videoUrl)) {
      throw new Error(burned.error || "text overlay burn failed");
    }
    await setSlot({ status: "done", videoUrl: burned.videoUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ugc-sample] story slot ${index} failed: ${msg}`);
    // Context for the operator: which stage died + that retry is safe/cheap.
    const stage = /overlay|burn|ffmpeg|concat/i.test(msg) ? "text burn" : /Gemini|Claude|story pass/i.test(msg) ? "story writing (LLM)" : "setup";
    await setSlot({ status: "failed", error: `${stage} failed: ${msg.slice(0, 320)} — Retry re-runs just this card (text-only cost).` });
  }
}

// ── Carousel slot — a real user's photo-dump, 5 slides on nano-banana-2 ─────
// (Upgraded off the 1K Lite model: Lite's weak reference adherence was the
// "different girl in every slide" bug — the 2K model actually holds the face.)
// NOT a designed ad carousel: it reads like a girl's casual day-in-my-life
// photo dump. The PRESENTER PHOTO is the identity reference on EVERY slide (the
// same woman across her day); the product/brand appears naturally in exactly
// ONE slide (its refs attach only there). Small IG-story-style captions.
/** Resumable carousel progress, persisted as JSON in the slot's `concept`
 *  column (never rendered by the UI — the human-readable plan lives in
 *  `script`). Lets a retry after "did not finish in time" pick up EXACTLY
 *  where the previous run died: same slide plan (no second Claude call),
 *  already-rendered slides kept, and the in-flight KIE task re-polled instead
 *  of re-created — the credit-burning bug this exists to fix. */
interface CarouselResumeState {
  v: 1;
  slides: Array<{ text: string; visual: string; product: boolean; showsHer: boolean }>;
  caption: string;
  /** Raw (pre-caption-burn) slide URLs, by slide index. */
  raws: string[];
  /** Caption-burned slide URLs (what the slot's imageUrls shows). */
  burned: string[];
  /** KIE task created for slide `i` but not yet resolved when the run died. */
  pending?: { i: number; taskId: string } | null;
  /** Identity/continuity anchor (RAW url — a burned caption would ride into
   *  every later slide as a reference). */
  anchor?: { url: string; showsHer: boolean } | null;
}

function parseCarouselResume(concept: string | undefined): CarouselResumeState | null {
  if (!concept) return null;
  try {
    const s = JSON.parse(concept) as CarouselResumeState;
    if (s && s.v === 1 && Array.isArray(s.slides) && s.slides.length === 5 && Array.isArray(s.burned) && Array.isArray(s.raws)) return s;
  } catch { /* not resume JSON (legacy/other slot use) — fresh run */ }
  return null;
}

export async function runCarouselSlot(
  ctx: UgcSlotCtx,
  index: number,
  existing?: { concept?: string; imageUrls?: string[] },
): Promise<void> {
  const setSlot = slotWriter(ctx, index);
  const resumed = parseCarouselResume(existing?.concept);
  try {
    if (resumed) {
      await runCarouselSlides(ctx, index, resumed);
      return;
    }
    await setSlot({ status: "scripting", error: "" });
    const { clientType, language } = ctx;
    const plan = await callClaudeJSON<{ slides?: Array<{ text?: string; visual?: string; product?: boolean; shows?: string }>; caption?: string }>({
      system: `You plan a 5-slide "photo dump" carousel from the POV of a REAL USER of a product — her ordinary day, told like an IG story, where the product shows up naturally in exactly ONE slide. This must feel like a real person's camera roll, NOT a designed ad.
Respond ONLY JSON: {"slides": [{"text": string, "visual": string, "shows": "her"|"pov", "product": boolean}], "caption": string} with EXACTLY 5 slides and EXACTLY ONE slide where "product": true (put it at slide 3 or 4 — mid-dump, never first or last).
- The 5 slides tell ONE continuous small story arc from HER day (morning chaos → commute → the moment → little win → tired evening…) — every slide is a beat of THAT story, in order, and the day's friction is the thing the product actually helps with (from the context). Never 5 disconnected photos.
- "shows": a real photo dump MIXES both shot types — use "her" for 2-3 slides (a candid photo OF her mid-activity) and "pov" for the rest (what SHE sees/photographs: her cluttered desk, the coffee, the screen, the street, her hands doing the thing — she is NOT in frame, or only her hands). The mix is what makes it read like a camera roll.
- "text": her casual caption ON the photo — short, lowercase-leaning, diary/IG-story voice (≤10 words), in ${language}.${languageRule(language)} Real-person phrasing ("ok but why is 7am like this"), never marketing copy. Captions read in order like one story being told.
- "visual": what the photo shows, concrete and specific to the story beat — cluttered real places, imperfect angles, motion, real life. For the product slide: ${clientType === "physical" ? "the actual product mid-use (in her hands or on her table), reproduced faithfully from its reference image" : clientType === "app" ? "a phone with the app's REAL UI on screen (from the screenshot reference), mid-use in a real place" : "the moment the service/site is used — real place, the brand visible naturally (from the screenshot reference)"} — still candid, never a product shot on white.
- "caption": the post caption in ${language} — casual, no hashtags.
TRUST RULE: claims only from the provided context.`,
      user: ctx.productContext,
      maxTokens: 900,
    });
    const slides = (Array.isArray(plan.slides) ? plan.slides : [])
      .map((sl) => ({
        text: String(sl?.text ?? "").trim().slice(0, 120),
        visual: String(sl?.visual ?? "").trim().slice(0, 400),
        product: sl?.product === true,
        showsHer: String(sl?.shows ?? "her") !== "pov",
      }))
      .filter((sl) => sl.text && sl.visual)
      .slice(0, 5);
    if (slides.length < 5) throw new Error(`slide plan returned ${slides.length}/5 slides`);
    // At least ONE slide must show her — an all-POV plan has no identity anchor.
    if (!slides.some((sl) => sl.showsHer)) slides[0].showsHer = true;
    // Guarantee exactly one product slide even if the model miscounts.
    if (!slides.some((sl) => sl.product)) slides[3].product = true;
    else slides.forEach((sl, i) => { if (sl.product && i !== slides.findIndex((x) => x.product)) sl.product = false; });
    const state: CarouselResumeState = {
      v: 1, slides, caption: String(plan.caption ?? "").slice(0, 300), raws: [], burned: [], pending: null, anchor: null,
    };
    await runCarouselSlides(ctx, index, state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ugc-sample] carousel slot failed: ${msg}`);
    await setSlot({ status: "failed", error: msg.slice(0, 400) });
  }
}

/** Render (or RESUME rendering) the planned slides. Progress persists into the
 *  slot after every step — plan, each created KIE task id, each finished
 *  slide — so a poll-deadline death loses nothing: the next retry re-polls the
 *  in-flight task and continues from the first missing slide. Fresh KIE tasks
 *  (= credits) are only created for slides with no usable prior task. */
async function runCarouselSlides(ctx: UgcSlotCtx, index: number, state: CarouselResumeState): Promise<void> {
  const setSlot = slotWriter(ctx, index);
  const persist = () => setSlot({ concept: JSON.stringify(state), imageUrls: [...state.burned] });
  const { slides } = state;
  try {
    await setSlot({
      status: "rendering",
      error: "",
      script: slides.map((sl, i) => `${i + 1}. ${sl.text}${sl.product ? " ← product" : ""}`).join("\n") + (state.caption ? `\n\nCaption: ${state.caption}` : ""),
    });
    await persist();

    const { generateCarouselImage } = await import("@/lib/server/carouselImage");
    const { resolveImageEngine } = await import("@/lib/builder/imageEngines");
    const engine = resolveImageEngine("nano-banana-2");
    // IDENTITY IS NON-NEGOTIABLE: without the presenter reference the model
    // invents a new person per slide. Fail loud (retry is cheap) rather than
    // render a stranger.
    // The ref must be a Kie-FETCHABLE hosted png. A raw fallback URL (normalize
    // failed: hotlink-blocked, wrong type) is silently IGNORED by the model —
    // which then invents a different woman. Fail loud instead; retry is cheap.
    const kieSafePhoto = /^https?:\/\//i.test(ctx.normalizedPhotoUrl) && /\.(png|jpe?g|webp)(\?|#|$)/i.test(ctx.normalizedPhotoUrl);
    if (!ctx.normalizedPhotoUrl || !kieSafePhoto) {
      throw new Error("presenter photo couldn't be prepared as a render reference — re-upload the model photo and retry");
    }
    const personRef = ctx.normalizedPhotoUrl;
    const brandRefs = [...new Set([...(ctx.productImageUrls?.length ? ctx.productImageUrls : [ctx.productImageUrl]), ctx.screenshotUrl])].filter(Boolean);
    // First rendered slide becomes an EXTRA identity ref for every later slide —
    // chaining the model to its own slide 1 is what keeps hair/outfit/lighting
    // consistent across the set (the photo alone was drifting on the 1K model).
    // Continuity anchor = the first rendered slide that SHOWS her (a POV slide
    // can't anchor identity); until one exists, the first rendered slide anchors
    // lighting/story continuity. RAW url — never a caption-burned one.
    for (let i = state.burned.length; i < slides.length; i++) {
      const sl = slides[i];
      const firstSlideUrl = state.anchor?.url ?? "";
      // Refs (max 3): her photo always first, then slide-1 continuity, then the
      // brand ref on the product slide (continuity yields the slot if needed).
      const refs = sl.product
        ? [personRef, ...brandRefs, firstSlideUrl].filter(Boolean).slice(0, 3)
        : [personRef, firstSlideUrl].filter(Boolean).slice(0, 3);
      // Reference images ride on EVERY slide — identity when she's in frame,
      // styling/lighting continuity when the slide is her POV (she's not shown).
      const identityBlock = sl.showsHer
        ? `THE WOMAN — #1 PRIORITY: the EXACT same real person shown in the FIRST attached reference photo — same face, same hair, same skin tone, same build. Never a different person, never a lookalike.${firstSlideUrl ? " Another attached reference is an earlier slide from THIS carousel — match its styling (hair, outfit logic, lighting mood) exactly." : ""} She is mid-activity, unposed, often not looking at the camera.`
        : `POV SHOT — this is a photo SHE took: she is NOT in frame (at most her hands/forearms at the edge). The attached reference photos are the same woman + an earlier slide from THIS carousel — use them for CONTINUITY, not to insert her: if her hands appear they match her (skin tone, rings/nails logic), and the places, belongings, lighting mood, and time of day continue the same story.`;
      // Raw slide already rendered by a previous run (died during caption burn)
      // → skip generation entirely; else resume the in-flight KIE task for THIS
      // slide when one was persisted, and only create (pay for) a new task when
      // neither exists.
      let imageUrl = state.raws[i] ?? "";
      if (!imageUrl) {
        const resumeTaskId = state.pending?.i === i ? state.pending.taskId : undefined;
        const generated = await generateCarouselImage({
          prompt: `Candid amateur iPhone photo — slide ${i + 1} of 5 in a real girl's casual photo-dump carousel telling ONE continuous story of her day (previous beats: ${slides.slice(0, i).map((p, j) => `${j + 1}. ${p.visual.slice(0, 60)}`).join("; ") || "none — this opens the story"}). Same day, same story: consistent lighting mood, season, and life context across the set.
${identityBlock}
SCENE (this story beat): ${sl.visual}
${sl.product ? `THE PRODUCT/BRAND: the attached brand reference image shows the REAL product/brand — reproduce it faithfully (same packaging, colors, logo, UI) inside this candid moment. It reads as part of her day, not a product shot.` : ""}
NO TEXT: render ABSOLUTELY NO text, words, captions, stickers, or watermarks anywhere in the image — the caption is added separately afterward.
LOOK: real phone camera aesthetic — slightly imperfect framing, natural mixed lighting, mild motion blur or grain where natural, cluttered lived-in real places. Absolutely NOT: studio lighting, graphic-design layouts, ad composition, illustration. 9:16 vertical.`,
          engine,
          aspectRatio: "9:16",
          refImageUrls: refs,
          apiKey: process.env.KIE_API_KEY,
          resumeTaskId,
          onTaskCreated: async (taskId) => { state.pending = { i, taskId }; await persist(); },
        });
        imageUrl = generated.imageUrl;
        state.raws[i] = imageUrl;
        state.pending = null;
        if (!state.anchor || (sl.showsHer && !state.anchor.showsHer)) state.anchor = { url: imageUrl, showsHer: sl.showsHer };
        await persist(); // raw slide is safe even if the caption burn below dies
      }
      // Identical IG-story caption style on every slide, burned by US (sharp) —
      // model-drawn text was a different font/placement per slide.
      const withCaption = await burnCaptionOnImage(imageUrl, sl.text, i);
      state.burned.push(withCaption);
      await persist(); // live progress
    }
    await setSlot({ status: "done", imageUrls: [...state.burned] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ugc-sample] carousel slot failed: ${msg}`);
    // State (plan, finished slides, pending task id) is already persisted —
    // the slot fails VISIBLY but the next Retry resumes instead of re-paying.
    await setSlot({ status: "failed", error: msg.slice(0, 400) });
  }
}
