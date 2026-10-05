// V3 — "WHAT IF" · FOMO / opportunity / speed & culture · two drops · rockstar (remix) 118.0s→
import * as L from './lib.js';
const { K, D, X, W, H, BT, HB, BIG, MID, HUGE, word, clamp, E } = L;
const SPEED = ['jet', 'car', 'warp', 'x_ferrari', 'cf100', 'aerial', 'city', 'x_yacht2', 'chrome', 'runner'];
const OPP = ['sn_parker2', 'sn_arms', 'x_houseyell', 'cf126', 'cf103', 'sn_walk2', 'x_point'];
const FIGHT = ['cf8', 'cf35', 'cf80', 'x_ferrari', 'jet', 'cf103', 'cf126', 'car', 'cf129'];
const LONE = ['cf1', 'cf24', 'cf64', 'cf19', 'cf108', 'sn_window'];
const S = (b) => K(b);
const SC = [
  [S(0), u => L.dlgWin(u, { clip: 'sn_parker1', crop: { zoom: 1.8, zx: 0.42, zy: 0.02 }, hud: 'PALO ALTO — 2004', lines: [['a million dollars', 0.45, { y: 380, size: BIG - 10 }], ["isn't cool.", 1.05, { y: 500, size: BIG - 10 }], ["you know what's cool?", 1.7, { y: 640, size: MID + 6, color: '#9a9a9a' }]] })],
  [S(4), (u, t) => { L.montage(u, ['sn_parker2', 'sn_andrew'], 0.7, { face: true, t, fh: 0.36, dark: 0.4, label: 'SUBJECT_01', tag: 'VALUATION ▲' }); word(X, 'a billion dollars.', W / 2, H / 2, HUGE - 20, u - 0.2, { align: 'center', w: 600 }); L.trackLines(u); }],
  [S(6.5), u => L.windowSq(u, { clips: SPEED, hud: 'NOW', out: [['not a billion', 0.1], ['dollars.', 0.6]], in: [['a billion', 1.65], ['views.', 1.95]] })],
  [S(13), u => L.logoCard(u, { sub: 'a billion views.', hud: 'VELLO — WHAT IF' })],
  [S(15), u => { L.montage(u, SPEED, HB / 2, { dark: 0.35, zs: 0.25 }); word(X, 'attention is', W / 2, H / 2 - 70, BIG + 10, u - 0.1, { align: 'center' }); word(X, 'the new oil.', W / 2, H / 2 + 70, BIG + 10, u - 0.85, { align: 'center', w: 600 }); L.trackLines(u, 'rgba(255,255,255,0.4)', 'ATTENTION / BBL'); }],
  [S(19), (u, t) => L.roll(u, t, { clips: OPP, step: HB, face: true, fh: 0.34, lines: [[538, 0.05]], hud: true, hudLabel: 'OPPORTUNITY — NOW', tag: 'WINDOW OPEN' })],
  [S(25), u => L.map(u, { T: D(25, 34), gap: 0.3, clips: ['creator', 'sn_laptop', 'head', 'x_cheer', 'city', 'cf126', 'creator2', 'x_flag', 'edit', 'cf103', 'bokeh', 'sn_crowd'], words: [['one brief.', 0.05], ['145 countries.', 1.3], ['clips. posts.', 2.7], ['gets paid.', 4.1]] })],
  [S(34), (u, t) => L.roll(u, t, { clips: FIGHT, step: HB, face: true, fh: 0.34, lines: [[71, 0.05], [74, 1.75]], hud: true, hudLabel: 'RISK — ON', tag: 'DIFFERENT ▲' })],
  [S(41.5), u => L.solanaWin(u, { clips: ['x_count', 'jet', 'x_boat2', 'cf103', 'x_bill2', 'car', 'x_yacht2', 'x_throw'] })],
  // breakdown — the what-if
  [S(46.6), (u, t) => L.roll(u, t, { clips: LONE, step: BT, dark: 0.5, lines: [[262, 0.2, { maxw: 4 }]], hud: true, hudLabel: 'WHAT IF —' })],
  [S(52), (u, t) => { const late = u >= 5.45; L.roll(u, t, { clips: late ? ['sn_crowd', 'sn_laptop', 'x_cheer'] : ['cf113', 'cf114', 'cf117', 'cf136', 'sn_window', 'cf149', 'sn_zuck'], step: late ? HB : BT, face: !late, fh: 0.36, dark: 0.5, lines: [[582, 0.1, { trim: 0.8, maxw: 4 }]], tag: 'NO REGRETS' });
    if (late) { word(X, 'everyone says', W / 2, H / 2 - 70, BIG, u - 5.5, { align: 'center' }); word(X, 'they were early.', W / 2, H / 2 + 70, BIG, u - 6.1, { align: 'center', color: '#bdbdbd' }); } }],
  [S(64), (u, t) => L.roll(u, t, { clips: ['cf24', 'cf19', 'runner', 'jet', 'cf100', 'sn_walk2', 'car', 'cf97'], step: HB, dark: 0.42, lines: [[383, 0.1], [5, 2.5]], hud: true, hudLabel: 'TODAY' })],
  [S(72), u => L.bigWord(u, { light: true, lines: [['be early.', 0.25]] })],
  // drop 2 — the loss vs what-if, flashing
  [S(76), (u, t) => L.roll(u, t, { clips: ['x_cheer', 'x_glass', 'cf80', 'x_houseyell', 'sn_arms', 'x_yacht', 'cf126', 'x_boat2', 'jet', 'cf35'], step: HB / 2, dark: 0.4, zs: 0.3, lines: [[271, 0.05], [272, 2.2]] })],
  [S(81), (u, t) => L.endFlash(u, t, { tagline: 'be early.', clips: ['jet', 'x_cheer', 'sn_arms', 'cf80', 'x_ferrari', 'cf126', 'x_yacht', 'car'] })],
];
export const SHOTS = SC;
export const CUTS = [4, 6.5, 13, 15, 19, 25, 34, 41.5, 46.6, 52, 64, 72, 76, 81];
export const NBEATS = 93;
export const DUR = K(92) + 0.5;
export function wantFlash(k) {
  if (CUTS.includes(k)) return true;
  if (k < 13) return false;
  if (k < 46) return k % 2 === 0;
  if (k < 72) return false;              // breakdown — let the words breathe
  if (k < 76) return true;               // build stutter
  if (k < 81) return true;               // drop 2: every beat
  return false;
}
