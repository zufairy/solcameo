// V2 — "OBSESSED" · grind / discipline angle · creators vs the grind · rockstar (remix) 146.2s→
import * as L from './lib.js';
const { K, D, X, W, H, BT, HB, BIG, MID, HUGE, word, clamp, E } = L;
const BULL = ['cf10', 'cf11', 'cf62', 'cf93', 'cf123', 'cf78'];          // B/W boxer close-ups
const RUN = ['cf24', 'cf1', 'cf64', 'cf97', 'cf108', 'cf19'];            // runner, ship, cyclist — lonely journey
const CHAMP = ['cf57', 'cf63', 'cf65', 'cf80', 'cf35', 'cf129', 'cf103', 'cf126'];
const GRIND = ['cf147', 'cf86', 'cf0', 'cf7', 'cf88', 'cf58', 'cf23', 'cf8'];
const CREATE = ['creator', 'edit', 'creator2', 'head', 'bokeh', 'x_laptop', 'city'];
const S = (b) => K(b);
const SC = [
  [S(0), (u, t) => L.roll(u, t, { clips: BULL, step: BT, face: true, fh: 0.32, dark: 0.45, lines: [[17, 0.3, { maxw: 4 }]], hud: true, hudLabel: 'OBSESSION — 01', tag: 'DRIVE 100%' })],
  [S(9.5), (u, t) => L.roll(u, t, { clips: RUN, step: BT, dark: 0.4, lines: [[18, 0.05, { hold: 0.3 }]] })],
  [S(12), (u, t) => L.roll(u, t, { clips: CHAMP, step: HB, face: true, fh: 0.34, dark: 0.42, lines: [[226, 0.05], [227, 1.9]], hud: true, hudLabel: 'WINNERS ONLY', tag: 'OBSESSED ▲' })],
  [S(19.5), u => L.windowSq(u, { clips: CREATE, hud: 'THE GRIND', dx: 300, out: [['every creator', 0.1, { size: 96 }], ['knows the grind.', 0.9, { size: 84 }]], in: [['film. edit.', 2.0], ['post. repeat.', 3.0]] })],
  [S(27), (u, t) => L.roll(u, t, { clips: GRIND, step: HB / 2, dark: 0.35, lines: [[84, 0.02, { size: HUGE }], [85, 0.4]], zs: 0.25 })],
  [S(29), u => L.logoCard(u, { hud: 'VELLO — NEVER SLEEPS' })],
  [S(31), u => L.wall(u, { clips: ['creator', 'cf147', 'edit', 'city', 'x_laptop', 'head', 'creator2', 'aerial', 'cf19'], badge: '● AGENT ONLINE', words: [['your agent', 0.05], ['never', 0.75], ['sleeps.', 1.25]] })],
  [S(35), (u, t) => L.roll(u, t, { clips: ['cf147', 'cf57', 'creator', 'cf86', 'edit', 'cf80', 'head', 'cf0'], step: HB, dark: 0.4, lines: [[106, 0.05]], hud: true, hudLabel: 'CHAMPIONS — DAILY' })],
  [S(40), u => { L.film(u < D(40, 43) ? 'x_corr' : 'cf63', u < D(40, 43) ? u : u - D(40, 43), { dark: 0.4, zs: 0.05 }); L.gthumbs(u, [L.JD[0], 'creator', L.JD[2], 'edit', L.JD[4], L.JD[1]], L.SPOTS4, 0.2);
    const two = u >= 1.7; word(X, two ? 'you keep' : 'your agent', W / 2, H / 2 - 70, BIG + 10, two ? u - 1.7 : u - 0.1, { align: 'center' }); word(X, two ? 'the reward.' : 'does the grind.', W / 2, H / 2 + 70, BIG + 10, two ? u - 2.2 : u - 0.6, { align: 'center', w: 600 }); }],
  [S(46), u => L.punch(u, { words: [['clip.', ['cf0', 'creator']], ['post.', ['cf7', 'edit']], ['earn.', ['x_count', 'cf57']], ['repeat.', ['cf147', 'cf35']]] })],
  [S(50), u => L.map(u, { T: D(50, 56), gap: 0.2, clips: ['creator', 'cf57', 'head', 'cf126', 'city', 'cf147', 'creator2', 'cf24', 'edit', 'cf103', 'bokeh', 'cf65'], words: [['every clip.', 0.05], ['every country.', D(50, 51.6)], ['paid per view.', D(50, 53)]] })],
  [S(56), (u, t) => L.roll(u, t, { clips: GRIND, step: HB, dark: 0.42, lines: [[505, 0.1, { maxw: 4 }]], hud: true, hudLabel: 'DISCIPLINE > REGRET' })],
  [S(62), (u, t) => L.roll(u, t, { clips: BULL.concat(['cf129', 'cf80']), step: HB, face: true, fh: 0.32, dark: 0.42, lines: [[277, 0.05, { trim: 0.9 }], [11, 2.75]], tag: 'UNSTOPPABLE' })],
  [S(69), u => L.windowSq(u, { clips: ['cf147', 'creator', 'cf57', 'edit', 'cf24', 'head'], hud: 'STAY OBSESSED', out: [['stay obsessed.', 0.1]], in: [['let your agent', 1.1], ['grind.', 1.6]] })],
  [S(74), (u, t) => L.roll(u, t, { clips: ['cf113', 'cf136', 'cf139', 'cf146', 'cf120'], step: HB, face: true, fh: 0.36, dark: 0.42, lines: [[609, 0.05], [183, 1.45]], tag: 'DANGEROUS' })],
  [S(78), u => L.bigWord(u, { lines: [['you in?', 0.05]] })],
  [S(82), (u, t) => L.endFlash(u, t, { tagline: 'winning is for the obsessed.', clips: ['cf10', 'cf147', 'cf57', 'cf80', 'cf24', 'cf62', 'cf129', 'cf0'] })],
];
export const SHOTS = SC;
export const CUTS = [9.5, 12, 19.5, 27, 29, 31, 35, 40, 46, 50, 56, 62, 69, 74, 78, 82];
export const NBEATS = 93;
export const DUR = K(92) + 0.4;
export function wantFlash(k) {
  if (CUTS.includes(k)) return true;
  if (k < 27) return k % 4 === 2;
  if (k < 29) return true;               // pre-drop stutter
  if (k < 62) return k % 2 === 0;
  if (k < 82) return k % 2 === 1;
  return false;
}
