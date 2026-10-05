export const meta = {
  name: 'verify-clip-bugs',
  description: 'Adversarially classify the CV-flagged clip-skill bugs: real bug vs harness-config false positive vs wrong-expectation, by reading the planner + render code',
  phases: [{ title: 'Audit' }, { title: 'Synthesize' }],
}

// Precedent already established by direct read: clipEditPlanner.ts:242 skips clip.brainrot's
// composite_bg op when no bgId is configured (BY DESIGN). The harness passed minimal config
// (no bgId/sfxId/title text), so "no effect" may be a config gap, not a bug.
const REPO = "C:/Project/Vello/apps/web"
const FILES = `Read these to ground every verdict:
- ${REPO}/lib/server/clipEditPlanner.ts (buildSkillFloor + FLOOR_OP_KIND map + per-skill gating like the brainrot bgId skip at ~:242)
- ${REPO}/lib/builder/clipSkillsCatalog.ts (CLIP_SKILL_BY_ID — each skill's .floor() + memeText/stickerOverlayOp/hookText helpers)
- ${REPO}/lib/server/clipFilterGraph.ts and ${REPO}/lib/server/clipEditOps.ts (how an op becomes ffmpeg — title_card/text_overlay/sticker/composite_bg/audio_overlay)
- ${REPO}/lib/server/clipRender.ts and ${REPO}/app/api/video/clip/route.ts (the render entry the harness called)`

const cases = [
  { skill: "memeaudio", ops: '["reframe","subtitles"]', config: 'skillId clip.memeaudio, instructions only — NO sfxId, NO audioUrl, NO audioId', cv: 'No audio_overlay op emitted; loudness peak -1.855dB == plain-speech baseline (no SFX mixed).',
    question: "Does clip.memeaudio's floor emit an audio_overlay + an actual SOUND when NO sfxId/audioUrl is configured (e.g. an emotion-derived curated SFX), or does it require sfxId/audioUrl? If it requires config the canvas provides, this is a harness false positive; if it should auto-pick an SFX from emotion and didn't, it's a real bug." },
  { skill: "title", ops: '["reframe","title_card","subtitles"]', config: 'skillId clip.title, instructions only — NO explicit title text', cv: 'title_card op WAS emitted, but NO title/headline visible in any of the 8 frames.',
    question: "The title_card op was produced but nothing rendered. Does the title_card render require non-empty title text (which the harness/LLM may have left blank → invisible card), or is the title_card render branch itself broken/missing? Real render bug vs empty-text harness gap." },
  { skill: "sticker", ops: '["reframe","text_overlay","subtitles","text_overlay","text_overlay"]', config: 'skillId clip.sticker, stickerStyleId "pop", stickerPosition "top", NO stickerPrompt', cv: 'No sticker overlay visible AND the render CRASHED — only 1 frame / 660KB output (others ~17MB / 8 frames).',
    question: "Why would the sticker render crash/truncate? Inspect stickerOverlayOp + transformStickerText + how the sticker text_overlay becomes ffmpeg. Is the crash real (a genuine render bug, e.g. emoji/glyph or escaping), or triggered only by the 'pop' style with no stickerPrompt? A crash that truncates output is severe regardless." },
  { skill: "meme", ops: '["reframe","subtitles","text_overlay","text_overlay"]', config: 'skillId clip.meme, instructions only', cv: 'Top meme caption rendered, but described as small YELLOW text (not big white Impact-font) and brief — flagged "wrong style".',
    question: "What is clip.meme's ACTUAL intended caption style (color/font/size/position/duration) per memeText + the render? The CV expected white Impact-font; if the codebase's meme style is legitimately yellow bold, the CV verdict is a wrong-expectation false positive. Determine the real intended style and whether the render matches it." },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    skill: { type: 'string' },
    verdict: { type: 'string', enum: ['real_bug', 'real_bug_crash', 'false_positive_harness_config', 'false_positive_wrong_expectation', 'inconclusive'] },
    explanation: { type: 'string', description: 'why, citing the exact code (file:line) that decides it' },
    prod_behavior: { type: 'string', description: 'what the canvas/production passes that the harness did not, if relevant' },
    fix: { type: 'string', description: 'if real_bug, the concrete fix; else empty' },
  },
  required: ['skill', 'verdict', 'explanation', 'prod_behavior', 'fix'],
}

const verdicts = await parallel(cases.map((c) => () =>
  agent(
    `You are adversarially verifying whether a CV-flagged clip-skill "bug" is REAL or a harness/expectation FALSE POSITIVE. Default to skepticism — the test harness passed MINIMAL skill config (no bgId/sfxId/title text/sticker prompt), and the planner deliberately skips effects whose config is absent (precedent: clipEditPlanner.ts ~:242 skips brainrot's composite_bg when no bgId).

SKILL: ${c.skill}
OBSERVED OPS: ${c.ops}
HARNESS CONFIG PASSED: ${c.config}
CV FINDING: ${c.cv}
KEY QUESTION: ${c.question}

${FILES}

Read the code, then classify with file:line evidence. Distinguish: real_bug (effect should render with this config but doesn't), real_bug_crash (render crashes/truncates), false_positive_harness_config (effect correctly skipped because the harness omitted asset config the canvas supplies), false_positive_wrong_expectation (the CV expected the wrong thing; the render is actually correct).`,
    { label: `audit:${c.skill}`, phase: 'Audit', schema: SCHEMA, effort: 'medium' },
  ).then((v) => v || { skill: c.skill, verdict: 'inconclusive', explanation: 'agent failed', prod_behavior: '', fix: '' })
))

phase('Synthesize')
const report = await agent(
  `Summarize these clip-skill bug classifications for the engineer. brainrot was already confirmed a FALSE POSITIVE by direct read (clipEditPlanner.ts:242 skips composite_bg without bgId; the harness passed no bgId).

VERDICTS: ${JSON.stringify(verdicts.filter(Boolean), null, 2)}

Produce: (1) a table skill -> REAL BUG / FALSE POSITIVE / CRASH with the one-line reason; (2) the REAL bugs only, each with its fix; (3) which were false positives (harness config gaps or wrong CV expectations) so we don't waste time "fixing" them. Be terse and decisive.`,
  { label: 'synth', phase: 'Synthesize', effort: 'medium' },
)
return { verdicts: verdicts.filter(Boolean), report }
