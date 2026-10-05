// V5 — "THE BEST OF THE BEST" · Top Gun mission angle · Skyfall · military mono / HUD type · 3D chrome squadron patch
import * as L from './lib2.js';
const { K, D, X, W, H, BIG, MID, HUGE, word, clamp, E } = L;
const BT = 0.79, HB = BT / 2, o = { bt: BT, hb: HB };
const S = K;
const SC = [
  [S(0), (u, t) => L.roll2(u, t, { clips: ['tgm2', 'tgm3', 'tgm4', 'tgm5', 'tgm6', 'tgm7', 'tgm8', 'tgm9'], step: BT, face: true, fh: 0.3, style: 'mono', lb: 1, hud: true, hudLabel: 'TOP GUN // BRIEFING 0600', lines: [['P0', 0.3], ['T5', 2.3, { maxw: 4 }]], cap: { size: 50 }, tag: 'CALLSIGN ASSIGNED' })],
  [S(10), (u, t) => { L.faceShot('tgm1', u, { t, fh: 0.42, dark: 0.25, label: 'MAVERICK', tag: 'THREAT LEVEL ▲' }); L.letterbox(1); L.caption2('T6', u - 0.05, { style: 'slam', size: 120 }); }],
  [S(12), u => L.radar(u, { clip: 'tgm28', title: 'mission brief // 145 countries', words: [['one brief.', 0.2], ['145 countries.', 2.1], ['before lunch.', 4.0]] })],
  [S(19), (u, t) => L.roll2(u, t, { clips: ['pplanes40', 'pplanes41', 'pplanes8', 'pplanes9'], step: HB, face: true, fh: 0.34, style: 'slam', lines: [['P11', 0.05]], tag: 'G-FORCE 7.2' })],
  [S(22), u => L.punch(u, Object.assign({ words: [['brief.', ['pplanes26', 'pplanes22']], ['create.', ['pplanes35', 'pplanes39']], ['post.', ['tgm27', 'pplanes53']], ['paid.', ['tgm31', 'pplanes60']]] }, o))],
  [S(26), (u, t) => { L.montage(u, ['pplanes2', 'pplanes3', 'pplanes4', 'pplanes10'], HB, { face: true, t, fh: 0.34, dark: 0.4, tag: 'AGENT PILOT' }); L.maskText('your agents', W / 2, H / 2 - 60, BIG, u - 0.1, {}); L.maskText('fly the mission.', W / 2, H / 2 + 70, BIG, u - 0.6, { w: 700 }); }],
  [S(29), u => { L.montage(u, ['tgm26', 'tgm29', 'tgm30', 'tgm32', 'tgm34', 'pplanes50', 'pplanes52'], HB / 2, { dark: 0.3, zs: 0.3 }); L.slamText('you collect.', W / 2, H / 2, HUGE - 10, u - 0.15); L.trackLines(u); }],
  [S(32), u => L.chrome(u, { clip: 'tgm22', text: 'vello squadron.', hud: 'VELLO // SQUADRON' })],
  [S(35), (u, t) => L.roll2(u, t, { clips: ['tgm11', 'tgm12', 'tgm14', 'tgm16', 'tgm17', 'tgm2'], step: BT, face: true, fh: 0.32, style: 'mono', lines: [['T7', 0.05, { maxw: 4 }]], cap: { size: 46 }, hud: true, hudLabel: 'INSTRUCTOR // DOSSIER', tag: 'REAL-WORLD EXPERIENCE' })],
  [S(43), u => { L.film('tgm5', u, { zs: 0.04, dark: 0.6 }); L.letterbox(1); const R = [['MISSION REPORT', 0.05], ['VIDEOS FLOWN ........... 5,000+', 0.5], ['NEW PILOTS (24H) ....... 100+', 2.0], ['TOWER STATUS ........... DOWN', 3.6]]; R.forEach(([s, at], i) => L.typeMono(s, 180, 230 + i * 70, i ? 34 : 40, u - at, { upper: true, cps: 55, color: i === 3 ? '#C8FF00' : '#fff' })); L.slamText('we broke the tower.', W / 2, H - 230, HUGE - 30, u - 4.3); L.trackLines(u, 'rgba(255,255,255,0.4)', 'DEBRIEF // DAY 90'); }],
  [S(50), (u, t) => L.roll2(u, t, { clips: ['tgm17', 'tgm1'], step: BT, face: true, fh: 0.4, style: 'slam', lines: [['T8', 0.05]], tag: 'LEGENDARY' })],
  [S(53), (u, t) => L.roll2(u, t, { clips: ['pplanes14', 'pplanes15', 'pplanes18', 'pplanes21', 'pplanes29', 'pplanes33'], step: HB, style: 'slam', lines: [[71, 0.05], [74, 1.75]], hud: true, hudLabel: 'RISK // ENGAGED' })],
  [S(59), u => { L.montage(u, ['pplanes50', 'tgm31', 'pplanes52', 'tgm29', 'pplanes26', 'tgm34'], HB, { dark: 0.45, zs: 0.2 }); L.slamText('payload delivered.', W / 2, H / 2 - 20, HUGE - 20, u - 0.1); L.typeMono('PAID ON SOLANA · CONFIRMED', W / 2, H / 2 + 120, 30, u - 1.0, { upper: true, align: 'center', color: '#C8FF00' }); L.trackLines(u, 'rgba(255,255,255,0.4)', 'PAYLOAD // SOLANA'); }],
  [S(63), (u, t) => { L.radar(u, { clip: 'tgm0', hud: 'OVERWATCH // ALERT' }); L.caption2('T0', u - 0.05, { style: 'mono', size: 40, y: H - 150, maxw: 5 }); if (u > 5.6) L.slamText("can't be.", W / 2, H / 2, HUGE, u - 5.65); }],
  [S(71), (u, t) => { L.faceShot('tgm1', u, { t, fh: 0.5, dark: 0.2, label: 'MAVERICK', tag: 'INBOUND' }); L.letterbox(1); L.slamText('maverick.', W / 2, H / 2 + 260, BIG, u - 0.12); }],
  [S(74), (u, t) => L.endCine(u, t, { clips: ['tgm23', 'tgm36', 'pplanes72', 'pplanes75', 'tgm19'], step: 1.3, montage: 6.0, line: ['the best of the best.', 0.4], logo: 'slam', tagline: 'your wingman in the attention economy.', bgClip: 'tgm23', fadeAt: 8.8 })],
];
export const SHOTS = SC;
export const CUTS = [10, 12, 19, 22, 26, 29, 32, 35, 43, 50, 53, 59, 63, 71];
export const NBEATS = 95;
export const DUR = 74.9;
export function wantFlash(k) { if (CUTS.includes(k)) return true; if (k < 12) return false; if (k < 63) return k % 2 === 0; return false; }
