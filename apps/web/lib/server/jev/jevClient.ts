// I/O half of the JEV lab: the retriever (Kie LLM ranker over a BM25 shortlist,
// or a local Ollama embedding when explicitly enabled) and the Jev judge
// (scripts/jev/jev_score.py — Typesafe only ships a Python SDK, so the scorer
// is a sidecar process, vendored from jev-video-search core.py).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { bm25Scores, cosine, heuristicInterest } from "./moments";

const OLLAMA = (process.env.OLLAMA_HOST || "").replace(/\/+$/, "");
const EMBED_MODEL = process.env.JEV_EMBED_MODEL || "mxbai-embed-large";
const configuredPython = process.env.JEV_PYTHON?.trim();
// A developer may keep JEV_PYTHON in .env.local after deleting its venv. Do
// not make every search fail with spawn ENOENT in that case; fall back to the
// system interpreter and report a useful SDK error from the sidecar.
const PYTHON = configuredPython && existsSync(configuredPython) ? configuredPython : "python3";
const SCRIPT = join(process.cwd(), "scripts", "jev", "jev_score.py");
// Upstream measures a 50-item, 25-wide pass at roughly 1.4s. Twelve seconds is
// enough weather margin without leaving the UI stuck on a failing provider.
const JEV_TIMEOUT_MS = 12_000;
// How many of the BM25 shortlist get a KIE semantic pass — caps prompt size
// (and cost/latency) on a long video's 200+ candidate windows. Whatever falls
// outside this stays at its BM25 score, ranked below the KIE-scored ones by
// topK's ordering (KIE scores are 0..1, BM25 raw scores run much lower).
const KIE_RERANK_POOL_MAX = 80;
// Retrieval must stay FAST-FAIL: its whole job is a quick shortlist before the
// real (and rightly slower) Jev judge runs, so a Kie call here is capped hard
// — kie-claude.ts's own retry/failover logic can legitimately take minutes
// under a bad-weather Kie outage (3 attempts x 45s, then a failover model x 2
// more attempts x 45s), which is fine for a background content-generation
// call but not for a search a person is staring at. Miss the deadline, fall
// back to BM25/heuristic order and move on — never block on it.
const KIE_RETRIEVE_TIMEOUT_MS = 9_000;
const KIE_BEST_MOMENTS_TIMEOUT_MS = 15_000;
const USE_KIE_RETRIEVER = process.env.JEV_KIE_RERANK === "1";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}


export type Retriever = "embedding" | "kie" | "bm25";

async function ollamaEmbed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.slice(i, i + 64) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) throw new Error(`ollama embed ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { embeddings?: number[][] };
    if (!j.embeddings?.length) throw new Error("ollama embed returned no vectors");
    out.push(...j.embeddings);
  }
  return out;
}

// Window vectors per source, so a second query on the same video only embeds
// the query (~30ms, the speed the source repo is built around).
const vecCache = new Map<string, number[][]>();

/** ONE Kie call scoring every doc in `docs` (already capped to KIE_RERANK_POOL
 *  by the caller) against the query, 0..1 — a semantic stand-in for embeddings
 *  when there's no local model to embed with (prod has no Ollama). Docs are
 *  indexed 1-based in the prompt and truncated to keep the request small and
 *  fast; a truncated/garbled response degrades to "score everything 0" for
 *  the indices it didn't return, not a throw. */
async function kieRerank(query: string, docs: string[]): Promise<number[]> {
  const numbered = docs.map((d, i) => `${i + 1}. ${d.slice(0, 220).replace(/\s+/g, " ")}`).join("\n");
  const json = await callClaudeJSON<{ scores?: { i?: number; s?: number }[] }>({
    system:
      "You rank video transcript snippets by how well each one matches a search query. " +
      'Reply with ONLY a JSON object: {"scores":[{"i":<1-based index>,"s":<0..1 relevance>}, ...]} ' +
      "— one entry per numbered snippet, in any order. 1 = clearly shows/says what the query " +
      "describes. 0 = unrelated or only superficially similar topic. No prose, no markdown.",
    user: `Query: ${query.slice(0, 400)}\n\nSnippets:\n${numbered}`,
    maxTokens: Math.min(4000, docs.length * 12 + 200),
  });
  const scores = new Array(docs.length).fill(0);
  for (const row of json.scores ?? []) {
    const idx = (row.i ?? 0) - 1;
    if (idx >= 0 && idx < scores.length && typeof row.s === "number") {
      scores[idx] = Math.max(0, Math.min(1, row.s));
    }
  }
  return scores;
}

export type BestMomentPick = { i: number; reason: string };

/**
 * "Best moments" mode: ONE Kie call reasons over a pool of candidate windows
 * and PICKS the ones worth clipping, with a reason — a stand-in for the
 * hook/flow/value/trend judgment the old per-video LLM analyzer made, but
 * scoped to windows already built from the real transcript (same sentence-
 * aligned boundaries the query-matching path uses) and spent once per search
 * instead of once per video. Used for queries like "best moments" or
 * "highlights" that name no specific content for Jev to match against —
 * see moments.ts isGenericQuery(). Never throws: an empty array on any
 * failure, so the caller can fall back cleanly.
 */
export async function pickBestMoments(docs: string[], maxClips: number): Promise<BestMomentPick[]> {
  if (!docs.length) return [];
  const numbered = docs.map((d, i) => `${i + 1}. ${d.slice(0, 260).replace(/\s+/g, " ")}`).join("\n");
  try {
    const json = await withTimeout(callClaudeJSON<{ picks?: { i?: number; reason?: string }[] }>({
      system:
        "You are picking the best short-form clip moments from a video transcript, for a creator " +
        "deciding what to post. Numbered snippets are candidate windows, roughly in transcript order. " +
        "Pick the ones most worth clipping on their own: a strong hook or opening line, a surprising " +
        "reveal or turn, a clear emotional beat, a concrete useful insight, humor, or a satisfying " +
        "payoff to something set up earlier. Judge the ACTUAL CONTENT, not the presence of keywords. " +
        "Skip filler, transitions, and anything that only makes sense with earlier context missing " +
        "from the snippet. Prefer variety over several near-duplicates of the same beat. " +
        `Pick at most ${maxClips}, fewer if that's all that's genuinely worth it — do not pad. ` +
        'Reply with ONLY JSON: {"picks":[{"i":<1-based index>,"reason":"<one short phrase, why this one>"}, ...]}, ' +
        "best first. No prose, no markdown.",
      user: `Snippets:\n${numbered}`,
      maxTokens: Math.min(3000, maxClips * 60 + docs.length * 8 + 200),
    }), KIE_BEST_MOMENTS_TIMEOUT_MS, "pickBestMoments");
    return (json.picks ?? [])
      .map((p) => ({ i: (p.i ?? 0) - 1, reason: String(p.reason ?? "").slice(0, 140) }))
      .filter((p) => p.i >= 0 && p.i < docs.length);
  } catch (e) {
    console.warn(`[jev] pickBestMoments failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** No-network pre-filter pool for pickBestMoments on a long video: the same
 *  spread-across-the-whole-video idea as lexicalShortlist, scored by
 *  heuristicInterest instead of picked by BM25 (there's no query to match). */
export function heuristicShortlist(docs: string[], poolSize: number): number[] {
  if (docs.length <= poolSize) return docs.map((_, i) => i);
  return docs
    .map((d, i) => [heuristicInterest(d), i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, poolSize)
    .map(([, i]) => i);
}

/**
 * Retriever scores for every window. Ollama embeddings ONLY when explicitly
 * pointed at one (OLLAMA_HOST set — never the case on Railway, so prod never
 * even attempts it: the old default-localhost attempt was what made this
 * "stick" on the live server, since a container with nothing listening on
 * 127.0.0.1:11434 doesn't always refuse fast — some sandboxed networks just
 * drop the SYN and the OS default connect timeout is 60s+). Otherwise a
 * single Kie LLM call reranks the BM25 shortlist — plain BM25 is the final
 * fallback and never fails, so the lab always answers.
 */
type RetrieveResult = { scores: number[]; retriever: Retriever; note?: string };
// Repeat searches (same video, minLen/maxLen, AND query) skip the network
// entirely — a common case (re-clicking Find moments, or tweaking maxClips
// which doesn't change the candidate set) — instead of paying for another Kie
// call. Keyed on the full candidate list length too, since a different
// minLen/maxLen already changes `cacheKey`.
const retrieveCache = new Map<string, RetrieveResult>();

export async function retrieve(
  cacheKey: string,
  query: string,
  docs: string[],
  k = 50,
): Promise<RetrieveResult> {
  const memoKey = `${cacheKey}|${docs.length}|${query}`;
  const memo = retrieveCache.get(memoKey);
  if (memo) return memo;

  const result = await retrieveUncached(cacheKey, query, docs, k);
  retrieveCache.set(memoKey, result);
  if (retrieveCache.size > 100) retrieveCache.delete(retrieveCache.keys().next().value as string);
  return result;
}

async function retrieveUncached(cacheKey: string, query: string, docs: string[], k: number): Promise<RetrieveResult> {
  const bm25 = bm25Scores(query, docs);

  if (OLLAMA) {
    try {
      let vecs = vecCache.get(cacheKey);
      if (!vecs || vecs.length !== docs.length) {
        vecs = await ollamaEmbed(docs);
        vecCache.set(cacheKey, vecs);
        if (vecCache.size > 50) vecCache.delete(vecCache.keys().next().value as string);
      }
      const [qv] = await ollamaEmbed([query]);
      return { scores: vecs.map((v) => cosine(v, qv)), retriever: "embedding" };
    } catch (e) {
      // OLLAMA_HOST was set but unreachable — fall through to Kie/BM25 below
      // rather than failing the whole search.
      console.warn(`[jev] ollama embed failed, falling back: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Reranking only means anything when there's a corpus bigger than what will
  // reach Jev anyway — a 30s video's handful of windows all advance to Jev
  // regardless of what order retrieve() hands back, so spending a network
  // round trip (let alone risking its worst-case latency) to re-sort them
  // first is pure overhead. Same call jev-video-search's own retriever would
  // make: shortlisting is skipped once the corpus already fits top_k.
  if (docs.length <= k || !USE_KIE_RETRIEVER) {
    return {
      scores: bm25,
      retriever: "bm25",
      ...(!USE_KIE_RETRIEVER ? { note: "Fast local shortlist; Jev performs the semantic judgment" } : {}),
    };
  }

  try {
    // Shortlist by BM25 first, sized to what the caller actually needs (k) —
    // the Kie prompt only has to be big enough to find the relevant windows
    // among the ones that will reach Jev, not score all 300 on a long video.
    const poolSize = Math.min(KIE_RERANK_POOL_MAX, Math.max(k, 20));
    const poolIdx = bm25.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).slice(0, poolSize).map(([, i]) => i);
    const kieScores = await withTimeout(kieRerank(query, poolIdx.map((i) => docs[i])), KIE_RETRIEVE_TIMEOUT_MS, "Kie rerank");
    const scores = [...bm25.map((s) => s / 1000)]; // everything outside the pool: BM25 order, scaled below any real Kie score
    poolIdx.forEach((docIdx, poolPos) => { scores[docIdx] = 1 + kieScores[poolPos]; }); // pool always outranks the rest
    return { scores, retriever: "kie" };
  } catch (e) {
    return {
      scores: bm25,
      retriever: "bm25",
      note: `Kie rerank unavailable (${e instanceof Error ? e.message : e}) — using keyword search only`,
    };
  }
}

/** Whether the Jev judge can run here at all (sidecar script + API key) —
 *  surfaced on the /dev/jev status panel. Doesn't spawn Python. */
export function jevReady(): { ok: boolean; reason?: string } {
  if (!existsSync(SCRIPT)) return { ok: false, reason: "scripts/jev/jev_score.py missing" };
  if (!process.env.TYPESAFE_API_KEY) return { ok: false, reason: "TYPESAFE_API_KEY not set" };
  return { ok: true };
}

export type JevResult = { scores: (number | null)[]; applied: boolean; error?: string };

/** Score each caption against the query with Jev. Never throws: on any failure
 *  the scores are all null and the caller keeps retriever order. */
export function jevScores(query: string, captions: string[]): Promise<JevResult> {
  const scores: (number | null)[] = captions.map(() => null);
  if (!captions.length) return Promise.resolve({ scores, applied: false });
  if (!existsSync(SCRIPT)) return Promise.resolve({ scores, applied: false, error: `missing ${SCRIPT}` });

  return new Promise((resolve) => {
    let settled = false;
    let error: string | undefined;
    let buf = "";
    let stderr = "";
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const scored = scores.filter((s) => s !== null).length;
      resolve({ scores, applied: scored > 0, ...(error || !scored ? { error: error ?? (stderr.trim().slice(-300) || "Jev scored nothing") } : {}) });
    };
    const child = spawn(PYTHON, [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      error = `Jev timed out after ${JEV_TIMEOUT_MS / 1000}s`;
      child.kill("SIGKILL");
      finish();
    }, JEV_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line) as { i?: number; score?: number | null; error?: string };
          if (m.error) error = m.error;
          else if (typeof m.i === "number" && m.i >= 0 && m.i < scores.length) scores[m.i] = m.score ?? null;
        } catch { /* ignore a non-JSON line */ }
      }
    });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => { error = `cannot start ${PYTHON}: ${e.message}`; finish(); });
    child.on("close", finish);
    child.stdin.end(JSON.stringify({ query, captions }));
  });
}
