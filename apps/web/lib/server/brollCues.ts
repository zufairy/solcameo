import { callClaudeJSON } from "./kie-claude";
import type { TranscriptWord } from "./clipTypes";

/** One B-roll cutaway cue: a short stock-photo SEARCH QUERY (not on-screen text)
 *  timed to a specific spoken moment. `atSec` is clip-relative seconds. */
export interface BrollCue {
  atSec: number;
  /** 2-4 word topical search query (feeds lib/server/imageSearch.ts). */
  query: string;
}

const SYSTEM =
  "You pick B-ROLL CUTAWAY moments for a podcast/talking-head video — the points where a stock " +
  "photo would visually reinforce what's being said (a named thing, place, industry, concept, or " +
  "concrete noun mentioned), the way a documentary or news package cuts away from the speaker to a " +
  "relevant image for a few seconds. Given a transcript with per-word start times, pick AS MANY such " +
  "moments as you can genuinely justify — roughly one every 10-15 seconds of the clip, more if the " +
  "transcript is dense with concrete subjects, fewer only if it truly has nothing photographable. " +
  "query: a 2-4 word STOCK-PHOTO SEARCH PHRASE for that subject (e.g. \"bitcoin trading\", " +
  "\"city skyline night\", \"laptop coding\") — generic and photographable, not a quote or sentence. " +
  "atSec MUST equal the start time of a word actually spoken at or near that moment (snap to the " +
  "nearest word start in the given list). Space cues at least 6 seconds apart, spread across the WHOLE " +
  "clip duration, not clustered at the start. Return ONLY JSON: " +
  "{\"cues\":[{\"atSec\":number,\"query\":string}]}.";

/** Build a fallback search query from whatever's actually said near `center`
 *  (±4s) when the LLM didn't offer a cue for that slot — every ~15s slot gets
 *  a real, transcript-grounded query either way, never a gap. imageSearch.ts's
 *  own keyword reduction handles turning this raw snippet into a usable search
 *  (it already has to, for any multi-word sentence). */
function fallbackQuery(words: TranscriptWord[], center: number): string {
  return words
    .filter((w) => w.start >= center - 4 && w.start <= center + 4)
    .map((w) => w.word)
    .join(" ")
    .trim()
    .slice(0, 80);
}

/**
 * Generate KIE-picked B-roll cutaway cues from a clip's own transcript words
 * (clip-relative timing) — "follow the transcription" instead of a single
 * fixed photo for the whole clip. GUARANTEES roughly one cue per `slotSec`
 * (default 15s) across the clip's full duration: the LLM's own pick is used
 * where it offered one in that window, otherwise a cue is synthesized from
 * whatever's actually said near that slot's center — so density never
 * depends on the LLM finding something "concrete enough" to justify a beat.
 * Best-effort: an LLM failure just means every slot falls back, never [].
 */
export async function generateBrollCues(
  words: TranscriptWord[],
  durationSec: number,
  apiKey: string,
  opts?: { slotSec?: number },
): Promise<BrollCue[]> {
  if (words.length === 0) return [];
  const slotSec = opts?.slotSec ?? 15;
  const targetCount = Math.max(1, Math.round(durationSec / slotSec));

  const llmCues: BrollCue[] = [];
  if (apiKey) {
    try {
      const wordList = words.slice(0, 500).map((w) => `${w.start.toFixed(2)}:${w.word}`).join(" ");
      const user = `CLIP DURATION: ${durationSec.toFixed(1)}s\n\nWORDS (start_seconds:word):\n${wordList}`;
      const raw = await callClaudeJSON<{ cues?: unknown }>({ system: SYSTEM, user, apiKey });
      const arr = Array.isArray(raw?.cues) ? raw.cues : [];
      const wordStarts = words.map((w) => w.start);
      const snapToWord = (t: number): number => {
        let best = wordStarts[0] ?? 0, bestDist = Infinity;
        for (const s of wordStarts) {
          const d = Math.abs(s - t);
          if (d < bestDist) { bestDist = d; best = s; }
        }
        return best;
      };
      for (const c of arr) {
        const o = c as Record<string, unknown>;
        const query = typeof o.query === "string" ? o.query.trim().slice(0, 60) : "";
        if (!query) continue;
        const atSecRaw = typeof o.atSec === "number" && Number.isFinite(o.atSec) ? o.atSec : null;
        if (atSecRaw === null) continue;
        const atSec = Math.max(0.3, Math.min(durationSec - 3.5, snapToWord(atSecRaw)));
        if (atSec < 0.3) continue;
        llmCues.push({ atSec, query });
      }
      llmCues.sort((a, b) => a.atSec - b.atSec);
    } catch (e) {
      console.warn(`[brollCues] LLM cue generation failed, falling back to transcript-derived cues: ${e instanceof Error ? e.message : e}`);
    }
  }

  const MIN_GAP = 6;
  const result: BrollCue[] = [];
  for (let i = 0; i < targetCount; i++) {
    const slotStart = i * slotSec;
    const slotEnd = slotStart + slotSec;
    if (slotStart >= durationSec - 3.5) break;
    const prev = result[result.length - 1];
    const llmMatch = llmCues.find((c) => c.atSec >= slotStart && c.atSec < slotEnd && (!prev || c.atSec - prev.atSec >= MIN_GAP));
    if (llmMatch) { result.push(llmMatch); continue; }
    const center = Math.min(durationSec - 3.5, Math.max(0.3, slotStart + slotSec / 2));
    if (prev && center - prev.atSec < MIN_GAP) continue;
    const query = fallbackQuery(words, center);
    if (!query) continue;
    result.push({ atSec: center, query });
  }
  return result;
}
