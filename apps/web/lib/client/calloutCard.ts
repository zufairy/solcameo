export type CalloutThemeId = "colosseum" | "solana" | "lambo" | "bullrun" | "neon" | "ferrari" | "vault" | "aurora";
export type CalloutCardData = {
  name: string;
  ticker: string;
  imageUrl?: string;
  body: string;
  /** Current market cap, already formatted (e.g. "$1.2K"). */
  cap: string;
  /** Percent move that drives the headline: since the call when known, else since launch. */
  changePct?: number | null;
  /** Headline caption, "SINCE CALL" or "SINCE LAUNCH". */
  label?: string;
  /** Total views across the influencer's videos: the number the card exists to flex. */
  views?: number;
  videos?: number;
  /** Views of the top clips, for the pillars. */
  bars?: number[];
  volume?: string;
  followers?: number;
  /** Market cap when the call was made, formatted. */
  calledAt?: string;
  /** Who made the call, e.g. a shortened wallet. */
  caller?: string;
};

/** Share card: landscape 16:9, the native shape of an image post on X. */
export const CARD_W = 1600;
export const CARD_H = 900;
export type CalloutTheme = {
  id: CalloutThemeId;
  label: string;
  tag: string;
  accent: string;
  accent3d: number;
  ink: string;
  muted: string;
  up: string;
  down: string;
  display: string;
  weight: string;
  italic?: boolean;
  background: (ctx: CanvasRenderingContext2D) => void;
};

export function loadCardImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length)
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  return lines;
}

const W = CARD_W, H = CARD_H;

// ── Backgrounds: eight looks, all full-bleed 16:9 ───────────────────────────
function bgColosseum(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2b1d0f"); g.addColorStop(0.6, "#1a120a"); g.addColorStop(1, "#0d0805");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.86, H * 0.08, 0, W * 0.86, H * 0.08, 760);
  sun.addColorStop(0, "rgba(255,196,102,0.42)"); sun.addColorStop(1, "rgba(255,196,102,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
  // Amphitheatre facade along the bottom: two tiers of arches.
  for (let tier = 0; tier < 2; tier++) {
    const base = H - 4 - tier * 128, w = 120, h = 118;
    for (let x = -20; x < W; x += w) {
      ctx.fillStyle = `rgba(212,168,75,${0.13 - tier * 0.04})`;
      ctx.beginPath(); ctx.moveTo(x + 18, base); ctx.lineTo(x + 18, base - h + 48);
      ctx.arc(x + w / 2, base - h + 48, w / 2 - 18, Math.PI, 0); ctx.lineTo(x + w - 18, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(212,168,75,0.05)"; ctx.fillRect(x + w - 18, base - h, 36, h);
    }
  }
}
function bgSolana(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0a0612"; ctx.fillRect(0, 0, W, H);
  const band = ctx.createLinearGradient(0, H, W, 0);
  band.addColorStop(0, "rgba(153,69,255,0.55)"); band.addColorStop(0.5, "rgba(80,90,220,0.1)"); band.addColorStop(1, "rgba(20,241,149,0.5)");
  ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(10,6,18,0.6)"; ctx.fillRect(0, 0, W, H);
  // The three Solana bars, enormous and cropped on the right.
  ctx.save(); ctx.translate(W * 0.8, H * 0.5); ctx.transform(1, 0, -0.32, 1, 0, 0);
  [-210, 0, 210].forEach((y, i) => {
    const g = ctx.createLinearGradient(-420, 0, 420, 0);
    g.addColorStop(0, i === 1 ? "rgba(20,241,149,0.22)" : "rgba(153,69,255,0.24)"); g.addColorStop(1, i === 1 ? "rgba(153,69,255,0.22)" : "rgba(20,241,149,0.24)");
    ctx.fillStyle = g; ctx.fillRect(i === 1 ? -330 : -420, y - 70, i === 1 ? 740 : 840, 140);
  });
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let x = 20; x < W; x += 32) for (let y = 20; y < H; y += 32) ctx.fillRect(x, y, 2, 2);
}
function bgLambo(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) { ctx.fillStyle = ((x + y) / 10) % 2 ? "#141417" : "#0b0b0d"; ctx.fillRect(x, y, 10, 10); }
  ctx.restore();
  // Angular yellow wedge from the right, with a black cut and speed lines.
  ctx.fillStyle = "#ffd400";
  ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.66, H); ctx.lineTo(W * 0.84, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#08080a";
  ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.74, H); ctx.lineTo(W * 0.9, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,212,0,0.45)"; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(W * 0.84 - i * 26, 0); ctx.lineTo(W * 0.66 - i * 26, H); ctx.stroke(); }
}
function bgBullrun(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#04150d"); g.addColorStop(1, "#020a06");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let y = H * 0.85;
  for (let x = 24; x < W; x += 34) {
    const step = (rnd() - 0.36) * 70; y = Math.max(160, Math.min(H - 60, y - step - 8));
    const body = 24 + rnd() * 80, up = step > -18;
    ctx.strokeStyle = up ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.22)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - body - 28); ctx.lineTo(x, y + 28); ctx.stroke();
    ctx.fillStyle = up ? "rgba(52,211,153,0.24)" : "rgba(248,113,113,0.16)"; ctx.fillRect(x - 11, y - body, 22, body);
  }
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.2, 0, W * 0.2, H * 0.2, 760);
  glow.addColorStop(0, "rgba(52,211,153,0.2)"); glow.addColorStop(1, "rgba(52,211,153,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}
function bgNeon(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#12062b"); g.addColorStop(0.55, "#3a0f55"); g.addColorStop(1, "#7a1b6e");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const cx = W * 0.78, cy = H * 0.5, r = 250;
  const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  sun.addColorStop(0, "#ffe66d"); sun.addColorStop(0.55, "#ff5ea8"); sun.addColorStop(1, "#8a3cff");
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = sun; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = "#3a0f55";
  for (let i = 0; i < 9; i++) ctx.fillRect(cx - r, cy + 10 + i * 26, r * 2, 4 + i * 2);
  ctx.restore();
  ctx.strokeStyle = "rgba(0,229,255,0.4)"; ctx.lineWidth = 1.5;
  const horizon = H * 0.74;
  for (let i = -16; i <= 16; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 34, horizon); ctx.lineTo(W / 2 + i * 220, H); ctx.stroke(); }
  for (let i = 0; i < 7; i++) { const yy = horizon + i * i * 4 + 4; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
  ctx.fillStyle = "rgba(18,6,43,0.4)"; ctx.fillRect(0, 0, W, H * 0.4);
}
function bgFerrari(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0b0707"; ctx.fillRect(0, 0, W, H);
  // Carbon-fibre weave.
  ctx.save(); ctx.globalAlpha = 0.55;
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) { ctx.fillStyle = (((x + y) / 8) | 0) % 2 ? "#171010" : "#0c0808"; ctx.fillRect(x, y, 8, 8); }
  ctx.restore();
  const glow = ctx.createRadialGradient(W * 0.9, H * 0.9, 0, W * 0.9, H * 0.9, 900);
  glow.addColorStop(0, "rgba(225,6,0,0.5)"); glow.addColorStop(1, "rgba(225,6,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // Rosso Corsa racing stripe with a white pinstripe, running corner to corner.
  ctx.fillStyle = "#e10600";
  ctx.beginPath(); ctx.moveTo(W * 0.62, H); ctx.lineTo(W * 0.78, H); ctx.lineTo(W, H * 0.2); ctx.lineTo(W, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#f6f1ea";
  ctx.beginPath(); ctx.moveTo(W * 0.805, H); ctx.lineTo(W * 0.815, H); ctx.lineTo(W, H * 0.34); ctx.lineTo(W, H * 0.3); ctx.closePath(); ctx.fill();
}
function bgVault(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#14110a"); g.addColorStop(1, "#070604");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.82, H * 0.7, 0, W * 0.82, H * 0.7, 720);
  glow.addColorStop(0, "rgba(245,197,66,0.3)"); glow.addColorStop(1, "rgba(245,197,66,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // A pyramid of polished gold ingots at the right.
  const bw = 150, bh = 56;
  for (let row = 0; row < 5; row++) {
    const n = 5 - row, y = H - 70 - row * (bh + 8), x0 = W * 0.82 - (n * (bw + 10)) / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (bw + 10);
      const gg = ctx.createLinearGradient(0, y, 0, y + bh);
      gg.addColorStop(0, "rgba(255,226,130,0.5)"); gg.addColorStop(0.5, "rgba(245,197,66,0.32)"); gg.addColorStop(1, "rgba(160,110,20,0.28)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.moveTo(x + 14, y); ctx.lineTo(x + bw - 14, y); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x, y + bh); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,236,170,0.25)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
}
function bgAurora(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#050816"); g.addColorStop(1, "#0b0a1f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Soft curtains in Solana purple, teal and green.
  const curtains: Array<[string, number, number]> = [["rgba(153,69,255,0.32)", 0.3, 0.9], ["rgba(20,241,149,0.26)", 0.5, 1.1], ["rgba(0,200,255,0.2)", 0.7, 0.8]];
  curtains.forEach(([c, ox, amp]) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.8);
    grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.5, c); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, H * 0.55 + Math.sin(x / 190 + ox * 9) * 90 * amp + Math.sin(x / 80 + ox * 4) * 24);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  });
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) { ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`; ctx.fillRect(rnd() * W, rnd() * H * 0.7, 2, 2); }
}

export const CALLOUT_THEMES: CalloutTheme[] = [
  { id: "colosseum", label: "Colosseum", tag: "VENI · VIDI · CALLED", accent: "#e0b45a", accent3d: 0xe0b45a, ink: "#f6ecd8", muted: "rgba(246,236,216,0.62)", up: "#e8c773", down: "#e07a5f", display: "Georgia, 'Times New Roman', serif", weight: "700", background: bgColosseum },
  { id: "solana", label: "Solana", tag: "SOLANA SZN", accent: "#14f195", accent3d: 0x14f195, ink: "#ffffff", muted: "rgba(255,255,255,0.62)", up: "#14f195", down: "#ff6b8b", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgSolana },
  { id: "lambo", label: "Lamborghini", tag: "FULL THROTTLE", accent: "#ffd400", accent3d: 0xffd400, ink: "#ffffff", muted: "rgba(255,255,255,0.62)", up: "#ffd400", down: "#ff5a4d", display: "'Arial Black', Impact, system-ui, sans-serif", weight: "900", italic: true, background: bgLambo },
  { id: "ferrari", label: "Ferrari", tag: "ROSSO CORSA", accent: "#ff3b30", accent3d: 0xff3b30, ink: "#fff6f2", muted: "rgba(255,246,242,0.62)", up: "#ffd5cf", down: "#ff9f98", display: "'Arial Black', Impact, system-ui, sans-serif", weight: "900", italic: true, background: bgFerrari },
  { id: "bullrun", label: "Bull run", tag: "NUMBER GO UP", accent: "#34d399", accent3d: 0x34d399, ink: "#eafff5", muted: "rgba(234,255,245,0.6)", up: "#34d399", down: "#f87171", display: "ui-monospace, 'SF Mono', Menlo, monospace", weight: "800", background: bgBullrun },
  { id: "vault", label: "Gold vault", tag: "GOLD STANDARD", accent: "#f5c542", accent3d: 0xf5c542, ink: "#fff7e0", muted: "rgba(255,247,224,0.62)", up: "#f5c542", down: "#e8836b", display: "Georgia, 'Times New Roman', serif", weight: "700", background: bgVault },
  { id: "aurora", label: "Aurora", tag: "NORTHERN LIGHTS", accent: "#b69cff", accent3d: 0xb69cff, ink: "#f4f1ff", muted: "rgba(244,241,255,0.62)", up: "#14f195", down: "#ff7aa0", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgAurora },
  { id: "neon", label: "After hours", tag: "AFTER HOURS", accent: "#00e5ff", accent3d: 0x00e5ff, ink: "#fff4fb", muted: "rgba(255,244,251,0.66)", up: "#7dffb3", down: "#ff6b8b", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgNeon },
];
export const themeById = (id: string): CalloutTheme => CALLOUT_THEMES.find((t) => t.id === id) ?? CALLOUT_THEMES[0];
export const isThemeId = (id: unknown): id is CalloutThemeId => CALLOUT_THEMES.some((t) => t.id === id);

/** 1,200 → "1.2K", 3,400,000 → "3.4M". */
export function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
function pctLabel(n: number) {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
/** Shrinks a font until `text` fits `maxWidth`. */
function fit(ctx: CanvasRenderingContext2D, text: string, make: (size: number) => string, size: number, min: number, maxWidth: number) {
  let s = size;
  ctx.font = make(s);
  while (s > min && ctx.measureText(text).width > maxWidth) { s -= 2; ctx.font = make(s); }
  return s;
}

/** Draws the 16:9 callout share card. `progress` (0..1) animates the count-up and chart reveal. */
export function drawCalloutCard(
  ctx: CanvasRenderingContext2D,
  d: CalloutCardData,
  img: HTMLImageElement | null,
  themeId: CalloutThemeId = "colosseum",
  progress = 1,
) {
  const th = themeById(themeId);
  const p = ease(Math.max(0, Math.min(1, progress)));
  const PAD = 64;
  ctx.clearRect(0, 0, W, H);
  th.background(ctx);
  const font = (size: number, weight = th.weight) => `${th.italic ? "italic " : ""}${weight} ${size}px ${th.display}`;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

  // Top bar: theme tag left, brand right.
  ctx.font = font(20, "800");
  const tagW = ctx.measureText(th.tag).width + 40;
  ctx.fillStyle = "rgba(0,0,0,0.45)"; rr(ctx, PAD, 48, tagW, 46, 10); ctx.fill();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 1.6; rr(ctx, PAD, 48, tagW, 46, 10); ctx.stroke();
  ctx.fillStyle = th.accent; ctx.fillText(th.tag, PAD + 20, 79);
  ctx.textAlign = "right"; ctx.fillStyle = th.muted; ctx.font = font(24, "700"); ctx.fillText("solcameo.com", W - PAD, 79); ctx.textAlign = "left";

  // Influencer: avatar, name, ticker.
  const as = 140, ax = PAD, ay = 132;
  ctx.save(); rr(ctx, ax, ay, as, as, 16); ctx.clip();
  if (img) {
    const sc = Math.max(as / img.width, as / img.height);
    ctx.drawImage(img, ax + (as - img.width * sc) / 2, ay + (as - img.height * sc) / 2, img.width * sc, img.height * sc);
  } else {
    ctx.fillStyle = th.accent; ctx.fillRect(ax, ay, as, as);
    ctx.fillStyle = "#0b0c0a"; ctx.font = font(76, "800"); ctx.textAlign = "center";
    ctx.fillText(d.name.slice(0, 1).toUpperCase(), ax + as / 2, ay + 96); ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 4; rr(ctx, ax, ay, as, as, 16); ctx.stroke();
  const nx = ax + as + 28, nameMax = 700 - as;
  const name = d.name.toUpperCase();
  fit(ctx, name, (s) => font(s, "900"), 52, 28, nameMax + 120);
  ctx.fillStyle = th.ink; ctx.fillText(name, nx, ay + 58);
  const tick = `$${d.ticker.toUpperCase()}`;
  ctx.font = font(28, "800");
  const tw = ctx.measureText(tick).width + 30;
  ctx.fillStyle = "#ffffff"; rr(ctx, nx, ay + 78, tw, 44, 9); ctx.fill();
  ctx.fillStyle = "#0b0c0a"; ctx.fillText(tick, nx + 15, ay + 78 + 32);
  if (d.caller) { ctx.fillStyle = th.muted; ctx.font = font(21, "600"); ctx.fillText(`called by ${d.caller}`, nx + tw + 18, ay + 78 + 31); }

  // Hero: the earnings move since the call (or launch). Falls back to market cap for brand-new coins.
  const hasChange = typeof d.changePct === "number" && Number.isFinite(d.changePct);
  const change = hasChange ? (d.changePct as number) : 0;
  const heroColor = hasChange ? (change >= 0 ? th.up : th.down) : th.accent;
  const heroText = hasChange ? pctLabel(change * p) : d.cap;
  ctx.fillStyle = th.muted; ctx.font = font(26, "800");
  ctx.fillText(hasChange ? (d.label ?? "SINCE LAUNCH") : "MARKET CAP", PAD, 372);
  fit(ctx, heroText, (s) => font(s, "900"), 210, 90, 880);
  ctx.fillStyle = heroColor; ctx.shadowColor = heroColor; ctx.shadowBlur = 36;
  ctx.fillText(heroText, PAD - 4, 540); ctx.shadowBlur = 0;

  // Stat row.
  const stats: Array<[string, string]> = [
    ["MARKET CAP", d.cap],
    ["TOTAL VIEWS", compact(Math.round(Math.max(0, d.views ?? 0) * p))],
    ["VIDEOS", d.videos != null ? d.videos.toLocaleString("en-US") : "—"],
  ];
  stats.forEach(([label, value], i) => {
    const sx = PAD + i * 290;
    ctx.fillStyle = th.muted; ctx.font = font(19, "700"); ctx.fillText(label, sx, 612);
    fit(ctx, value, (s) => font(s, "900"), 52, 26, 260);
    ctx.fillStyle = th.ink; ctx.fillText(value, sx, 664);
  });

  // Right panel: top clips rising as pillars.
  const px = 980, py = 132, pw = W - PAD - px, ph = 508;
  ctx.fillStyle = "rgba(0,0,0,0.38)"; rr(ctx, px, py, pw, ph, 20); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1.5; rr(ctx, px, py, pw, ph, 20); ctx.stroke();
  ctx.fillStyle = th.muted; ctx.font = font(19, "800"); ctx.fillText("TOP CLIPS", px + 28, py + 46);
  const bars = (d.bars ?? []).filter((n) => n > 0).slice(0, 8);
  if (bars.length) {
    const top = Math.max(...bars), gap = 14, bw = Math.min(54, (pw - 56 - (bars.length - 1) * gap) / bars.length), total = bars.length * bw + (bars.length - 1) * gap;
    const bx0 = px + (pw - total) / 2, base = py + ph - 34, maxH = ph - 120;
    bars.forEach((v, i) => {
      const grow = ease(Math.max(0, Math.min(1, p * 1.5 - i * 0.07)));
      const h = Math.max(10, (v / top) * maxH * grow), bx = bx0 + i * (bw + gap);
      const g = ctx.createLinearGradient(0, base - h, 0, base);
      g.addColorStop(0, th.accent); g.addColorStop(1, `${th.accent}33`);
      ctx.fillStyle = g; rr(ctx, bx, base - h, bw, h, 7); ctx.fill();
    });
  } else {
    ctx.fillStyle = th.muted; ctx.font = font(24, "600"); ctx.fillText("No clips posted yet. Get in early.", px + 28, py + ph / 2 + 10);
  }

  // The call.
  ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(PAD, 716, W - PAD * 2, 1);
  ctx.fillStyle = th.accent; ctx.font = font(88, "900"); ctx.fillText("“", PAD - 6, 800);
  ctx.fillStyle = th.ink; ctx.font = font(34, "700");
  const lines = wrap(ctx, d.body || "What's your call?", W - PAD * 2 - 80, 2);
  lines.forEach((l, i) => ctx.fillText(l, PAD + 64, 762 + i * 46));

  // Footer.
  ctx.fillStyle = th.muted; ctx.font = font(20, "700"); ctx.fillText("CALLED ON SOLCAMEO", PAD, H - 28);
  ctx.textAlign = "right"; ctx.fillStyle = th.accent; ctx.fillText(`$${d.ticker.toUpperCase()}`, W - PAD, H - 28); ctx.textAlign = "left";
}

/** Renders the card to a 1600×900 PNG. Falls back to an avatar-less card if the image taints the canvas. */
export async function calloutCardBlob(d: CalloutCardData, theme: CalloutThemeId = "colosseum"): Promise<Blob | null> {
  const img = await loadCardImage(d.imageUrl);
  for (const attempt of [img, null]) {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W; canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawCalloutCard(ctx, d, attempt, theme, 1);
    const blob = await new Promise<Blob | null>((res) => { try { canvas.toBlob(res, "image/png"); } catch { res(null); } });
    if (blob) return blob;
  }
  return null;
}
