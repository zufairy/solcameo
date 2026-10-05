// V1 — "THE NEW MONEY" · Wolf of Wall Street angle · money-minded · rockstar (remix) 40.6s→
import * as L from './lib.js';
const { K, D, X, W, H, BT, HB, BIG, MID, HUGE, word, clamp, E } = L;
const JORDAN = ['x_floor2', 'x_smile', 'x_toast', 'x_mic', 'x_chair', 'x_floor', 'x_point', 'x_house'];
const BOX = ['cf8', 'cf35', 'cf58', 'cf80', 'cf129', 'cf23'];
const CHEER = ['x_cheer', 'x_glass', 'x_yell', 'x_helmet', 'x_crowd2', 'x_armsb', 'x_scream', 'x_houseyell'];
const MONEY = ['x_boat1', 'x_count', 'x_throw', 'x_bill2', 'x_party', 'x_flag', 'x_watch', 'x_box', 'x_boat3', 'x_toast'];
const NEW = ['creator', 'head', 'city', 'creator2', 'edit', 'bokeh', 'aerial', 'runner'];
const S = (b) => K(b);
function rollAt(b, o) { return (u, t) => L.roll(u, t, o); }

const SC = [
  [S(0), u => L.dlgWin(u, { clip: 'd_donnie1', crop: { zoom: 2.0, zx: 0.08, zy: 0 }, lines: [['how much', 0.25, { y: 330 }], ['money', 0.45, { y: 470 }], ['you make?', 0.75, { y: 610, color: '#9a9a9a' }]] })],
  [S(4), u => L.dlgWin(u, { clip: 'd_jordan1', light: true, side: 'left', crop: { zoom: 1.7, zx: 0.62, zy: 0.08 }, count: { v: 70000, at: 0.75, pre: '$', y: 450 }, lines: [['last month.', 1.5, { y: 610, size: MID + 6, color: '#555' }]] })],
  [S(9), u => L.dlgWin(u, { clip: 'd_donnie2', crop: { zoom: 2.15, zx: 0.06, zy: 0 }, count: { v: 72000, at: 0.12, pre: '$', y: 470, dur: 0.01 }, lines: [['a month?', 0.6, { y: 620, size: MID + 6, color: '#9a9a9a' }]] })],
  [S(12) - 0.05, u => L.dlgWin(u, { clip: 'd_donnie3', light: true, crop: { zoom: 2.15, zx: 0.06, zy: 0 }, lines: [['yeah.', 0, { y: 540, size: HUGE + 20, w: 600 }]] })],
  // audio roll: money mindset over face-tracked Jordan, then risk takers over boxing
  [S(14), (u, t) => { const two = u >= 1.95; L.roll(u, t, { clips: two ? BOX : JORDAN, step: HB, face: !two, fh: 0.36, hud: true, hudLabel: 'MINDSET — LOCKED', lines: [[168, 0.1], [71, 2.0]], tag: two ? 'RISK ▲' : 'NET WORTH ▲' }); }],
  [S(20), u => L.windowSq(u, { clips: NEW, out: [['the new money', 0.05]], in: [['sells', 1.0], ['attention.', 1.25]] })],
  [S(24), u => L.wall(u, { clips: ['creator', 'x_parker', 'edit', 'city', 'x_laptop', 'head', 'creator2', 'aerial'], words: [['clip it.', 0], ['post it.', D(24, 25.5)], ['everywhere.', D(24, 27)]] })],
  [S(29), u => L.logoCard(u, { hud: 'VELLO — THE NEW MONEY' })],
  [S(31), (u, t) => { const sleep = u >= D(31, 33.6); L.montage(u, sleep ? ['x_yacht', 'x_pool', 'x_yacht2', 'x_mansion', 'x_balc', 'x_shades'] : CHEER, HB, { dark: 0.3, zs: 0.12 });
    if (!sleep) { word(X, 'paid for', W / 2, H / 2 - 70, BIG + 10, u - 0.15, { align: 'center' }); word(X, 'every view.', W / 2, H / 2 + 70, BIG + 10, u - 0.6, { align: 'center' }); }
    else word(X, 'while you sleep.', W / 2, H / 2, BIG + 10, u - D(31, 33.6), { align: 'center' }); }],
  [S(35), u => { const two = u >= D(35, 37); L.film(two ? 'x_stage' : 'x_corr', two ? u - D(35, 37) : u, { dark: 0.35, zs: 0.05 }); L.gthumbs(u, [L.JD[0], 'x_ph3', L.JD[2], 'x_jonah', L.JD[4], L.JD[1]], L.SPOTS4, 0.2); word(X, two ? 'clips out.' : 'brief in.', W / 2, H / 2, BIG + 30, two ? u - D(35, 37) : u - 0.05, { align: 'center', w: 600 }); }],
  [S(39), (u, t) => L.roll(u, t, { clips: MONEY, step: HB, dark: 0.35, lines: [[106, 0.05]], hud: true, hudLabel: 'CHAMPIONS — DAILY' })],
  [S(44), u => L.punch(u, { words: [['clip.', ['x_boat1', 'x_boat2']], ['post.', ['x_boat3', 'x_flag']], ['earn.', ['x_count', 'x_bill2']], ['repeat.', ['x_throw', 'x_party']]] })],
  [S(48), u => L.proof(u, { t1: D(48, 51), t2: D(48, 54.5), tiles: [...L.JD, 'x_ph3', 'x_jonah', 'x_party', 'creator', 'head'], flip: ['x_counter', 'x_crowd2', 'x_counter', 'x_helmet', 'x_counter', 'x_cheer'] })],
  [S(57), u => L.map(u, { T: D(57, 61), clips: ['creator', 'x_party', 'head', 'x_cheer', 'city', 'x_toast', 'creator2', 'x_flag', 'edit', 'x_shades', 'bokeh', 'x_smile'], words: [['1 agent.', 0.05], ['145 countries.', D(57, 59)]] })],
  [S(61), u => L.solanaWin(u, { clips: ['x_count', 'x_bill2', 'x_boat2', 'x_watch', 'x_box', 'x_throw', 'x_yacht2', 'x_toast'] })],
  [S(65), u => L.dlgWin(u, { clip: 'd_jcrazy', crop: { zoom: 1.55, zx: 0.68, zy: 0.05 }, hud: 'THE NEW MONEY', lines: [["you're looking", 0.1, { y: 400, size: BIG - 10 }], ['at me like', 0.45, { y: 520, size: BIG - 10 }], ["i'm crazy.", 0.85, { y: 640, size: BIG - 10, color: '#9a9a9a' }]] })],
  [S(68), u => { const cut = 1.25; if (u < cut) { L.film('d_max', u + 0.35, { zoom: 1.95, zx: 0.1, zy: 0.12, zs: 0.03, dark: 0.3 }); word(X, 'crazy?', W / 2, H / 2, HUGE, u - 0.05, { align: 'center', w: 600 }); }
    else { const lu = u - cut, i = Math.floor(lu / (HB / 2)); L.film(['x_watch', 'x_boat3', 'x_ferrari', 'x_count', 'x_yacht', 'x_throw', 'x_bill', 'x_party'][i % 8], lu % (HB / 2), { dark: 0.35, zs: 0.3 });
      L.counter(1000 + 9.8e6 * E.inCubic(clamp(lu / 1.4)), W / 2, H / 2 - 60, HUGE, 1, { align: 'center', pre: '▲ ' }); word(X, 'this is obscene.', W / 2, H / 2 + 110, BIG - 10, lu - 0.15, { align: 'center' }); }
    L.trackLines(u); }],
  [S(72), (u, t) => { const two = u >= 1.6; L.montage(u, two ? ['x_stage', 'x_glass', 'x_floor2'] : ['x_floor2', 'x_floor'], two ? BT : HB, { dark: 0.42, face: true, t, fh: 0.34, label: 'SUBJECT_01', tag: 'DELUSION 100%' });
    if (!two) word(X, 'complete delusion.', W / 2, H / 2, BIG + 10, u - 0.2, { align: 'center' });
    else { word(X, "it's only delusional", W / 2, H / 2 - 70, BIG + 10, u - 1.75, { align: 'center' }); word(X, 'until it works.', W / 2, H / 2 + 80, BIG + 10, u - 2.9, { align: 'center', w: 600 }); }
    L.trackLines(u, 'rgba(255,255,255,0.4)'); }],
  [S(79), (u, t) => L.roll(u, t, { clips: ['sn_parker2', 'x_houseyell', 'sn_arms', 'x_point', 'cf126', 'x_yell', 'sn_walk'], step: HB, face: true, fh: 0.34, lines: [[538, 0.05]], hud: true, hudLabel: 'OPPORTUNITY — NOW', tag: 'WINDOW OPEN' })],
  [S(85), (u, t) => { if (u < D(85, 87.5)) L.roll(u, t, { clips: ['x_toast', 'x_smile', 'x_floor2', 'x_chair'], step: HB, face: true, fh: 0.38, lines: [[509, 0.05], [510, 0.9]], tag: 'TRUST ▲' });
    else { const lu = u - D(85, 87.5); L.bigWord(lu, { lines: [['you in?', 0]] }); } }],
  [S(89), (u, t) => L.endFlash(u, t, { tagline: 'the new money is attention.', clips: ['x_cheer', 'x_boat2', 'x_count', 'x_glass', 'x_yacht', 'x_throw', 'x_houseyell', 'x_party'] })],
];
export const SHOTS = SC;
export const CUTS = [4, 9, 12, 14, 20, 24, 29, 31, 35, 39, 44, 48, 57, 61, 65, 68, 72, 79, 85, 89];
export const NBEATS = 100;
export const DUR = K(100) + 0.3;
export function wantFlash(k) {
  if (CUTS.includes(k)) return true;
  if (k < 29) return k % 4 === 2;
  if (k < 65) return k % 2 === 0;
  if (k < 79) return false;
  if (k < 89) return k % 2 === 1;
  return false; // end sequence flashes itself
}
