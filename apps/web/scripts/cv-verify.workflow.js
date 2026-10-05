export const meta = {
  name: 'clip-cv-verify',
  description: 'Computer-vision QA on rendered clip skills — one agent per clip reads its frames and verdicts whether the skill effect actually rendered',
  phases: [
    { title: 'Verify' },
    { title: 'Synthesize' },
  ],
}

// Clip data embedded inline (workflow scripts can't read fs; args delivery was flaky).
const base = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/923ccbc4-975e-4368-a1cc-8e272f2cb376/scratchpad/matrix/frames"
const clips = [
  { label: "captions", source: "youtube", expect: "Word-by-word captions burned in (yellow/white, near bottom), synced to speech. Vertical 9:16 reframe.", peakDb: -1.855, nframes: 8 },
  { label: "facetrack", source: "youtube", expect: "Vertical reframe keeping the SPEAKER'S FACE centered as they move, plus captions.", peakDb: -1.855, nframes: 8 },
  { label: "hook", source: "youtube", expect: "A bold HOOK TITLE text overlay (punchy headline, large text usually near top) early in the clip, plus captions.", peakDb: -1.855, nframes: 8 },
  { label: "title", source: "youtube", expect: "A bold TITLE CARD / headline overlay on the clip, plus captions.", peakDb: -1.868, nframes: 8 },
  { label: "zoom", source: "youtube", expect: "Dynamic ZOOM PUNCHES — framing scale visibly changes (zoom in/out) across frames, plus captions.", peakDb: -1.855, nframes: 8 },
  { label: "keywords", source: "youtube", expect: "Captions where KEYWORDS are emphasized (different color/size/highlight) vs normal words.", peakDb: -1.855, nframes: 8 },
  { label: "filters", source: "youtube", expect: "A VIVID color filter/grade — noticeably more saturated/punchy than neutral, plus captions.", peakDb: -1.855, nframes: 8 },
  { label: "captionstyle", source: "youtube", expect: "Captions in ALL CAPS punchy style (Smart Captions prompt asked for ALL CAPS).", peakDb: -1.855, nframes: 8 },
  { label: "sticker", source: "youtube", expect: "An emoji/STICKER graphic overlay (near top), plus captions.", peakDb: -5.898, nframes: 1 },
  { label: "meme", source: "youtube", expect: "A MEME-style caption overlay (white impact-font text, often near top), plus captions.", peakDb: -1.855, nframes: 8 },
  { label: "memeaudio", source: "youtube", expect: "A reaction SOUND EFFECT added (AUDIO-ONLY — judge by loudness peak vs plain speech ~-1.85dB; can't hear frames).", peakDb: -1.855, nframes: 8 },
  { label: "brainrot", source: "youtube", expect: "A GAMEPLAY/brain-rot BACKGROUND under the clip — split/stacked layout (talking clip on top, gameplay below), plus captions.", peakDb: -1.855, nframes: 8 },
  { label: "combo_all", source: "youtube", expect: "ALL of: vertical reframe + face-centered + hook title overlay + captions + gameplay brain-rot background together.", peakDb: -1.876, nframes: 8 },
]
log(`CV-verifying ${clips.length} rendered clips`)

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string' },
    present: { type: 'boolean', description: 'is the skill\'s intended visual effect actually visible in the frames?' },
    correct: { type: 'boolean', description: 'is it rendered correctly / good quality (not garbled, cut off, mis-placed, or covering the subject)?' },
    evidence: { type: 'string', description: 'concretely what you saw across the frames that supports the verdict' },
    bug: { type: 'string', description: 'if missing/broken, the specific defect; else empty string' },
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
  },
  required: ['label', 'present', 'correct', 'evidence', 'bug', 'severity'],
}

const verdicts = await parallel(clips.map((c) => () => {
  const frames = Array.from({ length: c.nframes || 0 }, (_, i) => `${base}/${c.label}_f${String(i + 1).padStart(2, '0')}.jpg`)
  return agent(
    `You are doing rigorous computer-vision QA on ONE rendered short-form (vertical 9:16) video clip from an AI clipping pipeline.

SKILL UNDER TEST: "${c.label}"  (source: ${c.source})
EXPECTED EFFECT (what a CORRECT render of this skill must show):
${c.expect}

Audio loudness peak measured for this clip: ${c.peakDb ?? 'n/a'} dB (relevant only for sound-effect skills — a reaction SFX should push the peak toward 0 dB / louder than plain speech).
${c.nframes <= 1 ? 'WARNING: only ' + c.nframes + ' frame could be extracted from this clip — a healthy ~16s clip yields 8. Few/zero frames strongly implies the render is TRUNCATED/CORRUPT; weigh that heavily.' : ''}
Read ALL of these ${c.nframes} frames (sampled evenly across the clip; frame 1 = clip start, where hook/title overlays live):
${frames.map((f, i) => `  frame ${i + 1}: ${f}`).join('\n')}

Judge ONLY this skill's effect (ignore unrelated aspects). Be strict and specific:
- present = is the effect actually visible? (e.g. captions burned in; hook title overlay; sticker; gameplay background; visible zoom/scale change across frames; color-graded filter look; ALL-CAPS captions; meme top-caption).
- correct = is it well-formed (readable, not cut off, not covering the speaker's face, synced-looking, right position)?
- evidence = cite what you saw in which frames.
- bug = the precise defect if present=false or correct=false (else "").
- For an audio-only skill (MEME SFX) you cannot hear frames — base present on the loudness peak + any on-screen cue, and say so in evidence.
Return the structured verdict.`,
    { label: `cv:${c.label}`, phase: 'Verify', schema: VERDICT, effort: 'low' },
  ).then((v) => v || { label: c.label, present: false, correct: false, evidence: 'agent returned null', bug: 'CV agent failed', severity: 'low' })
}))

const clean = verdicts.filter(Boolean)

phase('Synthesize')
const report = await agent(
  `You are the lead QA engineer. Below are computer-vision verdicts for each skill of an AI video-clipping pipeline, gathered by reading rendered frames. Produce a CRISP bug report for the engineer.

VERDICTS (JSON):
${JSON.stringify(clean, null, 2)}

Write:
1. A per-skill table: skill -> PASS / FAIL / PARTIAL, one-line reason.
2. A ranked bug list (high severity first) — only real defects (present=false or correct=false), each with the concrete fix area.
3. One-paragraph overall verdict: is the pipeline production-ready for these skills? What are the top 1-3 things to fix?
Be specific and terse. Do not invent issues not in the verdicts.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'medium' },
)

return { verdicts: clean, report }
