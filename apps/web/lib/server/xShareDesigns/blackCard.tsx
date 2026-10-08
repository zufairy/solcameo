/* ════════ Share on X — the premium SOLCAMEO BLACK card ════════
   Restored from 56d67500 — the original premium, invite-only design: black +
   gold foil, engine-turned hairlines, engraved corner brackets, a dense
   typographic column and the embossed black membership card with its crest
   rings. It serves the SOLCAMEO BLACK tier (see ../xShareCardRender.tsx).

   Animated cheaply: background, card and crest are laid out ONCE; per frame
   a gold foil sheen sweeps the card (a tiny clipped SVG) and the view count
   rolls up (only the copy column is re-laid-out, hold frames reuse it). */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import satori from "satori";
import sharp from "sharp";
import type { ShareAgentData } from "@/lib/server/xShareCardRender";
import { CARD_H, CARD_W, compactNumber, hashSeed, memberIdFor, tierFor } from "@/lib/share/xShareCard";

const GOLD = "#CDAE6E";
const GOLD_SOFT = "rgba(205,174,110,0.16)";
const BG = "#050505";
const GLOW = "rgba(205,174,110,0.13)";

const PANEL_W = 440;
const PANEL_H = 268;
const RINGS = [{ size: 600, opacity: 0.07 }, { size: 500, opacity: 0.1 }, { size: 410, opacity: 0.13 }, { size: 330, opacity: 0.16 }];

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 900; style: "normal" };
const SOCIAL_PATHS: Record<string, string> = {
  x: '<path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.5L1.9 2h6.5l4.5 6.9L18.9 2Zm-1.1 18h1.7L7.4 3.9H5.6L17.8 20Z"/>',
  youtube: '<path d="M22.5 6.3a2.8 2.8 0 0 0-2-2C18.7 3.8 12 3.8 12 3.8s-6.7 0-8.5.5a2.8 2.8 0 0 0-2 2C1 8.1 1 12 1 12s0 3.9.5 5.7a2.8 2.8 0 0 0 2 2c1.8.5 8.5.5 8.5.5s6.7 0 8.5-.5a2.8 2.8 0 0 0 2-2c.5-1.8.5-5.7.5-5.7s0-3.9-.5-5.7ZM9.7 15.5v-7l6 3.5-6 3.5Z"/>',
  tiktok: '<path d="M12.5 1h4c.1 3.2 2 5.1 5.4 5.4v4c-2-.1-3.8-.7-5.4-1.8v7.1c0 4.3-2.8 7.2-6.8 7.2A6.8 6.8 0 0 1 3 16.1c0-4.2 3.3-7 7.3-6.8v4.2c-1.8-.4-3.3.7-3.3 2.6 0 1.6 1.3 2.8 2.9 2.8 1.8 0 2.6-1.4 2.6-3.1V1Z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="white" stroke-width="2.2"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="white" stroke-width="2.2"/><circle cx="17.7" cy="6.4" r="1.25"/>',
  facebook: '<path d="M14.3 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.8 1.8-1.8H18V2.4c-.9-.1-1.9-.2-2.9-.2-3 0-5 1.8-5 5.1v2.2H7V13h3.1v9h4.2Z"/>',
  linkedin: '<path d="M4.4 8.5H.9V22h3.5V8.5ZM2.7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM22 14.1c0-3.6-1.9-5.3-4.5-5.3-2.1 0-3 1.1-3.5 1.9V8.5h-3.5V22H14v-7.5c0-1.9.9-2.8 2.4-2.8 1.4 0 2.1.9 2.1 2.8V22H22v-7.9Z"/>',
  threads: '<path d="M12 2c-5.5 0-9 3.7-9 10s3.5 10 9 10c4.6 0 7.9-2.6 7.9-6.5 0-2.7-1.6-4.5-4.6-5.3-.5-2.2-1.7-3.2-3.7-3.2-1.6 0-2.9.7-3.7 1.9l2.1 1.4c.4-.6.9-.9 1.6-.9.7 0 1.1.3 1.3 1-3.7-.3-5.9 1.2-5.9 3.8 0 2.2 1.7 3.6 4.2 3.6 2.4 0 4-1.6 4.2-4.2 1.3.5 1.8 1.5 1.8 2.4 0 2.3-1.8 3.8-4.9 3.8-4 0-6.4-2.8-6.4-7.5S8 4.6 12 4.6c2.8 0 4.5 1.2 5.2 3.5l2.6-.7C18.7 3.9 16 2 12 2Zm-.7 13.3c-.9 0-1.4-.4-1.4-1.1 0-.9 1.1-1.3 3.3-1.1-.1 1.4-.7 2.2-1.9 2.2Z"/>',
};

interface Assets { fonts: Font[]; socialIcons: Record<string, string> }
let assetsPromise: Promise<Assets> | null = null;

const pub = (...p: string[]) => join(process.cwd(), "public", ...p);
const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const pngDataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

function loadAssets(): Promise<Assets> {
  assetsPromise ??= (async () => {
    const [anton, grotesk, archivo] = await Promise.all([
      readFile(pub("fonts", "captions", "Anton-Regular.ttf")),
      readFile(pub("fonts", "captions", "SpaceGrotesk-Medium.ttf")),
      readFile(pub("fonts", "captions", "ArchivoBlack-Regular.ttf")),
    ]);
    const fonts: Font[] = [
      { name: "Anton", data: toArrayBuffer(anton), weight: 400, style: "normal" },
      { name: "Grotesk", data: toArrayBuffer(grotesk), weight: 500, style: "normal" },
      { name: "Archivo", data: toArrayBuffer(archivo), weight: 900, style: "normal" },
    ];
    const socialIcons: Record<string, string> = Object.fromEntries(await Promise.all(Object.entries(SOCIAL_PATHS).map(async ([id, path]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="80" height="80" fill="white">${path}</svg>`;
      return [id, pngDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())];
    })));
    return { fonts, socialIcons };
  })().catch((e) => { assetsPromise = null; throw e; });
  return assetsPromise;
}

/** Remote or /public avatar → small PNG data URL (satori chokes on webp). */
async function avatarDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    let buf: Buffer;
    if (url.startsWith("/")) {
      const root = pub();
      const file = join(root, url.replace(/^\/+/, ""));
      if (!file.startsWith(root + "/") || url.includes("..")) return null;
      buf = await readFile(file);
    } else {
      if (!/^https?:\/\//.test(url)) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    return pngDataUrl(await sharp(buf).resize(160, 160, { fit: "cover" }).png().toBuffer());
  } catch {
    return null;
  }
}

/* ── Layout ────────────────────────────────────────────────────────────────── */

interface Geo { panelLeft: boolean; angle: number; panelX: number; panelY: number; textLeft: number }

function geoFor(mint: string, nonce: string | number): Geo {
  const panelLeft = hashSeed(mint, nonce, "black-layout") % 2 === 1;
  return {
    panelLeft,
    angle: panelLeft ? 5 : -5,
    panelX: panelLeft ? -30 : CARD_W - 410,
    panelY: Math.round((CARD_H - PANEL_H) / 2),
    textLeft: panelLeft ? 480 : 64,
  };
}

function nameSize(name: string) {
  const n = name.length;
  return n <= 8 ? 72 : n <= 12 ? 58 : n <= 18 ? 46 : 34;
}

function viewsSize(text: string) {
  return text === "0" ? 130 : text.length <= 3 ? 150 : text.length <= 5 ? 132 : 112;
}

/** Engine-turned hairlines, corner brackets, header, crest rings and the
 *  embossed black card — everything that never moves. */
function Background({ g, memberId }: { g: Geo; memberId: string }) {
  const glowX = g.panelLeft ? "22%" : "78%";
  const rows = 34, step = CARD_H / rows;
  return (
    <div style={{ width: CARD_W, height: CARD_H, display: "flex", position: "relative", backgroundColor: BG, backgroundImage: `radial-gradient(circle at ${glowX} 45%, ${GLOW} 0%, rgba(0,0,0,0) 60%)`, fontFamily: "Grotesk", color: "#fff" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: CARD_W, height: CARD_H, display: "flex", flexDirection: "column" }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: "flex", width: CARD_W, height: step, borderBottom: `1px solid ${GOLD}`, opacity: 0.05 }} />
        ))}
      </div>
      {[[28, 28, 0], [CARD_W - 60, 28, 90], [28, CARD_H - 60, 270], [CARD_W - 60, CARD_H - 60, 180]].map(([x, y, rot], i) => (
        <div key={i} style={{ position: "absolute", left: x, top: y, width: 32, height: 32, display: "flex", transform: `rotate(${rot}deg)` }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: 32, height: 1, backgroundColor: "rgba(205,174,110,0.45)", display: "flex" }} />
          <div style={{ position: "absolute", left: 0, top: 0, width: 1, height: 32, backgroundColor: "rgba(205,174,110,0.45)", display: "flex" }} />
        </div>
      ))}

      {/* crest rings + the card */}
      <div style={{ position: "absolute", left: g.panelX, top: g.panelY, width: PANEL_W, height: PANEL_H, display: "flex", transform: `rotate(${g.angle}deg)` }}>
        {RINGS.map((r, i) => (
          <div key={i} style={{ position: "absolute", left: PANEL_W / 2 - r.size / 2, top: PANEL_H / 2 - r.size / 2, width: r.size, height: r.size, borderRadius: 999, border: `1px solid ${GOLD}`, opacity: r.opacity, display: "flex" }} />
        ))}
        <div style={{
          position: "absolute", left: 0, top: 0, width: PANEL_W, height: PANEL_H, borderRadius: 22, display: "flex", flexDirection: "column", padding: 26,
          backgroundImage: "linear-gradient(145deg, #171614 0%, #0b0b0a 60%, #050505 100%)", border: `1px solid ${GOLD}`,
          boxShadow: `0 30px 70px -20px rgba(0,0,0,0.85), 0 0 0 5px ${GOLD_SOFT}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", width: 46, height: 34, borderRadius: 7, backgroundImage: "linear-gradient(135deg, #e8cf95, #86692f)", border: "1px solid rgba(0,0,0,0.35)" }} />
            <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 15, letterSpacing: 3, color: "rgba(236,230,216,0.55)" }}>SOLCAMEO</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            <div style={{ display: "flex", fontFamily: "Anton", fontSize: 44, letterSpacing: 1, color: GOLD }}>SOLCAMEO BLACK</div>
            <div style={{ display: "flex", fontFamily: "Grotesk", fontSize: 14, letterSpacing: 3, color: "rgba(236,230,216,0.5)", marginTop: 4 }}>INVITE ONLY</div>
          </div>
          <div style={{ display: "flex", marginTop: 18, fontFamily: "Grotesk", fontSize: 19, letterSpacing: 3, color: "rgba(236,230,216,0.78)" }}>{`•••• •••• •••• ${memberId.slice(-4)}`}</div>
        </div>
      </div>

      {/* header */}
      <div style={{ position: "absolute", left: 40, top: 32, display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, border: `1px solid ${GOLD}`, borderRadius: 4, marginRight: 10 }}>
          <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 11, color: GOLD }}>V</div>
        </div>
        <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 13, letterSpacing: 3, color: "rgba(255,255,255,0.85)" }}>SOLCAMEO</div>
        <div style={{ display: "flex", width: 1, height: 12, backgroundColor: "rgba(255,255,255,0.2)", marginLeft: 12, marginRight: 12 }} />
        <div style={{ display: "flex", fontFamily: "Grotesk", fontSize: 13, letterSpacing: 2, color: "rgba(255,255,255,0.4)" }}>MEMBERSHIP</div>
      </div>
      <div style={{ position: "absolute", right: 40, top: 32, display: "flex", fontFamily: "Grotesk", fontSize: 13, letterSpacing: 2, color: "rgba(255,255,255,0.35)" }}>{`N° ${memberId}`}</div>
      <div style={{ position: "absolute", left: g.textLeft, top: CARD_H - 46, display: "flex", fontSize: 13, color: "rgba(255,255,255,0.35)" }}>solcameo.com</div>
    </div>
  );
}

function Copy({ data, g, views, avatar, socialIcons }: { data: ShareAgentData; g: Geo; views: number; avatar: string | null; socialIcons: Record<string, string> }) {
  const { stats } = data;
  const displayName = stats.name.length > 22 ? `${stats.name.slice(0, 20).trimEnd()}…` : stats.name;
  const tier = tierFor(stats.views);
  const plats = [...new Set(stats.platforms.map((id) => (id === "twitter" ? "x" : id)))].filter((id) => socialIcons[id]).slice(0, 5);
  return (
    <div style={{ width: CARD_W, height: CARD_H, display: "flex", position: "relative", fontFamily: "Grotesk", color: "#fff" }}>
      <div style={{ position: "absolute", left: g.textLeft, top: 92, width: 600, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" width={64} height={64} style={{ borderRadius: 10, border: `1px solid ${GOLD}`, marginRight: 18 }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 10, border: `1px solid ${GOLD}`, backgroundColor: "rgba(255,255,255,0.04)", marginRight: 18 }}>
              <div style={{ display: "flex", fontFamily: "Anton", fontSize: 28, color: GOLD }}>{(stats.name[0] ?? "V").toUpperCase()}</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: "Anton", fontSize: nameSize(displayName), lineHeight: 1, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{displayName}</div>
            {stats.handle ? <div style={{ display: "flex", fontSize: 16, color: "rgba(255,255,255,0.5)", marginTop: 5 }}>{`@${stats.handle}`}</div> : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
          <div style={{ display: "flex", padding: "5px 12px", border: `1px solid ${GOLD}`, borderRadius: 3, fontFamily: "Archivo", fontSize: 13, letterSpacing: 2, color: GOLD }}>{`${tier.label} · ${tier.zone.toUpperCase()}`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 14 }}>
          {/* sized on the FINAL count so the roll-up doesn't jitter the layout */}
          <div style={{ display: "flex", fontFamily: "Anton", fontSize: viewsSize(compactNumber(stats.views)), lineHeight: 1, color: GOLD }}>{compactNumber(views)}</div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>TRACKED</div>
            <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>VIEWS</div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 16 }}>
          {[["Videos", String(stats.videos)], ["Posted", String(stats.posted)], ["Best clip", compactNumber(stats.bestViews)]].map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", marginRight: 12, padding: "9px 16px", border: "1px solid rgba(205,174,110,0.25)", borderRadius: 4 }}>
              <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 24 }}>{value}</div>
              <div style={{ display: "flex", fontSize: 12, letterSpacing: 2, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
        {plats.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
            <div style={{ display: "flex", fontSize: 12, letterSpacing: 2, color: "rgba(255,255,255,0.4)", marginRight: 10, textTransform: "uppercase" }}>Live on</div>
            {plats.map((id) => (
              <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, marginRight: 8, borderRadius: 6, border: "1px solid rgba(205,174,110,0.3)", backgroundColor: "rgba(255,255,255,0.03)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={socialIcons[id]} alt={id} width={16} height={16} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Gold foil light sweeping across the (rotated) card, clipped to it. */
function sheenSvg(g: Geo, t: number): Buffer {
  const cx = g.panelX + PANEL_W / 2, cy = g.panelY + PANEL_H / 2;
  const x = g.panelX - 260 + t * (PANEL_W + 520);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}"><defs>
<clipPath id="c"><rect x="${g.panelX}" y="${g.panelY}" width="${PANEL_W}" height="${PANEL_H}" rx="22"/></clipPath>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f3dfae" stop-opacity="0"/><stop offset=".5" stop-color="#f3dfae" stop-opacity=".2"/><stop offset="1" stop-color="#f3dfae" stop-opacity="0"/></linearGradient>
</defs><g transform="rotate(${g.angle} ${cx} ${cy})" clip-path="url(#c)"><polygon points="${x},${g.panelY - 40} ${x + 170},${g.panelY - 40} ${x + 70},${g.panelY + PANEL_H + 40} ${x - 100},${g.panelY + PANEL_H + 40}" fill="url(#s)"/></g></svg>`);
}

/* ── Render ────────────────────────────────────────────────────────────────── */

const FRAMES = 30;
const COUNT_FRAMES = 10;
const FRAME_MS = 100;

async function prepare(data: ShareAgentData, nonce: string | number) {
  const [assets, avatar] = await Promise.all([loadAssets(), avatarDataUrl(data.avatarUrl)]);
  const g = geoFor(data.mint, nonce);
  const opts = { width: CARD_W, height: CARD_H, fonts: assets.fonts };
  const bg = await sharp(Buffer.from(await satori(<Background g={g} memberId={memberIdFor(data.mint)} />, opts))).png().toBuffer();
  const copyFor = async (views: number) =>
    sharp(Buffer.from(await satori(<Copy data={data} g={g} views={views} avatar={avatar} socialIcons={assets.socialIcons} />, opts))).png().toBuffer();
  return { bg, g, copyFor };
}

export async function blackPng(data: ShareAgentData, nonce: string | number): Promise<Buffer> {
  const p = await prepare(data, nonce);
  return sharp(p.bg).composite([{ input: sheenSvg(p.g, 0.42) }, { input: await p.copyFor(data.stats.views) }]).png({ compressionLevel: 6 }).toBuffer();
}

export async function blackGif(data: ShareAgentData, nonce: string | number): Promise<Buffer> {
  const p = await prepare(data, nonce);
  const ease = (n: number) => 1 - Math.pow(1 - n, 3);
  const copies = await Promise.all(Array.from({ length: COUNT_FRAMES }, (_, i) => p.copyFor(Math.round(data.stats.views * ease((i + 1) / COUNT_FRAMES)))));
  const frames = await Promise.all(Array.from({ length: FRAMES }, (_, i) =>
    sharp(p.bg).composite([{ input: sheenSvg(p.g, i / FRAMES) }, { input: copies[Math.min(i, COUNT_FRAMES - 1)] }]).removeAlpha().raw().toBuffer()));
  return sharp(Buffer.concat(frames), { raw: { width: CARD_W, height: CARD_H * FRAMES, channels: 3, pageHeight: CARD_H } })
    .gif({ delay: frames.map(() => FRAME_MS), loop: 0, effort: 5, dither: 0.3, interFrameMaxError: 4 })
    .toBuffer();
}
