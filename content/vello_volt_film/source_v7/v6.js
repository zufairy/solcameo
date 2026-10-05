// V6 — "NEVER" · builder's persistence · Elon / SpaceX · Gangsta's Paradise (Tate) · telemetry + outline numerals
import * as L from './lib2.js';
const { K, D, X, W, H, BIG, MID, HUGE, word, clamp, E } = L;
const BT = 0.743, HB = BT / 2, o = { bt: BT, hb: HB };
const S = K;
const FAIL = ['elon23', 'elon5', 'elon28', 'elon7', 'elon30', 'elon8', 'elon1', 'elon9', 'elon17'];
const SC = [
  [S(0), (u, t) => { const i = Math.floor(u / BT); L.roll2(u, t, { clips: FAIL, step: BT, face: true, fh: 0.36, style: 'kinetic', lb: 1, lines: [['E17', 0.3, { maxw: 4, size: 96 }]], tag: 'INTERVIEW // 2016' });
    const fails = Math.min(3, Math.floor((i + 1) / 2)); L.typeMono(`FAILURES: ${fails}/3`, 140, 170, 26, 1, { color: '#C8FF00' }); }],
  [S(9.5), (u, t) => { L.faceShot('elon28', u, { t, fh: 0.42, dark: 0.3, label: 'SUBJECT_01', tag: 'RESOLVE 100%' }); L.slamText('never.', W / 2, H / 2, HUGE + 40, u - 0.06); }],
  [S(12), (u, t) => L.roll2(u, t, { clips: ['elon30', 'elon32'], step: BT * 2, face: true, fh: 0.38, style: 'slam', lines: [['E19', 0.05], ['E20', 1.0]], tag: 'NEVER QUITS' })],
  [S(16), (u, t) => L.telemetry(u, t, { clips: ['elon33', 'elon34', 'elon35', 'elon44', 'elon45', 'elon36'], step: HB, from: 10, rate: 2.6, line: 'every failure taught the next one.' })],
  [S(21), (u, t) => L.roll2(u, t, { clips: ['cf10', 'elon19', 'cf62', 'elon20', 'cf93', 'elon21'], step: HB, style: 'mask', lines: [[474, 0.05, { maxw: 4, size: 96 }]], hud: true, hudLabel: 'FAILURE // PSYCHOLOGICAL' })],
  [S(27), u => L.wall(u, Object.assign({ clips: ['creator', 'edit', 'head', 'creator2', 'x_laptop', 'city', 'bokeh'], badge: '● RETRY 3/3', words: [['post.', 0.05], ['learn.', D(27, 28.5)], ['relaunch.', D(27, 30)]] }, o))],
  // the quiet — why it matters
  [S(33), (u, t) => L.roll2(u, t, { clips: ['elon46', 'elon59', 'elon61', 'elon62', 'cf24', 'elon63'], step: BT * 2, dark: 0.4, style: 'track', lb: 1, lines: [[469, 0.3, { size: 80 }], [352, 3.2, { maxw: 4, size: 72 }]] })],
  [S(46), (u, t) => { const i = Math.floor(u / BT); L.montage(u, ['elon24', 'elon39', 'elon41', 'elon42', 'elon48', 'elon49'], BT, { dark: 0.35, zs: 0.06 }); L.letterbox(1);
    L.typeMono('FALCON 9 // TOUCHDOWN CONFIRMED', W / 2, 200, 28, u - 0.1, { upper: true, align: 'center', color: '#C8FF00' }); L.caption2('E21', u - 0.2, { style: 'mask', size: 104 }); }],
  [S(51), u => L.logoCard(u, { sub: 'launch your agent.', hud: 'VELLO — NEVER' })],
  [S(53), u => L.map(u, { T: D(53, 58), clips: ['creator', 'elon48', 'head', 'elon46', 'city', 'x_cheer', 'creator2', 'elon49', 'edit', 'cf126', 'bokeh', 'x_smile'], words: [['1 agent.', 0.05], ['145 countries.', D(53, 55)]] })],
  [S(58), u => { L.montage(u, ['elon44', 'elon48', 'elon33', 'elon49', 'elon46', 'elon52'], HB, { dark: 0.5, zs: 0.1 }); const two = u >= 2.3, three = u >= 4.4; if (!two) { L.outlineNum(Math.floor(5000 * E.outExpo(clamp(u / 1.1))).toLocaleString('en-US'), W / 2, H / 2 - 50, 240, u, { fillAt: 0.9 }); L.maskText('launches.', W / 2, H / 2 + 150, 72, u - 0.6, { w: 500 }); } else if (!three) { L.outlineNum('100+', W / 2, H / 2 - 50, 260, u - 2.3, { fillAt: 0.2 }); L.maskText('new agents. one night.', W / 2, H / 2 + 150, 64, u - 2.6, { w: 500 }); } else { L.maskText('we crashed the site.', W / 2, H / 2 - 60, 96, u - 4.4, {}); L.maskText('and kept going.', W / 2, H / 2 + 70, 96, u - 5.1, {}); } L.typeMono(three ? 'STATUS: SITE DOWN → RELAUNCHED' : 'STATUS: NOMINAL', 140, H - 140, 20, u - 0.2, { upper: true, color: '#C8FF00', cps: 80 }); L.trackLines(u, 'rgba(255,255,255,0.4)', 'LAUNCH // COUNT'); }],
  [S(66), (u, t) => L.roll2(u, t, { clips: ['elon40', 'elon52', 'elon54', 'elon57', 'elon60'], step: HB, style: 'scramble', lines: [[589, 0.05], [321, 1.5]], hud: true, hudLabel: 'BUILDERS // REWARDED' })],
  [S(72), (u, t) => L.telemetry(u, t, { clips: ['elon44', 'elon54', 'elon40', 'elon60'], from: 3, rate: 1.4, line: 'touchdown confirmed.', status: 'SETTLED · SOLANA', hud: 'TOUCHDOWN // SOLANA' })],
  [S(77), u => L.chrome(u, { clip: 'elon64', text: 'launch yours.', hud: 'VELLO // LAUNCH' })],
  [S(83), (u, t) => L.endCine(u, t, { clips: ['elon61', 'elon62', 'elon63', 'elon64', 'elon65'], step: 1.6, montage: 5.0, line: ["i don't ever give up.", 0.6], logo: 'wipe', tagline: 'launch yours.', bgClip: 'elon63', fadeAt: 5.6 })],
];
export const SHOTS = SC;
export const CUTS = [9.5, 12, 16, 21, 27, 33, 46, 51, 53, 58, 66, 72, 77];
export const NBEATS = 100;
export const DUR = 73.0;
export function wantFlash(k) { if (CUTS.includes(k)) return true; if (k < 9) return k % 2 === 1; if (k < 33) return k % 2 === 0; if (k < 51) return false; if (k < 83) return k % 2 === 0; return false; }
