// V7 — "FREEDOM" · earn anywhere · luxury, night drives, Japan salarymen escaping · Young Black & Rich (slowed) · thin tracked type, letterbox
import * as L from './lib2.js';
const { K, D, X, W, H, BIG, MID, HUGE, word, clamp, E } = L;
const BT = 0.952, HB = BT / 2, o = { bt: BT, hb: HB * 2, invert: false };
const S = K;
function seq(u, words) { let cur = null; for (const w of words) if (u >= w[1]) cur = w; return cur; }
const SC = [
  [S(0), u => { L.montage(u, ['ski13', 'ski19', 'ski20', 'ski22', 'ski24', 'ski43'], BT, { dark: 0.3, zs: 0.03, speed: 0.8 }); L.letterbox(1);
    const c = seq(u, [['9 to 5.', 0.2], ['same train.', D(0, 2)], ['same desk.', D(0, 4)]]); if (c) L.trackText(c[0], W / 2, H / 2, 92, u - c[1], { w: 300 }); L.trackLines(u, 'rgba(255,255,255,0.3)', 'TOKYO — 08:47'); }],
  [S(6), u => { L.montage(u, ['ski29', 'ski28', 'ski32', 'ski21', 'ski16'], BT, { dark: 0.3, zs: 0.05 }); L.letterbox(1);
    const c = seq(u, [['they ran.', 0.3], ["you don't have to.", D(6, 8.3)]]); if (c) L.trackText(c[0], W / 2, H / 2, 88, u - c[1], { w: 300 }); }],
  [S(12), (u, t) => L.roll2(u, t, { clips: ['freedom9', 'freedom10', 'freedom12', 'freedom14', 'freedom13'], step: BT, face: true, fh: 0.3, dark: 0.35, style: 'track', lb: 1, lines: [[170, 0.1, { maxw: 4, size: 72 }]], tag: 'NIGHT SHIFT: AGENT' })],
  [S(18), u => L.windowSq(u, Object.assign({ clips: ['freedom18', 'freedom17', 'freedom8', 'city'], hud: 'AGENT // ONLINE', out: [['your agent', 0.1, { w: 300 }]], in: [['works', 1.0, { w: 300 }], ['the night shift.', 1.4, { w: 300 }]] }, o))],
  [S(23), u => L.map(u, { T: D(23, 29), gap: 0.32, clips: ['freedom18', 'ski36', 'freedom9', 'ski24', 'city', 'freedom17', 'creator', 'ski33', 'freedom8', 'head', 'bokeh', 'ski20'], words: [['tokyo.', 0.1], ['lagos.', 1.1], ['são paulo.', 2.1], ['anywhere.', 3.1]] })],
  [S(29), (u, t) => L.roll2(u, t, { clips: ['ski33', 'ski35', 'ski36', 'ski40', 'ski41'], step: BT, dark: 0.3, style: 'track', lb: 1, lines: [[260, 0.1, { maxw: 4, size: 72 }]] })],
  [S(34), u => { L.film('freedom18', u, { speed: 0.7, zs: 0.02, dark: 0.45 }); L.letterbox(1); L.trackText('paid while you sleep.', W / 2, H / 2 - 20, 92, u - 0.2, { dur: 1.2, stagger: 0.03 }); L.trackText('ON SOLANA', W / 2, H / 2 + 90, 28, u - 1.3, { dur: 1.0, color: '#C8FF00', from: 1.2, to: 0.5 }); L.trackLines(u, 'rgba(255,255,255,0.3)', 'NIGHT SHIFT // SOLANA'); }],
  [S(38), (u, t) => L.roll2(u, t, { clips: ['freedom5', 'freedom7', 'freedom16', 'freedom6'], step: HB, face: true, fh: 0.32, style: 'track', lb: 1, lines: [[168, 0.1, { size: 76, maxw: 4 }]], tag: 'NO LIMITS' })],
  [S(41), (u, t) => L.roll2(u, t, { clips: ['fvf4', 'fvf8', 'fvf9', 'fvf11'], step: HB, face: true, fh: 0.34, style: 'track', lb: 1, lines: [[53, 0.2, { size: 80 }]], tag: '7000 RPM' })],
  [S(44), u => L.chrome(u, { clip: 'freedom9', text: 'freedom is a system.', hud: 'VELLO // FREEDOM' })],
  [S(48), u => { L.film('freedom18', u, { speed: 0.7, zs: 0.02, dark: 0.35 }); L.letterbox(1); L.trackText('earn from anywhere.', W / 2, H / 2, 90, u - 0.2, { w: 300 }); L.trackLines(u, 'rgba(255,255,255,0.3)', 'ANYWHERE // ANYTIME'); }],
  [S(53), (u, t) => L.endCine(u, t, { clips: ['freedom18', 'freedom17', 'ski36', 'freedom8'], step: 2.0, montage: 6.0, line: ['the night belongs to you.', 0.5], logo: 'fade', tagline: 'earn from anywhere.', bgClip: 'freedom18', fadeAt: 9.6 })],
];
export const SHOTS = SC;
export const CUTS = [6, 12, 18, 23, 29, 34, 38, 41, 44, 48];
export const NBEATS = 72;
export const DUR = 66.7;
export function wantFlash(k) { return [12, 18, 29, 34, 44].includes(k); }   // luxury: few, deliberate flashes
