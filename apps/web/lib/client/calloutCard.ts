export type CalloutCardData = { name: string; ticker: string; imageUrl?: string; body: string; cap: string };

export const CARD_W = 1024;
export const CARD_H = 640;

export function loadCardImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  return lines;
}

/** Draws the shareable callout card. Used for both the 3D texture and the exported PNG. */
export function drawCalloutCard(ctx: CanvasRenderingContext2D, d: CalloutCardData, img: HTMLImageElement | null) {
  const W = CARD_W, H = CARD_H;
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1a1f10"); bg.addColorStop(0.55, "#0d0f0a"); bg.addColorStop(1, "#08090a");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 520);
  glow.addColorStop(0, "rgba(215,255,0,0.28)"); glow.addColorStop(1, "rgba(215,255,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // avatar
  const ax = 56, ay = 52, as = 104;
  ctx.save(); ctx.beginPath(); ctx.rect(ax, ay, as, as); ctx.clip();
  if (img) { const s = Math.max(as / img.width, as / img.height); ctx.drawImage(img, ax + (as - img.width * s) / 2, ay + (as - img.height * s) / 2, img.width * s, img.height * s); }
  else { ctx.fillStyle = "#d7ff00"; ctx.fillRect(ax, ay, as, as); ctx.fillStyle = "#0b0c0a"; ctx.font = "700 56px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(d.name.slice(0, 1).toUpperCase(), ax + as / 2, ay + 72); ctx.textAlign = "left"; }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.strokeRect(ax, ay, as, as);
  ctx.fillStyle = "#fff"; ctx.font = "700 46px system-ui, -apple-system, sans-serif"; ctx.fillText(d.name.length > 18 ? `${d.name.slice(0, 17)}…` : d.name, 190, 100);
  ctx.fillStyle = "#d7ff00"; ctx.font = "600 30px ui-monospace, Menlo, monospace"; ctx.fillText(`$${d.ticker}`, 190, 146);
  // tag
  ctx.fillStyle = "rgba(215,255,0,0.12)"; ctx.fillRect(W - 232, 60, 176, 44);
  ctx.strokeStyle = "rgba(215,255,0,0.6)"; ctx.lineWidth = 1.5; ctx.strokeRect(W - 232, 60, 176, 44);
  ctx.fillStyle = "#d7ff00"; ctx.font = "700 22px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("CALLOUT", W - 144, 91); ctx.textAlign = "left";
  // quote
  ctx.fillStyle = "rgba(215,255,0,0.9)"; ctx.font = "700 120px Georgia, serif"; ctx.fillText("“", 50, 290);
  ctx.fillStyle = "#f4f4f0"; ctx.font = "500 40px system-ui, -apple-system, sans-serif";
  const lines = wrap(ctx, d.body || "What's your call?", W - 150, 5);
  lines.forEach((l, i) => ctx.fillText(l, 76, 266 + i * 56));
  // footer
  ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(56, H - 124, W - 112, 1);
  ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "500 22px system-ui, sans-serif"; ctx.fillText("MARKET CAP", 56, H - 78);
  ctx.fillStyle = "#fff"; ctx.font = "700 40px system-ui, sans-serif"; ctx.fillText(d.cap, 56, H - 32);
  ctx.textAlign = "right"; ctx.fillStyle = "#d7ff00"; ctx.font = "700 28px system-ui, sans-serif"; ctx.fillText("solcameo.com", W - 56, H - 36); ctx.textAlign = "left";
  const edge = ctx.createLinearGradient(0, 0, W, H);
  edge.addColorStop(0, "rgba(215,255,0,0.9)"); edge.addColorStop(0.5, "rgba(255,255,255,0.15)"); edge.addColorStop(1, "rgba(215,255,0,0.6)");
  ctx.strokeStyle = edge; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4);
}

/** Renders the card to a PNG. Falls back to an avatar-less card if the image taints the canvas. */
export async function calloutCardBlob(d: CalloutCardData): Promise<Blob | null> {
  const img = await loadCardImage(d.imageUrl);
  for (const attempt of [img, null]) {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W; canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawCalloutCard(ctx, d, attempt);
    const blob = await new Promise<Blob | null>(res => { try { canvas.toBlob(res, "image/png"); } catch { res(null); } });
    if (blob) return blob;
  }
  return null;
}
