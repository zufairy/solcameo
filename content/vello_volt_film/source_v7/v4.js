// V4 — "METAMORPHOSIS" · transformation: broke clipper → operator · phonk (METAMORPHOSIS edit) · scramble/decode type
import * as L from './lib2.js';
const { K, D, X, W, H, BIG, MID, HUGE, word, clamp, E } = L;
const BT = 0.696, HB = BT / 2, o = { bt: BT, hb: HB };
const DRONES = ['ski13', 'ski19', 'ski20', 'ski22', 'ski24', 'ski43'];
const S = K;
const SC = [
  [S(0), u => { L.bg('#050505'); X.save(); X.globalAlpha = 0.35; L.film(u < 1.4 ? 'cf1' : 'x_laptop', u, { zs: 0.04 }); X.restore(); L.letterbox(1);
    L.scramble('day 1.', W / 2, H / 2 - 50, HUGE, u - 0.2, { align: 'center', w: 700 }); L.typeMono('0 VIEWS · 0 FOLLOWERS · $0', W / 2, H / 2 + 90, 30, u - 1.1, { align: 'center', color: '#C8FF00' }); L.trackLines(u, 'rgba(255,255,255,0.35)', 'BEFORE'); }],
  [S(3), (u, t) => L.roll2(u, t, { clips: DRONES, step: BT, face: true, fh: 0.34, style: 'scramble', lb: 1, lines: [[595, 0.05], [596, 1.7], [597, 2.5]], tag: 'STATUS: STUCK' })],
  [S(9), (u, t) => L.roll2(u, t, { clips: ['cf10', 'cf62', 'cf93', 'cf123'], step: BT, face: true, fh: 0.32, dark: 0.5, style: 'scramble', lines: [[467, 0.2]], tag: 'LOWEST POINT' })],
  [S(14), u => L.terminal(u, { clip: 'x_laptop', hud: 'VELLO://AGENT_01', lines: [['> deploying agent_01', 0.05], ['> sources: 145 countries', 0.45], ['> edit: auto   post: auto', 0.85], ['> status: LIVE', 1.25, '#C8FF00']], big: 'agent online.', bigAt: 1.3 })],
  [S(17), (u, t) => L.roll2(u, t, { clips: ['x_floor2', 'x_mic', 'x_smile', 'x_toast'], step: HB, face: true, fh: 0.36, style: 'slam', lines: [[358, 0.05]], tag: 'NEW IDENTITY' })],
  [S(20), (u, t) => L.roll2(u, t, { clips: ['cf0', 'cf7', 'cf88', 'cf58'], step: HB, style: 'mask', lines: [[412, 0.05]], hud: true, hudLabel: 'REBUILD' })],
  [S(23), u => L.wall(u, Object.assign({ clips: ['creator', 'x_parker', 'edit', 'city', 'x_laptop', 'head', 'creator2'], badge: '● AGENT_01 POSTED', words: [['clip.', 0.05], ['post.', D(23, 24.5)], ['paid.', D(23, 26)]] }, o))],
  [S(27), (u, t) => L.roll2(u, t, { clips: ['cf136', 'cf139', 'cf121', 'cf2'], step: HB, face: true, fh: 0.36, style: 'scramble', lines: [[181, 0.05], [182, 1.4]], tag: 'TRANSFORMING' })],
  // break — the chrysalis
  [S(32), (u, t) => { L.roll2(u, t, { clips: ['cf1', 'cf24', 'ski15', 'ski33', 'cf97'], step: BT * 2, dark: 0.45, style: 'track', lb: 1, lines: [[230, 0.3, { maxw: 4, size: 76 }]] });
    if (u > 6.5) { L.maskText('same guy.', W / 2, H / 2 - 60, BIG, u - 6.6, {}); L.maskText('new system.', W / 2, H / 2 + 70, BIG, u - 7.3, { w: 700 }); } }],
  [S(46), u => L.logoCard(u, { hud: 'VELLO — METAMORPHOSIS' })],
  [S(48), (u, t) => L.roll2(u, t, { clips: ['x_cheer', 'x_glass', 'x_yell', 'x_helmet', 'x_houseyell'], step: HB, face: true, fh: 0.34, style: 'slam', lines: [[345, 0.05], [346, 1.2]], tag: 'AFTER' })],
  [S(51), u => L.terminal(u, { clip: 'x_laptop', hud: 'VELLO://AGENT_01 · DAY 90', lines: [['> agent_01 · day 90', 0.05], ['> videos_produced: 5,000+', 0.9], ['> agents_minted (24h): 100+', 2.3], ['> GET velloagents.com → 503 too many agents', 3.9, '#ffffff']], big: 'the site went down.', bigAt: 4.3 })],
  [S(59), u => L.map(u, { T: D(59, 64), clips: ['creator', 'x_party', 'head', 'x_cheer', 'city', 'x_toast', 'creator2', 'x_flag', 'edit', 'x_shades', 'bokeh', 'x_smile'], words: [['1 agent.', 0.05], ['145 countries.', D(59, 61)]] })],
  [S(64), u => L.dlgWin(u, { clip: 'd_jcrazy', crop: { zoom: 1.55, zx: 0.68, zy: 0.05 }, hud: 'AFTER', lines: [["you're looking", 0.1, { y: 400, size: BIG - 10 }], ['at me like', 0.45, { y: 520, size: BIG - 10 }], ["i'm crazy.", 0.85, { y: 640, size: BIG - 10, color: '#9a9a9a' }]] })],
  [S(67), u => { const cut = 1.25; if (u < cut) { L.film('d_max', u + 0.35, { zoom: 1.95, zx: 0.1, zy: 0.12, zs: 0.03, dark: 0.3 }); L.slamText('crazy?', W / 2, H / 2, HUGE, u - 0.05); }
    else { const lu = u - cut, i = Math.floor(lu / (HB / 2)); L.film(['x_watch', 'x_boat3', 'x_ferrari', 'x_count', 'x_yacht', 'x_throw', 'x_bill', 'x_party'][i % 8], lu % (HB / 2), { dark: 0.35, zs: 0.3 });
      L.counter(1000 + 9.8e6 * E.inCubic(clamp(lu / 1.4)), W / 2, H / 2 - 60, HUGE, 1, { align: 'center', pre: '▲ ' }); L.maskText('this is obscene.', W / 2, H / 2 + 110, BIG - 10, lu - 0.15, {}); }
    L.trackLines(u); }],
  [S(71), (u, t) => L.roll2(u, t, { clips: ['x_floor2', 'x_point', 'x_chair', 'x_toast'], step: HB, face: true, fh: 0.36, style: 'mask', lines: [[590, 0.05, { maxw: 4, size: 92 }]], tag: 'BECOMING' })],
  [S(77), u => { L.montage(u, ['x_count', 'x_bill2', 'x_boat2', 'x_throw', 'x_watch', 'x_box'], HB, { dark: 0.5, zs: 0.15 }); L.scramble('paid out', W / 2, H / 2 - 70, HUGE - 10, u - 0.35, { align: 'center', w: 700 }); L.scramble('in seconds.', W / 2, H / 2 + 90, HUGE - 10, u - 0.95, { align: 'center', w: 700 }); L.typeMono('SETTLED ON SOLANA · x402', W / 2, H - 175, 28, u - 1.6, { align: 'center', color: '#C8FF00' }); L.trackLines(u); }],
  [S(82), u => L.beforeAfter(u, { left: 'ski20', right: 'x_yacht2' })],
  [S(87), (u, t) => L.roll2(u, t, { clips: ['cf8', 'cf35', 'cf80', 'cf129'], step: HB, face: true, fh: 0.33, style: 'slam', lines: [[469, 0.05]], tag: 'NEVER QUIT' })],
  [S(91), u => L.chrome(u, { text: 'same you. new system.', hud: 'VELLO // AGENT CORE' })],
  [S(96), (u, t) => L.endCine(u, t, { clips: ['x_balc', 'x_yacht', 'cf24', 'ski35', 'x_mansion'], step: 1.4, montage: 4.2, line: ['metamorphosis complete.', 0.3], logo: 'scramble', tagline: 'same you. new system.', bgClip: 'x_yacht2', fadeAt: 6.6 })],
];
export const SHOTS = SC;
export const CUTS = [3, 9, 14, 17, 20, 23, 27, 32, 46, 48, 51, 59, 64, 67, 71, 77, 82, 87, 91];
export const NBEATS = 110;
export const DUR = 74.6;
export function wantFlash(k) { if (CUTS.includes(k)) return true; if (k < 14) return false; if (k < 32) return k % 2 === 0; if (k < 46) return false; if (k < 96) return k % 2 === 0; return false; }
