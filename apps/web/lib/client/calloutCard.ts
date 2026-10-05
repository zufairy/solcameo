export type CalloutThemeId = "colosseum" | "solana" | "lambo" | "bullrun" | "neon";
export type CalloutCardData = {
  name: string;
  ticker: string;
  imageUrl?: string;
  body: string;
  cap: string;
  /** Change since launch, in percent. Null when the pool has no observation yet. */
  changePct?: number | null;
  /** Recent market-cap observations (oldest first) for the sparkline. */
  points?: number[];
};

export const CARD_W = 1024;
export const CARD_H = 640;

type Theme = {
  id: CalloutThemeId;
  label: string;
  tag: string;
  accent: string; // hex, also drives the 3D scene
  accent3d: number;
  ink: string;
  muted: string;
  up: string;
  down: string;
  display: string; // font family for names and numbers
  weight: string;
  italic?: boolean;
  background: (ctx: CanvasRenderingContext2D, t: number) => void;
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

// ── Backgrounds: five unmistakably different looks ──────────────────────────
function bgColosseum(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2a1d10"); g.addColorStop(0.6, "#1a120a"); g.addColorStop(1, "#0f0a06");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.82, H * 0.18, 0, W * 0.82, H * 0.18, 460);
  sun.addColorStop(0, "rgba(255,196,102,0.34)"); sun.addColorStop(1, "rgba(255,196,102,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
  // Two tiers of arches, like the amphitheatre facade.
  for (let tier = 0; tier < 2; tier++) {
    const base = H - 8 - tier * 118, w = 86, h = 100;
    for (let x = -10; x < W; x += w) {
      ctx.fillStyle = tier ? "rgba(212,168,75,0.07)" : "rgba(212,168,75,0.11)";
      ctx.beginPath(); ctx.moveTo(x + 14, base); ctx.lineTo(x + 14, base - h + 36);
      ctx.arc(x + w / 2, base - h + 36, w / 2 - 14, Math.PI, 0); ctx.lineTo(x + w - 14, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(212,168,75,0.05)"; ctx.fillRect(x + w - 14, base - h, 28, h);
    }
  }
}
function bgSolana(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0a0612"; ctx.fillRect(0, 0, W, H);
  const band = ctx.createLinearGradient(0, H, W, 0);
  band.addColorStop(0, "rgba(153,69,255,0.55)"); band.addColorStop(0.5, "rgba(80,90,220,0.12)"); band.addColorStop(1, "rgba(20,241,149,0.5)");
  ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(10,6,18,0.62)"; ctx.fillRect(0, 0, W, H);
  // Three skewed bars: the Solana mark, oversized and cropped.
  ctx.save(); ctx.translate(W * 0.74, H * 0.5); ctx.transform(1, 0, -0.32, 1, 0, 0);
  [-92, 0, 92].forEach((y, i) => {
    const g = ctx.createLinearGradient(-200, 0, 200, 0);
    g.addColorStop(0, i === 1 ? "rgba(20,241,149,0.22)" : "rgba(153,69,255,0.22)"); g.addColorStop(1, i === 1 ? "rgba(153,69,255,0.22)" : "rgba(20,241,149,0.22)");
    ctx.fillStyle = g; ctx.fillRect(i === 1 ? -170 : -210, y - 30, i === 1 ? 380 : 420, 60);
  });
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let x = 20; x < W; x += 28) for (let y = 20; y < H; y += 28) ctx.fillRect(x, y, 2, 2);
}
function bgLambo(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
  // Carbon-fibre weave.
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
    ctx.fillStyle = ((x + y) / 8) % 2 ? "#141417" : "#0c0c0e"; ctx.fillRect(x, y, 8, 8);
  }
  ctx.restore();
  // Angular yellow wedges.
  ctx.fillStyle = "#ffd400";
  ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W - 330, 0); ctx.lineTo(W - 110, H); ctx.lineTo(W, H); ctx.closePath(); ctx.globalAlpha = 0.95; ctx.fill();
  ctx.fillStyle = "#08080a"; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.moveTo(W - 60, 0); ctx.lineTo(W - 100, 0); ctx.lineTo(W - 36, H); ctx.lineTo(W, H); ctx.lineTo(W, 120); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,212,0,0.55)"; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(W - 420 - i * 26, 0); ctx.lineTo(W - 200 - i * 26, H); ctx.stroke(); }
}
function bgBullrun(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#04150d"); g.addColorStop(1, "#020a06");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // A wall of candles climbing to the right.
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let y = H * 0.78;
  for (let x = 24; x < W; x += 30) {
    const step = (rnd() - 0.38) * 46; y = Math.max(90, Math.min(H - 60, y - step - 5));
    const body = 18 + rnd() * 54, up = step > -14;
    ctx.strokeStyle = up ? "rgba(52,211,153,0.28)" : "rgba(248,113,113,0.22)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - body - 18); ctx.lineTo(x, y + 18); ctx.stroke();
    ctx.fillStyle = up ? "rgba(52,211,153,0.22)" : "rgba(248,113,113,0.16)"; ctx.fillRect(x - 8, y - body, 16, body);
  }
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.3, 0, W * 0.2, H * 0.3, 520);
  glow.addColorStop(0, "rgba(52,211,153,0.16)"); glow.addColorStop(1, "rgba(52,211,153,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}
function bgNeon(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#12062b"); g.addColorStop(0.55, "#3a0f55"); g.addColorStop(1, "#7a1b6e");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Striped sun.
  const cx = W * 0.72, cy = H * 0.5, r = 150;
  const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  sun.addColorStop(0, "#ffe66d"); sun.addColorStop(0.55, "#ff5ea8"); sun.addColorStop(1, "#8a3cff");
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = sun; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = "#3a0f55";
  for (let i = 0; i < 7; i++) ctx.fillRect(cx - r, cy + 10 + i * 20, r * 2, 3 + i * 1.6);
  ctx.restore();
  // Perspective grid floor.
  ctx.strokeStyle = "rgba(0,229,255,0.4)"; ctx.lineWidth = 1.5;
  const horizon = H * 0.78;
  for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 22, horizon); ctx.lineTo(W / 2 + i * 150, H); ctx.stroke(); }
  for (let i = 0; i < 7; i++) { const yy = horizon + (i * i * 4.4) + 4; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
  ctx.fillStyle = "rgba(18,6,43,0.55)"; ctx.fillRect(0, 0, W * 0.62, H);
}

export const CALLOUT_THEMES: Theme[] = [
  { id: "colosseum", label: "Colosseum", tag: "VENI · VIDI · CALLED", accent: "#e0b45a", accent3d: 0xe0b45a, ink: "#f6ecd8", muted: "rgba(246,236,216,0.55)", up: "#e8c773", down: "#e07a5f", display: "Georgia, 'Times New Roman', serif", weight: "700", background: bgColosseum },
  { id: "solana", label: "Solana", tag: "SOLANA SZN", accent: "#14f195", accent3d: 0x14f195, ink: "#ffffff", muted: "rgba(255,255,255,0.55)", up: "#14f195", down: "#ff6b8b", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgSolana },
  { id: "lambo", label: "Lamborghini", tag: "FULL THROTTLE", accent: "#ffd400", accent3d: 0xffd400, ink: "#ffffff", muted: "rgba(255,255,255,0.55)", up: "#ffd400", down: "#ff5a4d", display: "'Arial Black', Impact, system-ui, sans-serif", weight: "900", italic: true, background: bgLambo },
  { id: "bullrun", label: "Bull run", tag: "NUMBER GO UP", accent: "#34d399", accent3d: 0x34d399, ink: "#eafff5", muted: "rgba(234,255,245,0.5)", up: "#34d399", down: "#f87171", display: "ui-monospace, 'SF Mono', Menlo, monospace", weight: "800", background: bgBullrun },
  { id: "neon", label: "After hours", tag: "AFTER HOURS", accent: "#00e5ff", accent3d: 0x00e5ff, ink: "#fff4fb", muted: "rgba(255,244,251,0.6)", up: "#7dffb3", down: "#ff6b8b", display: "system-ui, -apple-system, sans-serif", weight: "800", background: bgNeon },
];
export const themeById = (id: CalloutThemeId) => CALLOUT_THEMES.find((t) => t.id === id) ?? CALLOUT_THEMES[0];

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
function pctLabel(n: number) {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Draws the shareable callout card. `progress` (0..1) animates the number count-up and the chart reveal. */
export function drawCalloutCard(
  ctx: CanvasRenderingContext2D,
  d: CalloutCardData,
  img: HTMLImageElement | null,
  themeId: CalloutThemeId = "colosseum",
  progress = 1,
) {
  const th = themeById(themeId);
  const p = ease(Math.max(0, Math.min(1, progress)));
  ctx.clearRect(0, 0, W, H);
  th.background(ctx, p);
  const font = (size: number, weight = th.weight) => `${th.italic ? "italic " : ""}${weight} ${size}px ${th.display}`;

  // Avatar
  const ax = 56, ay = 48, as = 96;
  ctx.save(); rr(ctx, ax, ay, as, as, 10); ctx.clip();
  if (img) {
    const s = Math.max(as / img.width, as / img.height);
    ctx.drawImage(img, ax + (as - img.width * s) / 2, ay + (as - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    ctx.fillStyle = th.accent; ctx.fillRect(ax, ay, as, as);
    ctx.fillStyle = "#0b0c0a"; ctx.font = font(54, "800"); ctx.textAlign = "center";
    ctx.fillText(d.name.slice(0, 1).toUpperCase(), ax + as / 2, ay + 68); ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 3; rr(ctx, ax, ay, as, as, 10); ctx.stroke();

  // Name + ticker chip
  const name = (d.name.length > 16 ? `${d.name.slice(0, 15)}…` : d.name).toUpperCase();
  ctx.fillStyle = th.ink; ctx.font = font(44); ctx.fillText(name, 176, 96);
  const tick = `$${d.ticker.toUpperCase()}`;
  ctx.font = font(24, "800");
  const tw = ctx.measureText(tick).width + 28;
  ctx.fillStyle = "#ffffff"; rr(ctx, 176, 112, tw, 36, 8); ctx.fill();
  ctx.fillStyle = "#0b0c0a"; ctx.fillText(tick, 190, 138);

  // Tag
  ctx.font = font(18, "800");
  const tagW = ctx.measureText(th.tag).width + 36;
  ctx.fillStyle = "rgba(0,0,0,0.35)"; rr(ctx, W - 56 - tagW, 56, tagW, 40, 8); ctx.fill();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 1.5; rr(ctx, W - 56 - tagW, 56, tagW, 40, 8); ctx.stroke();
  ctx.fillStyle = th.accent; ctx.textAlign = "center"; ctx.fillText(th.tag, W - 56 - tagW / 2, 83); ctx.textAlign = "left";

  // The headline number: how much the call is up (or down) since launch.
  const hasChange = typeof d.changePct === "number" && Number.isFinite(d.changePct);
  const change = hasChange ? (d.changePct as number) : 0;
  ctx.fillStyle = th.muted; ctx.font = font(20, "700"); ctx.fillText("SINCE LAUNCH", 56, 232);
  ctx.fillStyle = hasChange ? (change >= 0 ? th.up : th.down) : th.ink;
  ctx.font = font(hasChange ? 112 : 84, "900");
  ctx.shadowColor = hasChange ? (change >= 0 ? th.up : th.down) : "transparent"; ctx.shadowBlur = hasChange ? 26 : 0;
  ctx.fillText(hasChange ? pctLabel(change * p) : "NEW", 52, 332);
  ctx.shadowBlur = 0;

  // Sparkline (right): observed market cap, drawn left to right.
  const cx = 560, cy = 190, cw = W - 56 - cx, ch = 150;
  const pts = (d.points ?? []).filter((n) => Number.isFinite(n));
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(cx, cy + (ch * i) / 3); ctx.lineTo(cx + cw, cy + (ch * i) / 3); ctx.stroke(); }
  if (pts.length >= 2) {
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const xy = (i: number) => [cx + (i / (pts.length - 1)) * cw, cy + ch - ((pts[i] - lo) / span) * (ch - 12) - 6] as const;
    const shown = Math.max(2, Math.ceil(pts.length * p));
    ctx.save(); ctx.beginPath(); ctx.rect(cx - 4, cy - 10, (cw + 8) * p, ch + 20); ctx.clip();
    const fill = ctx.createLinearGradient(0, cy, 0, cy + ch);
    fill.addColorStop(0, `${th.accent}55`); fill.addColorStop(1, `${th.accent}00`);
    ctx.beginPath(); ctx.moveTo(cx, cy + ch);
    for (let i = 0; i < pts.length; i++) ctx.lineTo(...xy(i));
    ctx.lineTo(cx + cw, cy + ch); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(...xy(i)) : ctx.moveTo(...xy(i)));
    ctx.strokeStyle = th.accent; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.shadowColor = th.accent; ctx.shadowBlur = 14; ctx.stroke();
    ctx.restore(); ctx.shadowBlur = 0;
    const [ex, ey] = xy(Math.min(pts.length - 1, shown - 1));
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3; ctx.stroke();
  } else {
    ctx.setLineDash([8, 8]); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy + ch / 2); ctx.lineTo(cx + cw, cy + ch / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = th.muted; ctx.font = font(18, "600"); ctx.fillText("Waiting for the first trades", cx, cy + ch / 2 - 14);
  }

  // The call itself
  ctx.fillStyle = th.ink; ctx.font = font(34, "600");
  const lines = wrap(ctx, d.body || "What's your call?", W - 150, 2);
  lines.forEach((l, i) => ctx.fillText(i === 0 ? `“${l}` : l, 56, 410 + i * 46));
  if (lines.length) { const last = lines[lines.length - 1]; ctx.fillText("”", 56 + ctx.measureText(lines.length === 1 ? `“${last}` : last).width, 410 + (lines.length - 1) * 46); }

  // Footer
  ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(56, H - 112, W - 112, 1);
  ctx.fillStyle = th.muted; ctx.font = font(18, "700"); ctx.fillText("MARKET CAP", 56, H - 74);
  ctx.fillStyle = th.ink; ctx.font = font(44, "900"); ctx.fillText(d.cap, 56, H - 28);
  ctx.textAlign = "right"; ctx.fillStyle = th.accent; ctx.font = font(26, "800"); ctx.fillText("solcameo.com", W - 56, H - 32); ctx.textAlign = "left";

  // Frame
  ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.85; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4); ctx.globalAlpha = 1;
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
