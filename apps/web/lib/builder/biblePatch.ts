/** Constrained, allowlisted patch ops the copilot may apply to the show bible.
 *  Every applied op yields a human summary the chat UI shows as a
 *  "✓ Applied to show plan" chip; anything outside the allowlist is rejected
 *  with a reason and never mutates. Spec: phase-3 structured copilot. */
import type { ShowBible } from "./showBible";
import { formatById, clampFormatDuration } from "./formatCatalog";

export interface BiblePatchOp { op: string; value?: string; formatId?: string; seconds?: number }
export interface BiblePatchResult { bible: ShowBible; applied: string[]; rejected: string[] }

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};

export function applyBiblePatch(input: ShowBible, ops: BiblePatchOp[]): BiblePatchResult {
  // Deep-enough clone of the parts we touch; untouched branches share refs.
  const bible: ShowBible = {
    ...input,
    voice: { ...input.voice, catchphrases: [...(input.voice.catchphrases ?? [])] },
    visualWorld: { ...input.visualWorld },
    format: { ...input.format, kinds: [...input.format.kinds] },
    cadence: { ...input.cadence, perFormatDuration: { ...input.cadence.perFormatDuration } },
  };
  const applied: string[] = [];
  const rejected: string[] = [];

  for (const o of ops ?? []) {
    switch (o.op) {
      case "setTone": {
        const v = str(o.value, 60);
        if (!v) { rejected.push(`setTone: invalid value`); break; }
        bible.voice.tone = v; applied.push(`voice tone → ${v}`); break;
      }
      case "setLanguage": {
        const v = str(o.value, 40);
        if (!v) { rejected.push(`setLanguage: invalid value`); break; }
        bible.voice.language = v; applied.push(`language → ${v}`); break;
      }
      case "setPremise": {
        const v = str(o.value, 300);
        if (!v) { rejected.push(`setPremise: invalid value`); break; }
        bible.premise = v; applied.push(`premise updated`); break;
      }
      case "setStyle": {
        const v = str(o.value, 120);
        if (!v) { rejected.push(`setStyle: invalid value`); break; }
        bible.visualWorld.style = v; applied.push(`visual style → ${v}`); break;
      }
      case "addFormat": {
        const f = o.formatId ? formatById(o.formatId) : undefined;
        if (!f) { rejected.push(`addFormat: unknown format ${o.formatId ?? "?"}`); break; }
        if (bible.format.kinds.includes(f.id)) { rejected.push(`addFormat: ${f.id} already in rotation`); break; }
        bible.format.kinds.push(f.id); applied.push(`added format ${f.name}`); break;
      }
      case "removeFormat": {
        const f = o.formatId ? formatById(o.formatId) : undefined;
        if (!f || !bible.format.kinds.includes(f.id)) { rejected.push(`removeFormat: ${o.formatId ?? "?"} not in rotation`); break; }
        if (bible.format.kinds.length <= 1) { rejected.push(`removeFormat: can't remove the last format`); break; }
        bible.format.kinds = bible.format.kinds.filter((k) => k !== f.id);
        applied.push(`removed format ${f.name}`); break;
      }
      case "setFormatDuration": {
        const f = o.formatId ? formatById(o.formatId) : undefined;
        if (!f || typeof o.seconds !== "number") { rejected.push(`setFormatDuration: invalid`); break; }
        const s = clampFormatDuration(f.id, o.seconds);
        bible.cadence.perFormatDuration[f.id] = { min: s, max: s };
        // Mirror onto every style of this format so both readers agree.
        for (const st of bible.videoStyles ?? []) if (st.format === f.id) st.durationSec = { min: s, max: s };
        applied.push(`${f.id} length → ${s}s`); break;
      }
      case "setPostsPerDay": {
        const n = typeof o.seconds === "number" ? Math.min(6, Math.max(1, Math.round(o.seconds))) : null;
        if (n === null) { rejected.push(`setPostsPerDay: invalid`); break; }
        bible.cadence.postsPerDay = n; applied.push(`posts per day → ${n}`); break;
      }
      case "addCatchphrase": {
        const v = str(o.value, 80);
        if (!v) { rejected.push(`addCatchphrase: invalid value`); break; }
        const list = bible.voice.catchphrases ?? [];
        if (!list.includes(v)) list.push(v);
        bible.voice.catchphrases = list;
        applied.push(`catchphrase added: "${v}"`); break;
      }
      default:
        rejected.push(`${o.op}: not an allowed operation`);
    }
  }
  return { bible, applied, rejected };
}
