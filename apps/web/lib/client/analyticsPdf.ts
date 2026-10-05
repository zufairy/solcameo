export type AnalyticsReportData = {
  scopeLabel: string;
  periodLabel: string;
  totalViews: number;
  videosGenerated: number;
  videosPosted: number;
  avgViewsPerPost: number;
  postingRate: number;
  agentCount: number;
  daily: Array<{ label: string; totalViews: number; totalVideos: number }>;
  agents: Array<{ label: string; views: number; videos: number }>;
  topPosts: Array<{ agentName: string; platform: string; views: number; virality?: number }>;
};

export type AnalyticsReportOptions = {
  title: string;
  includeTopPosts: boolean;
  includeAgentBreakdown: boolean;
};

const W = 1240;
const H = 1754;
const ink = "#f7f8f2";
const muted = "#8b9098";
const lime = "#b7f34a";
const panel = "#15181b";

const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = ink, weight = 500) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Inter, Arial, sans-serif`;
  ctx.fillText(text, x, y);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function jpegToPdf(jpeg: ArrayBuffer, imageWidth: number, imageHeight: number) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const add = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string | Uint8Array, suffix = "") => {
    offsets[id] = length;
    add(`${id} 0 obj\n`);
    add(body);
    add(`${suffix}\nendobj\n`);
  };

  add("%PDF-1.4\n%Vello\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Report 4 0 R >> >> /Contents 5 0 R >>");
  offsets[4] = length;
  add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`);
  add(new Uint8Array(jpeg));
  add("\nendstream\nendobj\n");
  const stream = "q\n595 0 0 842 0 0 cm\n/Report Do\nQ";
  object(5, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  const xref = length;
  add("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i += 1) add(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function downloadAnalyticsPdf(data: AnalyticsReportData, options: AnalyticsReportOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not create the report.");

  ctx.fillStyle = "#090b0d";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(1050, 30, 0, 1050, 30, 520);
  glow.addColorStop(0, "rgba(183,243,74,.16)");
  glow.addColorStop(1, "rgba(183,243,74,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 600);

  try {
    const logo = await loadImage("/vello-logo-white.png");
    ctx.drawImage(logo, 74, 64, 173, 52);
  } catch {
    drawText(ctx, "VELLO", 74, 103, 40, ink, 800);
  }
  drawText(ctx, "EXECUTIVE ANALYTICS", 902, 94, 17, lime, 700);
  drawText(ctx, fitText(ctx, options.title || "Content Performance Report", 900), 74, 205, 51, ink, 650);
  drawText(ctx, `${data.scopeLabel}  •  ${data.periodLabel}`, 76, 249, 21, muted, 500);
  drawText(ctx, `Generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`, 76, 282, 17, "#5f656c", 400);

  const metrics = [
    ["TOTAL VIEWS", compact(data.totalViews)],
    ["VIDEOS GENERATED", compact(data.videosGenerated)],
    ["VIDEOS POSTED", compact(data.videosPosted)],
    ["AVG VIEWS / POST", compact(data.avgViewsPerPost)],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 74 + index * 275;
    roundedRect(ctx, x, 335, 251, 142, 20);
    ctx.fillStyle = panel;
    ctx.fill();
    drawText(ctx, label, x + 24, 374, 14, muted, 650);
    drawText(ctx, value, x + 24, 437, 38, index === 0 ? lime : ink, 700);
  });

  drawText(ctx, "PERFORMANCE TREND", 74, 555, 17, ink, 700);
  drawText(ctx, `${Math.round(data.postingRate)}% posting rate across ${data.agentCount} agent${data.agentCount === 1 ? "" : "s"}`, 74, 585, 17, muted, 450);
  roundedRect(ctx, 74, 617, 1092, 365, 24);
  ctx.fillStyle = panel;
  ctx.fill();
  const chart = { x: 112, y: 663, w: 1016, h: 245 };
  for (let i = 0; i < 4; i += 1) {
    const y = chart.y + (chart.h / 3) * i;
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.beginPath(); ctx.moveTo(chart.x, y); ctx.lineTo(chart.x + chart.w, y); ctx.stroke();
  }
  const values = data.daily.map((d) => d.totalViews);
  const max = Math.max(...values, 1);
  if (values.length > 0) {
    ctx.strokeStyle = lime;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = chart.x + (values.length === 1 ? chart.w / 2 : (index / (values.length - 1)) * chart.w);
      const y = chart.y + chart.h - (value / max) * chart.h;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    drawText(ctx, data.daily[0].label, chart.x, 953, 15, muted, 500);
    ctx.textAlign = "right";
    drawText(ctx, data.daily.at(-1)?.label ?? "", chart.x + chart.w, 953, 15, muted, 500);
    ctx.textAlign = "left";
  } else {
    drawText(ctx, "No activity recorded in this range", 415, 817, 22, muted, 500);
  }

  const sectionY = 1063;
  const columns: Array<{ title: string; rows: Array<{ left: string; middle: string; right: string }> }> = [];
  if (options.includeTopPosts) {
    columns.push({ title: "TOP CONTENT", rows: data.topPosts.slice(0, 5).map((post) => ({
      left: post.agentName,
      middle: post.platform,
      right: `${compact(post.views)} views${post.virality == null ? "" : `  •  ${Math.round(post.virality)}/100`}`,
    })) });
  }
  if (options.includeAgentBreakdown) {
    columns.push({ title: "AGENT PERFORMANCE", rows: data.agents.slice(0, 5).map((agent) => ({
      left: agent.label,
      middle: `${agent.videos} videos`,
      right: `${compact(agent.views)} views`,
    })) });
  }
  if (columns.length === 0) columns.push({
    title: "EXECUTIVE SUMMARY",
    rows: [{ left: data.scopeLabel, middle: `${data.videosPosted} posts`, right: `${compact(data.totalViews)} views` }],
  });

  const colGap = 28;
  const colWidth = columns.length === 1 ? 1092 : (1092 - colGap) / 2;
  columns.slice(0, 2).forEach((column, colIndex) => {
    const x = 74 + colIndex * (colWidth + colGap);
    drawText(ctx, column.title, x, sectionY, 17, ink, 700);
    roundedRect(ctx, x, sectionY + 28, colWidth, 420, 24);
    ctx.fillStyle = panel;
    ctx.fill();
    if (column.rows.length === 0) drawText(ctx, "No data in this range", x + 28, sectionY + 95, 18, muted, 500);
    column.rows.forEach((row, index) => {
      const y = sectionY + 83 + index * 67;
      if (index > 0) { ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(x + 25, y - 31); ctx.lineTo(x + colWidth - 25, y - 31); ctx.stroke(); }
      ctx.font = "600 18px Inter, Arial, sans-serif";
      drawText(ctx, fitText(ctx, row.left, colWidth * .42), x + 27, y, 18, ink, 600);
      drawText(ctx, row.middle, x + colWidth * .48, y, 15, muted, 500);
      ctx.textAlign = "right";
      drawText(ctx, row.right, x + colWidth - 27, y, 15, lime, 650);
      ctx.textAlign = "left";
    });
  });

  ctx.strokeStyle = "rgba(255,255,255,.1)";
  ctx.beginPath(); ctx.moveTo(74, 1633); ctx.lineTo(1166, 1633); ctx.stroke();
  drawText(ctx, "Prepared with Vello", 74, 1680, 17, muted, 500);
  ctx.textAlign = "right";
  drawText(ctx, "AI content performance, made clear.", 1166, 1680, 17, "#5f656c", 450);

  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render report.")), "image/jpeg", 0.93));
  const pdf = jpegToPdf(await jpeg.arrayBuffer(), W, H);
  const url = URL.createObjectURL(pdf);
  const link = document.createElement("a");
  const safeScope = data.scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.href = url;
  link.download = `vello-analytics-${safeScope || "report"}-${new Date().toISOString().slice(0, 10)}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
