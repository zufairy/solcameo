// V8 — "HOW IT WORKS" · attention-economy explainer in 3 chapters · let me know (Juice WRLD remix) · mask-up editorial type, outline numerals
import * as L from './lib2.js';
const { K, D, X, W, H, BIG, MID, HUGE, word, clamp, E } = L;
const BT = 0.464, HB = BT, o = { bt: BT * 2, hb: BT };
const S = K;
const CULT = ['x_cheer', 'fvf11', 'pplanes26', 'sn_arms', 'x_yacht', 'cf126', 'fvf12', 'tgm30', 'x_houseyell', 'ski29'];
function punchK(u, words, beat) { const k = Math.min(words.length - 1, Math.floor(u / beat)), lu = u - k * beat, [w, cl] = words[k], h = Math.floor(lu / (beat / 2));
  L.film(cl[h % cl.length], lu - h * beat / 2, { dark: 0.25, zs: 0.2 }); L.slamText(w, W / 2, H / 2, HUGE + 30, lu - 0.01); L.trackLines(u); }
const SC = [
  [S(0), u => { L.montage(u, CULT, BT / 2, { dark: 0.35, zs: 0.2 }); L.maskText('the internet', W / 2, H / 2 - 60, BIG + 10, u - 0.2, {}); L.maskText('runs on attention.', W / 2, H / 2 + 70, BIG + 10, u - 0.7, { w: 700 }); L.trackLines(u); }],
  [S(8), u => L.terminal(u, { clip: 'sn_laptop', hud: 'VELLO // EXPLAINER', lines: [['> how the attention economy works', 0.1], ['> 3 steps · 145 countries · paid per view', 0.9, '#C8FF00']], big: 'how it works.', bigAt: 1.2 })],
  [S(14), u => L.chapter(u, { n: '01', title: 'a brand drops a brief.', sub: 'audience · budget · 145 countries', clip: 'sn_laptop' })],
  [S(22), u => L.chapter(u, { n: '02', title: 'agents create, edit, post.', sub: 'in 145 countries — at once', clip: 'creator' })],
  [S(33), u => L.wall(u, Object.assign({ clips: ['creator', 'edit', 'head', 'creator2', 'x_laptop', 'city', 'bokeh'], badge: '● AGENT LIVE', words: [['at once.', 0.05]] }, o))],
  [S(37), u => L.chapter(u, { n: '03', light: true, title: 'every verified view gets paid.', sub: 'settled on solana · x402', clip: 'x_count' })],
  [S(45), (u, t) => L.roll2(u, t, { clips: ['fvf11', 'fvf12', 'fvf3', 'fvf5', 'pplanes27', 'tgm30'], step: BT, style: 'mask', lines: [[589, 0.05], [321, 1.4]], hud: true, hudLabel: 'CULTURE // SPEED' })],
  [S(54), u => L.map(u, { T: D(54, 63), clips: ['creator', 'x_party', 'head', 'x_cheer', 'city', 'fvf5', 'creator2', 'x_flag', 'edit', 'ski29', 'bokeh', 'tgm5'], words: [['1 brief.', 0.05], ['145 countries.', 1.4], ['millions of views.', 2.8]] })],
  [S(63), (u, t) => L.roll2(u, t, { clips: ['fvf6', 'fvf5', 'x_cheer', 'cf80', 'fvf12'], step: BT, style: 'slam', lines: [[345, 0.05], [346, 1.15], [347, 1.6]], tag: 'WIN' })],
  [S(69), u => L.proof(u, { t1: D(69, 73), t2: D(69, 77.5), tiles: [...L.JD, 'x_ph3', 'x_jonah', 'x_party', 'creator', 'head'], flip: ['x_counter', 'x_crowd2', 'x_counter', 'fvf5', 'x_counter', 'x_cheer'] })],
  [S(81), (u, t) => L.roll2(u, t, { clips: ['creator', 'edit', 'head', 'creator2'], step: BT, style: 'scramble', lines: [[348, 0.05], [112, 0.9]], hud: true, hudLabel: 'AGENT // ALWAYS ON' })],
  [S(87), u => punchK(u, [['brief.', ['sn_laptop', 'x_laptop']], ['create.', ['creator', 'edit']], ['post.', ['creator2', 'head']], ['paid.', ['x_count', 'x_bill2']]], BT * 2)],
  [S(95), u => L.beforeAfter(u, { left: 'x_ph3', right: 'creator', lt: 'old internet.', rt: 'attention economy.' })],
  [S(103), u => L.chrome(u, { text: 'one brief. every screen.', hud: 'VELLO // CORE' })],
  [S(111), (u, t) => L.endCine(u, t, { clips: ['sn_laptop', 'creator', 'x_count', 'fvf12', 'x_cheer'], step: 1.2, montage: 4.8, line: ['brief. agents. paid.', 0.3], logo: 'wipe', tagline: "that's the attention economy.", bgClip: 'creator', fadeAt: 7.8 })],
];
export const SHOTS = SC;
export const CUTS = [8, 14, 22, 33, 37, 45, 54, 63, 69, 81, 87, 95, 103];
export const NBEATS = 145;
export const DUR = 67.9;
export function wantFlash(k) { if (CUTS.includes(k)) return true; if (k < 8) return k % 2 === 0; if (k < 37) return false; if (k < 111) return k % 4 === 0; return false; }
