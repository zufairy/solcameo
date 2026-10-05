import { callClaudeJSON } from "./kie-claude";
import type { TranscriptWord } from "./clipTypes";

/** One motion-graphics beat: a card headline (+ optional supporting line) timed
 *  to a specific SPOKEN moment in the clip. `atSec` is clip-relative seconds. */
export interface MotionBeat {
  atSec: number;
  headline: string;
  subtext?: string;
}

const SYSTEM =
  "You write on-screen MOTION GRAPHICS callouts for a short-form video explainer (Ali Abdal / " +
  "big-tech-explainer style) — a text card that pops up for several seconds while the speaker keeps " +
  "talking. Each callout must DIRECTLY illustrate the SPECIFIC point being made at that exact moment — " +
  "read the surrounding words and write what a designer would actually put on screen to reinforce THAT " +
  "sentence: the exact number/stat spoken, the named thing/place/tool, the claim in punchier words, or " +
  "a short label for the concept just introduced. NEVER a generic motivational line, NEVER something " +
  "that could apply to any video — if you can't tie it to the specific words right there, skip that " +
  "moment. Given a transcript with per-word start times, pick AS MANY genuinely justified moments as " +
  "you can find — roughly one every 10-12 seconds of the clip is the target density, more if the " +
  "transcript keeps naming new concrete things, fewer only if it's truly just one continuous thought. " +
  "headline: MAX 8 words, no trailing punctuation, must contain or directly reference a specific word " +
  "from THAT part of the transcript. subtext (optional): MAX 12 words, one supporting clause that adds " +
  "real information (a number, a name, a consequence), not filler. atSec MUST equal the start time of " +
  "a word actually spoken at or near that moment (snap to the nearest word start in the given list). " +
  "Space beats at least 5 seconds apart, spread across the WHOLE clip, not clustered at the start. " +
  "Never invent numbers/claims not in the transcript. Return ONLY JSON: " +
  "{\"beats\":[{\"atSec\":number,\"headline\":string,\"subtext\":string}]}.";

/** Build a fallback headline directly from whatever's actually said starting at
 *  `atSec` (5-6 words, capitalized) when the LLM didn't offer a beat for that
 *  slot — every ~12s slot gets a beat GENUINELY tied to the transcript either
 *  way (it's the literal words spoken there), never a generic filler line. */
function fallbackHeadline(words: TranscriptWord[], atSec: number): string {
  const span = words.filter((w) => w.start >= atSec).slice(0, 6).map((w) => w.word);
  if (span.length === 0) return "";
  const text = span.join(" ").replace(/[.,!?;:]+$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Generate KIE-written motion-graphics beats from a clip's own transcript
 * words (clip-relative timing). GUARANTEES roughly one beat per `slotSec`
 * (default 12s) across the clip's full duration: the LLM's own pick is used
 * where it offered a genuinely content-tied one in that window, otherwise a
 * beat is synthesized directly from the words spoken there — so multiple
 * beats through the whole video is never dependent on the LLM alone. Never
 * throws: an LLM failure just means every slot falls back to a
 * transcript-derived headline instead of an empty result.
 */
export async function generateMotionBeats(
  words: TranscriptWord[],
  durationSec: number,
  apiKey: string,
  opts?: { slotSec?: number },
): Promise<MotionBeat[]> {
  if (words.length === 0) return [];
  const slotSec = opts?.slotSec ?? 12;
  const targetCount = Math.max(1, Math.round(durationSec / slotSec));

  const llmBeats: MotionBeat[] = [];
  if (apiKey) {
    try {
      const wordList = words.slice(0, 500).map((w) => `${w.start.toFixed(2)}:${w.word}`).join(" ");
      // Plain readable transcript ALONGSIDE the timed word list: the model
      // grounds WHAT to say in the flowing text (argument, names, numbers,
      // consequences) and WHEN in the word timings — beats read like a
      // designer who actually watched the video, not keyword-matched a list.
      const plainText = words.slice(0, 500).map((w) => w.word).join(" ");
      const user = `CLIP DURATION: ${durationSec.toFixed(1)}s\n\nFULL TRANSCRIPT (what the speaker is actually arguing — ground every headline/subtext in THIS):\n${plainText}\n\nWORDS (start_seconds:word — snap atSec to these):\n${wordList}`;
      const raw = await callClaudeJSON<{ beats?: unknown }>({ system: SYSTEM, user, apiKey });
      const arr = Array.isArray(raw?.beats) ? raw.beats : [];
      const wordStarts = words.map((w) => w.start);
      const snapToWord = (t: number): number => {
        let best = wordStarts[0] ?? 0, bestDist = Infinity;
        for (const s of wordStarts) {
          const d = Math.abs(s - t);
          if (d < bestDist) { bestDist = d; best = s; }
        }
        return best;
      };
      for (const b of arr) {
        const o = b as Record<string, unknown>;
        const headline = typeof o.headline === "string" ? o.headline.trim().slice(0, 60) : "";
        if (!headline) continue;
        const atSecRaw = typeof o.atSec === "number" && Number.isFinite(o.atSec) ? o.atSec : null;
        if (atSecRaw === null) continue;
        // Leave room for the card's own entrance/hold/exit before the clip ends,
        // and never start before 0.3s (the very first frame reads as a glitch).
        const atSec = Math.max(0.3, Math.min(durationSec - 4.5, snapToWord(atSecRaw)));
        if (atSec < 0.3) continue;
        const subtext = typeof o.subtext === "string" && o.subtext.trim() ? o.subtext.trim().slice(0, 80) : undefined;
        llmBeats.push({ atSec, headline, ...(subtext ? { subtext } : {}) });
      }
      llmBeats.sort((a, b) => a.atSec - b.atSec);
    } catch (e) {
      console.warn(`[motionGraphics] LLM beat generation failed, falling back to transcript-derived beats: ${e instanceof Error ? e.message : e}`);
    }
  }

  const MIN_GAP = 5;
  const result: MotionBeat[] = [];
  for (let i = 0; i < targetCount; i++) {
    const slotStart = i * slotSec;
    const slotEnd = slotStart + slotSec;
    if (slotStart >= durationSec - 4.5) break;
    const prev = result[result.length - 1];
    const llmMatch = llmBeats.find((b) => b.atSec >= slotStart && b.atSec < slotEnd && (!prev || b.atSec - prev.atSec >= MIN_GAP));
    if (llmMatch) { result.push(llmMatch); continue; }
    const center = Math.min(durationSec - 4.5, Math.max(0.3, slotStart + slotSec / 2));
    if (prev && center - prev.atSec < MIN_GAP) continue;
    const headline = fallbackHeadline(words, center);
    if (!headline) continue;
    result.push({ atSec: center, headline });
  }
  return result;
}
