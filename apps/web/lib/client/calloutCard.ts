export type CalloutThemeId = "colosseum" | "solana" | "lambo" | "bullrun" | "neon";
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
  /** Recent market-cap observations (oldest first) for the chart. */
  points?: number[];
  volume?: string;
  followers?: number;
  /** Market cap when the call was made, formatted. */
  calledAt?: string;
  /** Who made the call, e.g. a shortened wallet. */
  caller?: string;
};

/** Full-screen share card: portrait 9:16, the same shape as a story or a phone screen. */
export const CARD_W = 720;
export const CARD_H = 1280;

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

// ── Backgrounds: five different looks, all full-bleed ───────────────────────
function bgColosseum(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2b1d0f"); g.addColorStop(0.55, "#1a120a"); g.addColorStop(1, "#0d0805");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, 620);
  sun.addColorStop(0, "rgba(255,196,102,0.4)"); sun.addColorStop(1, "rgba(255,196,102,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
  // Amphitheatre facade climbing the lower third: three tiers of arches.
  for (let tier = 0; tier < 3; tier++) {
    const base = H - 6 - tier * 150, w = 96, h = 132;
    for (let x = -12; x < W; x += w) {
      ctx.fillStyle = `rgba(212,168,75,${0.12 - tier * 0.03})`;
      ctx.beginPath(); ctx.moveTo(x + 16, base); ctx.lineTo(x + 16, base - h + 44);
      ctx.arc(x + w / 2, base - h + 44, w / 2 - 16, Math.PI, 0); ctx.lineTo(x + w - 16, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(212,168,75,${0.05})`; ctx.fillRect(x + w - 16, base - h, 32, h);
    }
  }
}
function bgSolana(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0a0612"; ctx.fillRect(0, 0, W, H);
  const band = ctx.createLinearGradient(0, H, W, 0);
  band.addColorStop(0, "rgba(153,69,255,0.6)"); band.addColorStop(0.5, "rgba(80,90,220,0.12)"); band.addColorStop(1, "rgba(20,241,149,0.55)");
  ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(10,6,18,0.6)"; ctx.fillRect(0, 0, W, H);
  // The three Solana bars, enormous and cropped, behind everything.
  ctx.save(); ctx.translate(W * 0.55, H * 0.62); ctx.transform(1, 0, -0.32, 1, 0, 0);
  [-190, 0, 190].forEach((y, i) => {
    const g = ctx.createLinearGradient(-340, 0, 340, 0);
    g.addColorStop(0, i === 1 ? "rgba(20,241,149,0.2)" : "rgba(153,69,255,0.22)"); g.addColorStop(1, i === 1 ? "rgba(153,69,255,0.2)" : "rgba(20,241,149,0.22)");
    ctx.fillStyle = g; ctx.fillRect(i === 1 ? -280 : -340, y - 62, i === 1 ? 620 : 680, 124);
  });
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let x = 20; x < W; x += 30) for (let y = 20; y < H; y += 30) ctx.fillRect(x, y, 2, 2);
}
function bgLambo(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) { ctx.fillStyle = ((x + y) / 8) % 2 ? "#141417" : "#0b0b0d"; ctx.fillRect(x, y, 8, 8); }
  ctx.restore();
  // Angular yellow wedge sweeping from the lower right, with a black cut and speed lines.
  ctx.fillStyle = "#ffd400";
  ctx.beginPath(); ctx.moveTo(W, H * 0.32); ctx.lineTo(W, H); ctx.lineTo(W * 0.18, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#08080a";
  ctx.beginPath(); ctx.moveTo(W, H * 0.42); ctx.lineTo(W, H); ctx.lineTo(W * 0.3, H); ctx.lineTo(W * 0.62, H * 0.74); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,212,0,0.5)"; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(W, H * (0.3 - i * 0.04)); ctx.lineTo(W * (0.1 - i * 0.1), H * (0.92 - i * 0.05)); ctx.stroke(); }
}
function bgBullrun(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#04150d"); g.addColorStop(1, "#020a06");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let y = H * 0.9;
  for (let x = 20; x < W; x += 28) {
    const step = (rnd() - 0.34) * 64; y = Math.max(160, Math.min(H - 80, y - step - 9));
    const body = 26 + rnd() * 80, up = step > -18;
    ctx.strokeStyle = up ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.22)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - body - 26); ctx.lineTo(x, y + 26); ctx.stroke();
    ctx.fillStyle = up ? "rgba(52,211,153,0.24)" : "rgba(248,113,113,0.16)"; ctx.fillRect(x - 9, y - body, 18, body);
  }
  const glow = ctx.createRadialGradient(W * 0.25, H * 0.2, 0, W * 0.25, H * 0.2, 620);
  glow.addColorStop(0, "rgba(52,211,153,0.2)"); glow.addColorStop(1, "rgba(52,211,153,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}
function bgNeon(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#12062b"); g.addColorStop(0.5, "#3a0f55"); g.addColorStop(1, "#7a1b6e");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.58, r = 230;
  const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  sun.addColorStop(0, "#ffe66d"); sun.addColorStop(0.55, "#ff5ea8"); sun.addColorStop(1, "#8a3cff");
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = sun; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = "#3a0f55";
  for (let i = 0; i < 9; i++) ctx.fillRect(cx - r, cy + 10 + i * 24, r * 2, 4 + i * 2);
  ctx.restore();
  ctx.strokeStyle = "rgba(0,229,255,0.42)"; ctx.lineWidth = 1.5;
  const horizon = H * 0.8;
  for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 26, horizon); ctx.lineTo(W / 2 + i * 190, H); ctx.stroke(); }
  for (let i = 0; i < 8; i++) { const yy = horizon + i * i * 4.6 + 4; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
  ctx.fillStyle = "rgba(18,6,43,0.45)"; ctx.fillRect(0, 0, W, H * 0.48);
}

export const CALLOUT_THEMES: CalloutTheme[] = [
  { id: "colosseum", label: "Colosseum", tag: "VENI · VIDI · CALLED", accent: "#e0b45a", accent3d: 0xe0b45a, ink: "#f6ecd8", muted: "rgba(246,236,216,0.58)", up: "#e8c773", down: "#e07a5f", display: "Georgia, 'Times New Roman', serif", weight: "700", background: bgColosseum },
  { id: "solana", label: "Solana", tag: "SOLANA SZN", accent: "#14f195", accent3d: 0x14f195, ink: "#ffffff", muted: "rgba(255,255,255,0.58)", up: "#14f195", down: "#ff6b8b", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgSolana },
  { id: "lambo", label: "Lamborghini", tag: "FULL THROTTLE", accent: "#ffd400", accent3d: 0xffd400, ink: "#ffffff", muted: "rgba(255,255,255,0.58)", up: "#ffd400", down: "#ff5a4d", display: "'Arial Black', Impact, system-ui, sans-serif", weight: "900", italic: true, background: bgLambo },
  { id: "bullrun", label: "Bull run", tag: "NUMBER GO UP", accent: "#34d399", accent3d: 0x34d399, ink: "#eafff5", muted: "rgba(234,255,245,0.55)", up: "#34d399", down: "#f87171", display: "ui-monospace, 'SF Mono', Menlo, monospace", weight: "800", background: bgBullrun },
  { id: "neon", label: "After hours", tag: "AFTER HOURS", accent: "#00e5ff", accent3d: 0x00e5ff, ink: "#fff4fb", muted: "rgba(255,244,251,0.62)", up: "#7dffb3", down: "#ff6b8b", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgNeon },
];
export const themeById = (id: string): CalloutTheme => CALLOUT_THEMES.find((t) => t.id === id) ?? CALLOUT_THEMES[0];
export const isThemeId = (id: unknown): id is CalloutThemeId => CALLOUT_THEMES.some((t) => t.id === id);

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

/** Draws the full-screen callout share card. `progress` (0..1) animates the count-up and chart reveal. */
export function drawCalloutCard(
  ctx: CanvasRenderingContext2D,
  d: CalloutCardData,
  img: HTMLImageElement | null,
  themeId: CalloutThemeId = "colosseum",
  progress = 1,
) {
  const th = themeById(themeId);
  const p = ease(Math.max(0, Math.min(1, progress)));
  const PAD = 48;
  ctx.clearRect(0, 0, W, H);
  th.background(ctx);
  const font = (size: number, weight = th.weight) => `${th.italic ? "italic " : ""}${weight} ${size}px ${th.display}`;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

  // Top bar: theme tag left, brand right.
  ctx.font = font(20, "800");
  const tagW = ctx.measureText(th.tag).width + 40;
  ctx.fillStyle = "rgba(0,0,0,0.38)"; rr(ctx, PAD, 44, tagW, 44, 10); ctx.fill();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 1.6; rr(ctx, PAD, 44, tagW, 44, 10); ctx.stroke();
  ctx.fillStyle = th.accent; ctx.fillText(th.tag, PAD + 20, 74);
  ctx.textAlign = "right"; ctx.fillStyle = th.muted; ctx.font = font(22, "700"); ctx.fillText("solcameo.com", W - PAD, 74); ctx.textAlign = "left";

  // Influencer: large portrait, name, ticker chip.
  const as = 184, ax = PAD, ay = 128;
  ctx.save(); rr(ctx, ax, ay, as, as, 18); ctx.clip();
  if (img) {
    const s = Math.max(as / img.width, as / img.height);
    ctx.drawImage(img, ax + (as - img.width * s) / 2, ay + (as - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    ctx.fillStyle = th.accent; ctx.fillRect(ax, ay, as, as);
    ctx.fillStyle = "#0b0c0a"; ctx.font = font(96, "800"); ctx.textAlign = "center";
    ctx.fillText(d.name.slice(0, 1).toUpperCase(), ax + as / 2, ay + 126); ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 4; rr(ctx, ax, ay, as, as, 18); ctx.stroke();
  const nx = ax + as + 28, nameMax = W - PAD - nx;
  const name = d.name.toUpperCase();
  const ns = fit(ctx, name, (s) => font(s, "900"), 56, 28, nameMax);
  ctx.fillStyle = th.ink; ctx.fillText(name, nx, ay + 78);
  const tick = `$${d.ticker.toUpperCase()}`;
  ctx.font = font(30, "800");
  const tw = ctx.measureText(tick).width + 34;
  ctx.fillStyle = "#ffffff"; rr(ctx, nx, ay + 78 + Math.max(10, 70 - ns), tw, 48, 10); ctx.fill();
  ctx.fillStyle = "#0b0c0a"; ctx.fillText(tick, nx + 17, ay + 78 + Math.max(10, 70 - ns) + 35);
  if (d.caller) { ctx.fillStyle = th.muted; ctx.font = font(22, "600"); ctx.fillText(`called by ${d.caller}`, nx, ay + as); }

  // Headline: how much the call is up (or down).
  const hasChange = typeof d.changePct === "number" && Number.isFinite(d.changePct);
  const change = hasChange ? (d.changePct as number) : 0;
  const hy = 456;
  ctx.fillStyle = th.muted; ctx.font = font(26, "800"); ctx.fillText(d.label ?? "SINCE LAUNCH", PAD, hy - 112);
  const headline = hasChange ? pctLabel(change * p) : "NEW";
  const hcolor = hasChange ? (change >= 0 ? th.up : th.down) : th.ink;
  fit(ctx, headline, (s) => font(s, "900"), hasChange ? 170 : 130, 70, W - PAD * 2);
  ctx.fillStyle = hcolor; ctx.shadowColor = hasChange ? hcolor : "transparent"; ctx.shadowBlur = hasChange ? 34 : 0;
  ctx.fillText(headline, PAD - 4, hy + 24); ctx.shadowBlur = 0;

  // Chart panel
  const cx = PAD, cy = 520, cw = W - PAD * 2, ch = 250;
  ctx.fillStyle = "rgba(0,0,0,0.32)"; rr(ctx, cx, cy, cw, ch, 16); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1; rr(ctx, cx, cy, cw, ch, 16); ctx.stroke();
  const pts = (d.points ?? []).filter((n) => Number.isFinite(n));
  const gx = cx + 24, gy = cy + 28, gw = cw - 48, gh = ch - 56;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(gx, gy + (gh * i) / 3); ctx.lineTo(gx + gw, gy + (gh * i) / 3); ctx.stroke(); }
  if (pts.length >= 2) {
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const xy = (i: number) => [gx + (i / (pts.length - 1)) * gw, gy + gh - ((pts[i] - lo) / span) * (gh - 14) - 7] as const;
    ctx.save(); ctx.beginPath(); ctx.rect(gx - 6, gy - 14, (gw + 12) * p, gh + 28); ctx.clip();
    const fill = ctx.createLinearGradient(0, gy, 0, gy + gh);
    fill.addColorStop(0, `${th.accent}66`); fill.addColorStop(1, `${th.accent}00`);
    ctx.beginPath(); ctx.moveTo(gx, gy + gh);
    for (let i = 0; i < pts.length; i++) ctx.lineTo(...xy(i));
    ctx.lineTo(gx + gw, gy + gh); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(...xy(i)) : ctx.moveTo(...xy(i)));
    ctx.strokeStyle = th.accent; ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.shadowColor = th.accent; ctx.shadowBlur = 16; ctx.stroke();
    ctx.restore(); ctx.shadowBlur = 0;
    const [ex, ey] = xy(Math.min(pts.length - 1, Math.max(1, Math.ceil(pts.length * p)) - 1));
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = th.accent; ctx.lineWidth = 4; ctx.stroke();
  } else {
    ctx.setLineDash([10, 10]); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx, gy + gh / 2); ctx.lineTo(gx + gw, gy + gh / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = th.muted; ctx.font = font(22, "600"); ctx.fillText("Waiting for the first trades", gx, gy + gh / 2 - 16);
  }

  // Stats
  const stats: Array<[string, string]> = [["MARKET CAP", d.cap], ["24H VOLUME", d.volume ?? "—"], ["FOLLOWERS", d.followers != null ? d.followers.toLocaleString("en-US") : "—"]];
  if (d.calledAt) stats.push(["CALLED AT", d.calledAt]);
  const colW = (W - PAD * 2) / 3;
  stats.forEach(([label, value], i) => {
    const sx = PAD + (i % 3) * colW, sy = 828 + Math.floor(i / 3) * 104;
    ctx.fillStyle = th.muted; ctx.font = font(19, "700"); ctx.fillText(label, sx, sy);
    fit(ctx, value, (s) => font(s, "900"), 40, 22, colW - 16);
    ctx.fillStyle = th.ink; ctx.fillText(value, sx, sy + 46);
  });

  // The call
  ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(PAD, 1020, W - PAD * 2, 1);
  ctx.fillStyle = th.accent; ctx.font = font(86, "900"); ctx.fillText("“", PAD - 6, 1100);
  ctx.fillStyle = th.ink; ctx.font = font(38, "700");
  const lines = wrap(ctx, d.body || "What's your call?", W - PAD * 2 - 70, 3);
  lines.forEach((l, i) => ctx.fillText(l, PAD + 62, 1070 + i * 52));

  // Footer
  ctx.fillStyle = th.muted; ctx.font = font(20, "700"); ctx.fillText("CALLED ON SOLCAMEO", PAD, H - 40);
  ctx.textAlign = "right"; ctx.fillStyle = th.accent; ctx.fillText(`$${d.ticker.toUpperCase()}`, W - PAD, H - 40); ctx.textAlign = "left";
}

/** Renders the card to a PNG. Falls back to an avatar-less card if the image taints the canvas. */
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
