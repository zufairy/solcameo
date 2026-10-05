import type { AnalyticsReportData } from "./analyticsPdf";

/**
 * Analytics share card — a 1600×900 canvas (16:9, X's native landscape card).
 * Same canvas feeds three consumers: the Three.js preview texture, the PNG that
 * is posted to X, and the download. `rounded` leaves transparent corners for
 * the 3D plane; the exported image is full-bleed.
 *
 * Direction: black glass, one lime accent used only on the data line + dot,
 * oversized tabular numerals, hairline gradient outlines catching light from
 * the top-left.
 */
export const CARD_W = 1600;
export const CARD_H = 900;

export type ShareCardOptions = { headline: string; showChart: boolean; showTopAgent: boolean; rounded?: boolean };

const INK = "#f6f7f2";
const MUTED = "rgba(246,247,242,0.52)";
const DIM = "rgba(246,247,242,0.3)";
const LIME = "#d7ff00";
const FONT = `Inter, -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: n >= 100_000 ? 0 : 1 }).format(n);

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const spacing = (ctx: CanvasRenderingContext2D, px: number) => { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`; };

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = "left", tracking = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  spacing(ctx, tracking);
  ctx.fillText(s, x, y);
  spacing(ctx, 0);
}

function fit(ctx: CanvasRenderingContext2D, s: string, maxW: number) {
  if (ctx.measureText(s).width <= maxW) return s;
  let v = s;
  while (v.length > 1 && ctx.measureText(`${v}…`).width > maxW) v = v.slice(0, -1);
  return `${v}…`;
}

/** Glass panel: dark fill, top sheen, 1px outline lit from the top-left, inner bottom shade. */
function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = "rgba(16,18,21,0.92)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, y, 0, y + h * 0.6);
  sheen.addColorStop(0, "rgba(255,255,255,0.085)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h * 0.6);
  const shade = ctx.createLinearGradient(0, y + h * 0.7, 0, y + h);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y + h * 0.7, w, h * 0.3);
  ctx.restore();

  const edge = ctx.createLinearGradient(x, y, x + w, y + h);
  edge.addColorStop(0, "rgba(255,255,255,0.55)");
  edge.addColorStop(0.28, "rgba(255,255,255,0.12)");
  edge.addColorStop(0.6, "rgba(255,255,255,0.04)");
  edge.addColorStop(1, "rgba(255,255,255,0.24)");
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.stroke();
  // top specular line
  const spec = ctx.createLinearGradient(x + r, 0, x + w - r, 0);
  spec.addColorStop(0, "rgba(255,255,255,0)");
  spec.addColorStop(0.3, "rgba(255,255,255,0.5)");
  spec.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = spec;
  ctx.fillRect(x + r, y + 1, w - r * 2, 1.5);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawChart(ctx: CanvasRenderingContext2D, series: number[], x: number, y: number, w: number, h: number) {
  const max = Math.max(1, ...series);
  const base = series.length >= 2 ? series : series.length === 1 ? [0, series[0]] : [0, 0];
  const pts = base.map((v, i, a) => ({
    x: x + (i / Math.max(1, a.length - 1)) * w,
    y: y + h - (v / max) * h * 0.92 - h * 0.04,
  }));
  // guides
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  for (let i = 0; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3); ctx.stroke(); }
  ctx.setLineDash([]);
  // smooth path
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i], mx = (p.x + c.x) / 2;
      ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
    }
  };
  path();
  ctx.lineTo(pts[pts.length - 1].x, y + h);
  ctx.lineTo(pts[0].x, y + h);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, "rgba(215,255,0,0.26)");
  fill.addColorStop(1, "rgba(215,255,0,0)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.shadowColor = "rgba(215,255,0,0.65)";
  ctx.shadowBlur = 18;
  path();
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.strokeStyle = LIME;
  ctx.stroke();
  ctx.restore();
  const last = pts[pts.length - 1];
  ctx.beginPath(); ctx.arc(last.x, last.y, 16, 0, Math.PI * 2); ctx.fillStyle = "rgba(215,255,0,0.18)"; ctx.fill();
  ctx.beginPath(); ctx.arc(last.x, last.y, 7, 0, Math.PI * 2); ctx.fillStyle = LIME; ctx.fill();
  ctx.beginPath(); ctx.arc(last.x, last.y, 3, 0, Math.PI * 2); ctx.fillStyle = "#0a0b0c"; ctx.fill();
}

export async function renderAnalyticsShareCard(data: AnalyticsReportData, opts: ShareCardOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  const logo = await loadImage("/brand/solcameo-mark.png");

  // ── Frame ────────────────────────────────────────────────────────────────
  ctx.save();
  if (opts.rounded) { rr(ctx, 0, 0, CARD_W, CARD_H, 44); ctx.clip(); }
  ctx.fillStyle = "#07080a";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glowA = ctx.createRadialGradient(240, 120, 0, 240, 120, 720);
  glowA.addColorStop(0, "rgba(255,255,255,0.09)");
  glowA.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glowA; ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glowB = ctx.createRadialGradient(1480, 820, 0, 1480, 820, 620);
  glowB.addColorStop(0, "rgba(215,255,0,0.075)");
  glowB.addColorStop(1, "rgba(215,255,0,0)");
  ctx.fillStyle = glowB; ctx.fillRect(0, 0, CARD_W, CARD_H);
  // faint dot grid
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let gx = 40; gx < CARD_W; gx += 40) for (let gy = 40; gy < CARD_H; gy += 40) ctx.fillRect(gx, gy, 2, 2);
  ctx.restore();

  const PAD = 96;
  // ── Header ───────────────────────────────────────────────────────────────
  if (logo) ctx.drawImage(logo, PAD, 70, 64, 64);
  text(ctx, "Solcameo", PAD + 82, 114, 36, INK, 650, "left", -0.5);
  const pillLabel = `${data.periodLabel}`.toUpperCase();
  ctx.font = `600 22px ${FONT}`;
  spacing(ctx, 3);
  const pw = ctx.measureText(pillLabel).width + 64;
  spacing(ctx, 0);
  glass(ctx, CARD_W - PAD - pw, 76, pw, 56, 28);
  text(ctx, pillLabel, CARD_W - PAD - pw / 2, 112, 22, MUTED, 600, "center", 3);

  // ── Hero number ──────────────────────────────────────────────────────────
  const heroX = opts.showChart ? PAD : CARD_W / 2;
  const align: CanvasTextAlign = opts.showChart ? "left" : "center";
  ctx.font = `600 24px ${FONT}`;
  const headline = fit(ctx, (opts.headline || data.scopeLabel).toUpperCase(), 640);
  text(ctx, headline, heroX, 228, 24, DIM, 600, align, 4);
  const big = compact(data.totalViews);
  const fitSize = Math.min(opts.showChart ? 214 : 260, Math.floor(720 / Math.max(2.4, big.length * 0.6)));
  ctx.save();
  ctx.font = `700 ${fitSize}px ${FONT}`;
  ctx.textAlign = align;
  const grad = ctx.createLinearGradient(0, 260, 0, 260 + fitSize);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "rgba(255,255,255,0.62)");
  ctx.fillStyle = grad;
  spacing(ctx, -fitSize * 0.035);
  ctx.shadowColor = "rgba(255,255,255,0.18)";
  ctx.shadowBlur = 40;
  ctx.fillText(big, heroX, 262 + fitSize * 0.72);
  ctx.restore();
  text(ctx, "TOTAL VIEWS", heroX, 262 + fitSize * 0.72 + 50, 24, MUTED, 600, align, 5);

  // ── Chart panel ──────────────────────────────────────────────────────────
  if (opts.showChart) {
    const px = 840, py = 176, pw2 = CARD_W - PAD - px, ph = 380;
    glass(ctx, px, py, pw2, ph, 30);
    text(ctx, "VIEWS OVER TIME", px + 36, py + 56, 20, MUTED, 600, "left", 3.5);
    const peak = Math.max(0, ...data.daily.map((d) => d.totalViews));
    text(ctx, `Peak ${compact(peak)}`, px + pw2 - 36, py + 56, 22, INK, 600, "right");
    drawChart(ctx, data.daily.map((d) => d.totalViews), px + 36, py + 92, pw2 - 72, ph - 150);
    const first = data.daily[0]?.label, last = data.daily.at(-1)?.label;
    if (first) text(ctx, first, px + 36, py + ph - 24, 18, DIM, 500, "left");
    if (last && last !== first) text(ctx, last, px + pw2 - 36, py + ph - 24, 18, DIM, 500, "right");
  }

  // ── Stat tiles ───────────────────────────────────────────────────────────
  const tiles = [
    { label: "VIDEOS CREATED", value: compact(data.videosGenerated), hint: data.agentCount > 1 ? `${data.agentCount} agents` : "1 agent" },
    { label: "POSTED", value: compact(data.videosPosted), hint: "to social" },
    { label: "AVG VIEWS / POST", value: compact(Math.round(data.avgViewsPerPost)), hint: "per published video" },
    { label: "POSTING RATE", value: `${Math.round(data.postingRate)}%`, hint: "of videos published" },
  ];
  const gap = 24, tw = (CARD_W - PAD * 2 - gap * 3) / 4, ty = 612, th = 176;
  tiles.forEach((t, i) => {
    const tx = PAD + i * (tw + gap);
    glass(ctx, tx, ty, tw, th, 26);
    text(ctx, t.label, tx + 30, ty + 52, 17, MUTED, 600, "left", 3);
    text(ctx, t.value, tx + 30, ty + 124, 68, INK, 700, "left", -2);
    ctx.font = `500 18px ${FONT}`;
    text(ctx, fit(ctx, t.hint, tw - 60), tx + 30, ty + 156, 18, DIM, 500, "left");
  });

  // ── Footer ───────────────────────────────────────────────────────────────
  text(ctx, "solcameo.com", PAD, 856, 22, DIM, 600, "left", 1);
  const top = opts.showTopAgent && data.agents.length ? [...data.agents].sort((a, b) => b.views - a.views)[0] : null;
  if (top && top.views > 0) {
    ctx.font = `600 22px ${FONT}`;
    text(ctx, `Top agent  ·  ${fit(ctx, top.label, 340)}  ·  ${compact(top.views)} views`, CARD_W - PAD, 856, 22, MUTED, 600, "right");
  } else {
    text(ctx, data.scopeLabel, CARD_W - PAD, 856, 22, MUTED, 600, "right");
  }

  // ── Card outline ─────────────────────────────────────────────────────────
  const edge = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  edge.addColorStop(0, "rgba(255,255,255,0.5)");
  edge.addColorStop(0.3, "rgba(255,255,255,0.1)");
  edge.addColorStop(0.7, "rgba(255,255,255,0.05)");
  edge.addColorStop(1, "rgba(255,255,255,0.28)");
  rr(ctx, 1.5, 1.5, CARD_W - 3, CARD_H - 3, opts.rounded ? 44 : 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = edge;
  ctx.stroke();
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), "image/png"));
}

/** Truthful default post copy built only from the numbers on the card. */
export function draftAnalyticsPost(data: AnalyticsReportData): string {
  const views = compact(data.totalViews);
  const lines = data.totalViews > 0
    ? [`${views} views in ${data.periodLabel.toLowerCase()}.`, `${compact(data.videosPosted)} videos posted by ${data.agentCount > 1 ? `${data.agentCount} AI agents` : "my AI agent"}, ${compact(Math.round(data.avgViewsPerPost))} views per post on average.`, "", "Building it in public with @solcameo."]
    : [`Day one of tracking my AI agents on @solcameo.`, "The scoreboard starts at 0 views. Watch it climb."];
  return lines.join("\n").slice(0, 280);
}
