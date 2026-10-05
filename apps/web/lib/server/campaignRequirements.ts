/**
 * Campaign requirements parser + deterministic caption tag-applier.
 *
 * A jobtepi content_reward exposes its posting rules as free-form strings
 * (`ContentReward.content_requirements: string[]`, e.g. Malay briefs like
 * "caption setiap video wajib letak nama daddymin_offical",
 * "wajib letak link di bio usernam @daddymin_offical", "organic traffic only").
 * Historically these were shown in the UI but NEVER enforced when an AI clipper
 * posted a clip. This module turns them into:
 *   - `mentions`   — required @handles (deterministic regex),
 *   - `hashtags`   — required #tags (deterministic regex),
 *   - `brandNames` — bare brand tokens to name in the caption (best-effort, from
 *                    tokens that follow a "nama"/"letak"/"tag" trigger),
 *   - `freeTextRules` — the leftover rule sentences (tone / quality / "organic
 *                    only") that feed the post-description LLM.
 *
 * The @mention / #hashtag / brand tags are applied DETERMINISTICALLY (never left
 * to an LLM) via `applyRequiredTagsToCaption`, mirroring the existing Convex
 * campaign `requiredTag` cap logic in app/api/agents/run-task/route.ts.
 *
 * This file is intentionally dependency-free (pure string logic, no Node/Supabase
 * imports) so it is safe to import from BOTH the Next.js route and the Convex
 * bundle (clipJobs).
 */

export interface RequiredTags {
  /** Required @handles, always prefixed with a single leading "@". */
  mentions: string[];
  /** Required #hashtags, always prefixed with a single leading "#". */
  hashtags: string[];
  /** Bare brand tokens (e.g. "daddymin_offical") the caption must name. */
  brandNames: string[];
}

export interface ParsedCampaignRequirements extends RequiredTags {
  /** Leftover rule sentences (tone / quality / "organic traffic only") — these
   *  feed the post-description LLM, NOT the deterministic tag append. */
  freeTextRules: string[];
}

/** Hard caps so a pathological brief can't bloat a caption or the payload. */
const MAX_TAGS = 12;
const MAX_FREE_RULES = 12;
const MAX_RULE_LEN = 300;

// Malay/English trigger words that precede a brand NAME in a "put the name X" rule.
const BRAND_TRIGGER_RE = /\b(nama|letak|tag|mention|sebut|guna|gunakan|pakai)\b/i;

// Tokens that are NEVER a brand even right after a trigger word (Malay + English
// filler / structural words that commonly appear in these briefs).
const BRAND_STOPWORDS = new Set<string>([
  "nama", "letak", "link", "links", "bio", "usernam", "username", "user", "handle",
  "account", "akaun", "wajib", "caption", "setiap", "video", "videos", "must", "put",
  "add", "tag", "tags", "mention", "page", "profile", "harus", "mesti", "dalam",
  "pada", "semua", "guna", "gunakan", "pakai", "kami", "anda", "kita", "untuk",
  "dengan", "dan", "atau", "yang", "ini", "itu", "juga", "serta", "sebut", "the",
  "your", "and", "or", "in", "of", "to", "for", "with", "this", "that", "please",
]);

/** Find raw @mentions in a single string (fresh regex per call — no shared state). */
function findMentions(s: string): string[] {
  return s.match(/@[\w.]+/g) ?? [];
}

/** Find raw #hashtags in a single string (fresh regex per call — no shared state). */
function findHashtags(s: string): string[] {
  return s.match(/#[\w]+/g) ?? [];
}

/** Normalize a mention to exactly one leading "@" and drop a trailing sentence dot. */
function normalizeMention(m: string): string {
  let s = m.trim().replace(/\.+$/, "");
  s = s.replace(/^@+/, "");
  return s ? `@${s}` : "";
}

/** Normalize a hashtag to exactly one leading "#". */
function normalizeHashtag(h: string): string {
  const s = h.trim().replace(/^#+/, "");
  return s ? `#${s}` : "";
}

/**
 * Best-effort brand-name extraction from ONE rule. Only fires when the rule
 * contains a "nama"/"letak"/"tag"/… trigger; then scans the tokens AFTER the
 * first trigger for handle-like tokens that carry a distinguishing char
 * (underscore / dot / digit) so we grab "daddymin_offical" but NOT plain Malay
 * words like "video" or "link". @mentions / #hashtags are handled separately.
 */
function extractBrandsFromRule(rule: string): string[] {
  if (!BRAND_TRIGGER_RE.test(rule)) return [];
  const tokens = rule.split(/\s+/);
  let triggerIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (BRAND_TRIGGER_RE.test(tokens[i])) { triggerIdx = i; break; }
  }
  if (triggerIdx < 0) return [];
  const out: string[] = [];
  for (let i = triggerIdx + 1; i < tokens.length; i++) {
    // Trim surrounding punctuation but keep @/# so we can skip those tokens.
    const raw = tokens[i].replace(/^[^\w@#]+/, "").replace(/[^\w@#]+$/, "");
    if (!raw || raw.startsWith("@") || raw.startsWith("#")) continue;
    if (BRAND_STOPWORDS.has(raw.toLowerCase())) continue;
    // Handle-like AND carries a distinguishing char so it isn't an ordinary word.
    if (raw.length >= 4 && /^[a-z0-9][a-z0-9._-]*$/i.test(raw) && /[._\d]/.test(raw)) {
      out.push(raw);
    }
  }
  return out;
}

/** Case-insensitive de-dup (keeps first-seen casing) with a hard count cap. */
function dedupCap(items: string[], cap = MAX_TAGS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const t = (it ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Parse a content_reward's `content_requirements` strings into structured,
 * deterministic tags + leftover free-text rules. Never throws — malformed input
 * just yields empty arrays.
 *
 * A rule that "contributes" a mention, hashtag, or brand is treated as a tag
 * directive and EXCLUDED from `freeTextRules` (it's enforced deterministically);
 * everything else (e.g. "organic traffic only", tone/quality rules) becomes a
 * free-text rule for the description LLM.
 */
export function parseCampaignRequirements(reqs: string[]): ParsedCampaignRequirements {
  const list = Array.isArray(reqs) ? reqs : [];

  const mentions = dedupCap(
    list.flatMap((r) => findMentions(String(r ?? ""))).map(normalizeMention).filter(Boolean),
  );
  const hashtags = dedupCap(
    list.flatMap((r) => findHashtags(String(r ?? ""))).map(normalizeHashtag).filter(Boolean),
  );
  const brandNames = dedupCap(
    list.flatMap((r) => extractBrandsFromRule(String(r ?? ""))),
  );

  const freeTextRules: string[] = [];
  const seenFree = new Set<string>();
  for (const raw of list) {
    const rule = String(raw ?? "").trim();
    if (!rule) continue;
    const contributed =
      findMentions(rule).length > 0 ||
      findHashtags(rule).length > 0 ||
      extractBrandsFromRule(rule).length > 0;
    if (contributed) continue; // a tag/brand directive — enforced deterministically
    const clipped = rule.slice(0, MAX_RULE_LEN);
    const key = clipped.toLowerCase();
    if (seenFree.has(key)) continue;
    seenFree.add(key);
    if (freeTextRules.length < MAX_FREE_RULES) freeTextRules.push(clipped);
  }

  return { mentions, hashtags, brandNames, freeTextRules };
}

/**
 * Union one or more ParsedCampaignRequirements into a single result, de-duplicating
 * each field case-insensitively (keeps first-seen casing). Used to MERGE a jobtepi
 * content_reward brief's requirements with a Convex campaign's MANDATORY
 * `requirements` when a clip/post is driven by both — so a tag present in both
 * sources is enforced exactly once. Pure + never throws.
 */
export function unionParsedRequirements(
  ...parts: ParsedCampaignRequirements[]
): ParsedCampaignRequirements {
  const out: ParsedCampaignRequirements = { mentions: [], hashtags: [], brandNames: [], freeTextRules: [] };
  const dedupInto = (target: string[], add: string[]) => {
    const seen = new Set(target.map((t) => t.toLowerCase()));
    for (const a of add ?? []) {
      const t = (a ?? "").trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      target.push(t);
    }
  };
  for (const p of parts) {
    if (!p) continue;
    dedupInto(out.mentions, p.mentions);
    dedupInto(out.hashtags, p.hashtags);
    dedupInto(out.brandNames, p.brandNames);
    dedupInto(out.freeTextRules, p.freeTextRules);
  }
  return out;
}

/**
 * Append any MISSING required @mentions / #hashtags / brand names to a caption,
 * deterministically. Mirrors the existing Convex-campaign `requiredTag` cap logic
 * (run-task route ~1355-1377): a token already present in the caption (or already
 * covered by a queued token — e.g. a brand subsumed by an @mention of the same
 * handle) is NOT re-added, and when the result would exceed `capChars` the CAPTION
 * BODY is trimmed but the required tags are NEVER dropped.
 *
 * MUST be called AFTER any hashtag-stripping step, or required #hashtags would be
 * deleted again.
 */
export function applyRequiredTagsToCaption(
  caption: string,
  required: { mentions?: string[]; hashtags?: string[]; brandNames?: string[] },
  capChars = 2200,
): string {
  const base = (caption ?? "").trim();
  const baseLc = base.toLowerCase();
  const missing: string[] = [];
  const seen = new Set<string>();

  // "Already present" = appears (case-insensitively) in the ORIGINAL caption OR is
  // subsumed by a token we've already queued to append (so a brand name equal to an
  // @mention's handle is never double-tagged).
  const present = (tok: string): boolean => {
    const k = tok.toLowerCase();
    if (baseLc.includes(k)) return true;
    return missing.some((m) => m.toLowerCase().includes(k));
  };
  const enqueue = (tok: string) => {
    const t = tok.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (present(t)) return;
    missing.push(t);
  };

  for (const m of required.mentions ?? []) {
    const t = m.trim();
    if (t) enqueue(t.startsWith("@") ? t : `@${t}`);
  }
  for (const h of required.hashtags ?? []) {
    const t = h.trim();
    if (t) enqueue(t.startsWith("#") ? t : `#${t}`);
  }
  for (const b of required.brandNames ?? []) enqueue(b);

  if (missing.length === 0) return base; // caption preserved exactly (incl. empty)

  const tail = missing.join(" ");
  // Tags are mandatory: if the caption is empty (or must be fully trimmed) we still
  // emit the tags. Only the caption BODY is ever cut to respect the cap.
  if (!base) return tail.slice(0, Math.max(0, capChars));
  const room = Math.max(0, capChars - tail.length - 1);
  const body = base.slice(0, room).replace(/\s+$/, "");
  return body ? `${body} ${tail}` : tail;
}

/**
 * Build the campaign-compliance fields for a post_content `input` payload — the
 * exact shape clipJobs.finalizeJob forwards to /api/agents/run-task so a clip
 * posted for a jobtepi content_reward carries its `contentRewardId` + required
 * @mentions / #hashtags / brand names (+ free-text tone rules), not just the
 * Convex `campaignId`. Empty fields are omitted so the input stays clean.
 */
export function buildRequiredTagInput(opts: {
  campaignId?: string | null;
  contentRewardId?: string | null;
  required?: RequiredTags | null;
  freeTextRules?: string[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (opts.campaignId) out.campaignId = opts.campaignId;
  if (opts.contentRewardId) out.contentRewardId = opts.contentRewardId;
  const req = opts.required;
  if (req) {
    if (req.mentions.length) out.requiredMentions = req.mentions;
    if (req.hashtags.length) out.requiredHashtags = req.hashtags;
    if (req.brandNames.length) out.requiredBrands = req.brandNames;
  }
  const rules = (opts.freeTextRules ?? []).filter((r) => typeof r === "string" && r.trim());
  if (rules.length) out.requiredFreeTextRules = rules;
  return out;
}
