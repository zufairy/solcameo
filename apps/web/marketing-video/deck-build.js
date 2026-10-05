const pptxgen = require("pptxgenjs");
const React = require("react");
const RD = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa6");

// ---- palette (dark + lime brand) ----
const BG = "0A0A0F", CARD = "14141E", CARD2 = "191924", CARDB = "26262F",
  LIME = "A3E635", LIME2 = "C7F464", LIMEDK = "84CC16", WHITE = "F6F7F2",
  SUB = "A0A0B4", FAINT = "6C6880", INKB = "0A0A0F", GREEN = "34D399";
const Fh = "Arial", Fb = "Arial";
const W = 13.333, H = 7.5, M = 0.62;

const ICONS = { bolt: fa.FaBolt, users: fa.FaUsers, globe: fa.FaGlobe, chart: fa.FaChartLine, check: fa.FaCircleCheck, brief: fa.FaClipboardList, rocket: fa.FaRocket, shield: fa.FaShieldHalved, file: fa.FaFileLines, cal: fa.FaCalendarCheck, clock: fa.FaClock, coins: fa.FaCoins, wand: fa.FaWandMagicSparkles, thumb: fa.FaThumbsUp, layers: fa.FaLayerGroup, film: fa.FaFilm, repeat: fa.FaRepeat, eye: fa.FaEye, gauge: fa.FaGaugeHigh, arrow: fa.FaArrowRightLong, play: fa.FaPlay, seed: fa.FaSeedling };
const _ic = {};
async function icon(key, color) { const k = key + color; if (_ic[k]) return _ic[k]; const C = ICONS[key] || fa.FaCircle; const svg = RD.renderToStaticMarkup(React.createElement(C, { color: "#" + color, size: "256" })); const png = await sharp(Buffer.from(svg)).png().toBuffer(); return (_ic[k] = "image/png;base64," + png.toString("base64")); }
const shDark = () => ({ type: "outer", color: "000000", blur: 12, offset: 4, angle: 90, opacity: 0.5 });
const shLime = () => ({ type: "outer", color: "84CC16", blur: 16, offset: 0, angle: 90, opacity: 0.28 });

async function prep() {
  const grad = (stops) => Buffer.from(`<svg width="1376" height="768"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs><rect width="1376" height="768" fill="url(#g)"/></svg>`);
  await sharp("swarm.png").composite([{ input: grad('<stop offset="0" stop-color="#06070C" stop-opacity="0.94"/><stop offset="0.5" stop-color="#06070C" stop-opacity="0.5"/><stop offset="1" stop-color="#06070C" stop-opacity="0.2"/>') }]).png().toFile("cover_bg.png");
  const vgrad = Buffer.from(`<svg width="1376" height="768"><defs><radialGradient id="r" cx="0.5" cy="0.45" r="0.75"><stop offset="0.15" stop-color="#06070C" stop-opacity="0.35"/><stop offset="1" stop-color="#06070C" stop-opacity="0.9"/></radialGradient></defs><rect width="1376" height="768" fill="url(#r)"/></svg>`);
  await sharp("hero-economy.png").composite([{ input: vgrad }]).png().toFile("close_bg.png");
  async function round(src, out, w, h, r) { const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}"/></svg>`); await sharp(src).resize(w, h, { fit: "cover", position: "attention" }).composite([{ input: mask, blend: "dest-in" }]).png().toFile(out); }
  await round("agent-influencer.png", "inf_round.png", 1000, 1120, 40);
  await round("agent-clipper.png", "clip_round.png", 1180, 900, 40);
  await round("agent-trader.png", "trader_round.png", 900, 900, 40);
}

async function main() {
  await prep();
  const p = new pptxgen(); p.defineLayout({ name: "W", width: W, height: H }); p.layout = "W";
  p.author = "Vello"; p.title = "Vello, Managed Content Packages";

  function bgDark(s) { s.background = { color: BG }; }
  function kicker(s, x, y, t) { s.addText(t.toUpperCase(), { x, y, w: 9, h: 0.3, fontFace: Fh, fontSize: 12, bold: true, color: LIME, charSpacing: 3, margin: 0 }); }
  function title(s, x, y, t, w = 11.5, size = 32) { s.addText(t, { x, y, w, h: 1.0, fontFace: Fh, fontSize: size, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 0.98 }); }
  async function iconChip(s, x, y, d, key, ic = LIME, circle = "1B2110") { s.addShape(p.shapes.OVAL, { x, y, w: d, h: d, fill: { color: circle } }); const id = d * 0.5; s.addImage({ data: await icon(key, ic), x: x + (d - id) / 2, y: y + (d - id) / 2, w: id, h: id }); }
  function numChip(s, x, y, d, n) { s.addShape(p.shapes.OVAL, { x, y, w: d, h: d, fill: { color: LIME } }); s.addText(String(n), { x, y, w: d, h: d, align: "center", valign: "middle", fontFace: Fh, fontSize: 15, bold: true, color: INKB, margin: 0 }); }
  function logoW(s, x, y, w = 1.95) { s.addImage({ path: "wordmark-white.png", x, y, w, h: w * 0.3 }); }
  function foot(s, n) { s.addText("VELLO", { x: M, y: H - 0.5, w: 2, h: 0.3, fontFace: Fh, fontSize: 12, bold: true, color: LIME, charSpacing: 2, margin: 0 }); s.addText("Managed Content Packages", { x: W / 2 - 2, y: H - 0.48, w: 4, h: 0.3, align: "center", fontFace: Fb, fontSize: 9, color: FAINT, margin: 0, charSpacing: 1 }); s.addText(String(n).padStart(2, "0"), { x: W - M - 0.6, y: H - 0.5, w: 0.6, h: 0.3, align: "right", fontFace: Fb, fontSize: 10, color: FAINT, margin: 0 }); }
  function card(s, x, y, w, h, fill = CARD) { s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: CARDB, width: 1 }, shadow: shDark() }); }

  // 1. COVER
  {
    const s = p.addSlide(); bgDark(s);
    s.addImage({ path: "cover_bg.png", x: 0, y: 0, w: W, h: H, sizing: { type: "cover", w: W, h: H } });
    logoW(s, M, 0.6, 2.25);
    s.addText("CLIENT PROPOSAL", { x: W - M - 3, y: 0.72, w: 3, h: 0.3, align: "right", fontFace: Fh, fontSize: 11, bold: true, color: LIME, charSpacing: 3, margin: 0 });
    s.addText("A swarm of AI creators,\non demand.", { x: M, y: 2.4, w: 9.6, h: 1.9, fontFace: Fh, fontSize: 52, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 0.98 });
    s.addText("Managed content packages that put your brand on every feed, every day. Produced and posted by a roster of unique AI creators.", { x: M, y: 4.42, w: 8.4, h: 1, fontFace: Fb, fontSize: 17, color: "D5D2C6", margin: 0, lineSpacingMultiple: 1.18 });
    const chips = ["50 to 100 creator accounts", "Every major platform", "Weekly reporting"]; let cx = M;
    for (const c of chips) { const w = 0.34 + c.length * 0.098; s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: 5.72, w, h: 0.5, rectRadius: 0.25, fill: { color: "0E1108" }, line: { color: LIMEDK, width: 1 } }); s.addText(c, { x: cx, y: 5.72, w, h: 0.5, align: "center", valign: "middle", fontFace: Fb, fontSize: 12, color: LIME2, margin: 0 }); cx += w + 0.22; }
    s.addText("Prepared for  ___________________       2026       Confidential", { x: M, y: H - 0.62, w: 11, h: 0.3, fontFace: Fb, fontSize: 11, color: "8C8898", margin: 0 });
  }

  // 2. WHY NOW
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "Why now"); title(s, M, 0.96, "Attention is won in volume, and old playbooks can't keep up.", 12, 30);
    s.addText("Short video is where your audience actually is, and the feed rewards brands that show up constantly, natively, from many voices. Hiring creators one at a time, or briefing an agency for a handful of posts a month, cannot produce at that speed or scale.", { x: M, y: 2.15, w: 5.7, h: 2.3, fontFace: Fb, fontSize: 16, color: "CFCEDA", margin: 0, lineSpacingMultiple: 1.28 });
    s.addText("The result: brands underspend on the one thing that moves attention, which is consistent, high-volume, platform-native video.", { x: M, y: 4.6, w: 5.7, h: 1.2, fontFace: Fb, fontSize: 15, italic: true, color: LIME2, margin: 0, lineSpacingMultiple: 1.2 });
    const cards = [["users", "One creator at a time", "Sourcing and managing each creator by hand does not scale past a handful."], ["clock", "Weeks to produce", "Traditional UGC and agency cycles measure delivery in weeks, not hours."], ["coins", "$8k to $15k retainers", "Agency retainers buy only a handful of posts a month. A high price per asset."]];
    let y = 2.05; for (const [ic, h, d] of cards) { card(s, 6.7, y, 6.0, 1.3, CARD); await iconChip(s, 6.96, y + 0.29, 0.72, ic); s.addText(h, { x: 7.86, y: y + 0.22, w: 4.6, h: 0.4, fontFace: Fh, fontSize: 16, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: 7.86, y: y + 0.62, w: 4.6, h: 0.6, fontFace: Fb, fontSize: 12.5, color: SUB, margin: 0, lineSpacingMultiple: 1.1 }); y += 1.5; }
    foot(s, 2);
  }

  // 3. WHAT VELLO IS  (image right)
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "What Vello is"); title(s, M, 0.96, "A whole roster of AI creators, working your brand every day.", 7.7, 29);
    s.addText("Each account is a unique AI influencer with its own face, voice and persona. It scripts, clips and posts short videos about you across TikTok, Reels, Shorts and X. You get a swarm working in parallel, not one creator at a time.", { x: M, y: 2.2, w: 6.0, h: 2.0, fontFace: Fb, fontSize: 15.5, color: "CFCEDA", margin: 0, lineSpacingMultiple: 1.26 });
    const rows = [["wand", "Unique by design", "No two accounts or videos are alike. The anti-slop guarantee."], ["globe", "Every platform", "TikTok, Instagram Reels, YouTube Shorts and X."], ["bolt", "Every single day", "Always-on presence, no gaps, no burnout."], ["thumb", "You stay in control", "Set the guardrails, approve direction, get a weekly report."]];
    let y = 4.35; for (let i = 0; i < 4; i++) { const [ic, h, d] = rows[i]; const col = i % 2, r = Math.floor(i / 2); const x = M + col * 3.05; const yy = y + r * 1.15; await iconChip(s, x, yy, 0.6, ic); s.addText(h, { x: x + 0.75, y: yy - 0.04, w: 2.3, h: 0.35, fontFace: Fh, fontSize: 14, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: x + 0.75, y: yy + 0.32, w: 2.3, h: 0.6, fontFace: Fb, fontSize: 10.5, color: SUB, margin: 0, lineSpacingMultiple: 1.08 }); }
    // framed image right
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 8.72, y: 1.28, w: 4.02, h: 4.5, rectRadius: 0.16, fill: { color: CARD }, line: { color: LIMEDK, width: 1.5 }, shadow: shLime() });
    s.addImage({ path: "inf_round.png", x: 8.85, y: 1.4, w: 3.76, h: 4.26 });
    foot(s, 3);
  }

  // 4. PROCESS
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "The process"); title(s, M, 0.96, "How it works, from kickoff to compounding.", 12, 30);
    const steps = [["brief", "Kickoff and brief", "We align on your brand, guardrails, key messages and target platforms."], ["layers", "Build your roster", "We spin up unique AI creator accounts matched to your niche and audience."], ["film", "Content engine", "Scripts, hooks and clips are produced daily. Quality-gated, never slop."], ["globe", "Daily posting", "The swarm posts natively across every platform, all day, every day."], ["eye", "Verified tracking", "Views are tracked over a 7-day window, so results are real, not vanity."], ["chart", "Report and optimize", "Every week we report, then double down on the accounts and hooks that win."]];
    const cw = 3.85, ch = 1.98, gx = 0.28, gy = 0.34, x0 = M, y0 = 2.05;
    for (let i = 0; i < 6; i++) { const [ic, h, d] = steps[i]; const r = Math.floor(i / 3), c = i % 3; const x = x0 + c * (cw + gx), y = y0 + r * (ch + gy); card(s, x, y, cw, ch, CARD); numChip(s, x + 0.28, y + 0.28, 0.5, i + 1); await iconChip(s, x + cw - 0.9, y + 0.24, 0.6, ic); s.addText(h, { x: x + 0.28, y: y + 0.86, w: cw - 0.5, h: 0.4, fontFace: Fh, fontSize: 16, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: x + 0.28, y: y + 1.24, w: cw - 0.5, h: 0.64, fontFace: Fb, fontSize: 12.5, color: SUB, margin: 0, lineSpacingMultiple: 1.12 }); }
    foot(s, 4);
  }

  // 5. WHAT'S INCLUDED
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "Deliverables"); title(s, M, 0.96, "What's included in every package.", 12, 30);
    const items = [["Unique AI creator accounts", "A managed roster of distinct AI influencers built around your brand."], ["Daily multi-platform posting", "TikTok, Instagram Reels, YouTube Shorts and X, natively formatted."], ["Unlimited posting, no per-post fee", "We meter production, not distribution. Post as widely as we can."], ["Quality-gated, brand-safe content", "Weak clips never ship. Your tone and rules are enforced on every post."], ["Custom personas for your brand", "Creators shaped to your niche, voice and audience. The anti-slop guarantee."], ["Weekly performance report", "Posts, verified views, top clips and next-week plan, delivered every week."], ["Dedicated account manager", "A single point of contact who runs the campaign and the optimizations."], ["Replacement guarantee", "Underperforming accounts are swapped out. You keep the roster fresh."]];
    const cols = 2, cw = 5.95, chh = 1.02, gx = 0.24, gy = 0.2, x0 = M, y0 = 2.0; const chk = await icon("check", LIME);
    for (let i = 0; i < items.length; i++) { const [h, d] = items[i]; const r = Math.floor(i / cols), c = i % cols; const x = x0 + c * (cw + gx), y = y0 + r * (chh + gy); card(s, x, y, cw, chh, CARD); s.addImage({ data: chk, x: x + 0.26, y: y + 0.24, w: 0.42, h: 0.42 }); s.addText(h, { x: x + 0.85, y: y + 0.16, w: cw - 1.05, h: 0.35, fontFace: Fh, fontSize: 15, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: x + 0.85, y: y + 0.5, w: cw - 1.05, h: 0.45, fontFace: Fb, fontSize: 11.5, color: SUB, margin: 0, lineSpacingMultiple: 1.08 }); }
    foot(s, 5);
  }

  // 6. PACKAGES (with estimates)
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "Packages, monthly"); title(s, M, 0.96, "Choose your reach.", 12, 30);
    const chkL = await icon("check", LIME);
    const pk = (x, name, price, acc, perday, permo, peryr, views, feats, hi, badge) => {
      const w = 5.9, y = 1.9, h = 4.72;
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: hi ? "10140A" : CARD }, line: { color: hi ? LIME : CARDB, width: hi ? 2 : 1 }, shadow: hi ? shLime() : shDark() });
      if (badge) { s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: x + w - 2.0, y: y + 0.34, w: 1.7, h: 0.44, rectRadius: 0.22, fill: { color: LIME } }); s.addText(badge, { x: x + w - 2.0, y: y + 0.34, w: 1.7, h: 0.44, align: "center", valign: "middle", fontFace: Fh, fontSize: 11, bold: true, color: INKB, margin: 0, charSpacing: 1 }); }
      s.addText(name, { x: x + 0.45, y: y + 0.36, w: 3.5, h: 0.4, fontFace: Fh, fontSize: 18, bold: true, color: hi ? LIME : WHITE, margin: 0, charSpacing: 1 });
      s.addText([{ text: "$" + price, options: { fontSize: 42, bold: true, color: WHITE } }, { text: " /mo", options: { fontSize: 16, color: SUB } }], { x: x + 0.45, y: y + 0.82, w: 5, h: 0.85, fontFace: Fh, margin: 0 });
      // stat rows
      const stat = (yy, big, lab) => { s.addText([{ text: big + "  ", options: { bold: true, color: hi ? LIME2 : WHITE, fontSize: 16 } }, { text: lab, options: { color: SUB, fontSize: 12.5 } }], { x: x + 0.45, y: yy, w: 5.1, h: 0.32, fontFace: Fb, margin: 0 }); };
      stat(y + 1.72, acc, "AI creator accounts");
      stat(y + 2.08, "~" + permo, "posts produced / month  (~" + peryr + "/yr)");
      stat(y + 2.44, views, "est. verified views / month");
      s.addShape(p.shapes.LINE, { x: x + 0.45, y: y + 2.86, w: w - 0.9, h: 0, line: { color: hi ? "2B331A" : CARDB, width: 1 } });
      let fy = y + 3.0; for (const ft of feats) { s.addImage({ data: chkL, x: x + 0.45, y: fy + 0.02, w: 0.24, h: 0.24 }); s.addText(ft, { x: x + 0.8, y: fy - 0.04, w: w - 1.2, h: 0.34, fontFace: Fb, fontSize: 12.5, color: "D2D1DC", margin: 0 }); fy += 0.37; }
    };
    pk(M, "LAUNCH", "5,000", "50", 150, "4,500", "54,000", "1M to 3M+", ["Up to 150 posts / day, 4 platforms", "Weekly performance report", "Dedicated account manager", "Replacement guarantee"], false, null);
    pk(M + 6.3, "SCALE", "9,000", "100", 300, "9,000", "108,000", "3M to 6M+", ["Up to 300 posts / day, priority queue", "2x-weekly reporting and strategy", "Senior account manager", "Replacement guarantee"], true, "MOST REACH");
    s.addText("View figures are estimates based on typical swarm output and blended per-post performance. Not guaranteed; actuals vary by niche and creative.", { x: M, y: 6.72, w: 12, h: 0.3, fontFace: Fb, fontSize: 10, italic: true, color: FAINT, margin: 0 });
    s.addText(String(6).padStart(2, "0"), { x: W - M - 0.6, y: H - 0.5, w: 0.6, h: 0.3, align: "right", fontFace: Fb, fontSize: 10, color: FAINT, margin: 0 });
    s.addText("VELLO", { x: M, y: H - 0.42, w: 2, h: 0.3, fontFace: Fh, fontSize: 12, bold: true, color: LIME, charSpacing: 2, margin: 0 });
  }

  // 7. COMPARISON (estimation of views + total posts)
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "At a glance"); title(s, M, 0.96, "Launch vs Scale.", 12, 30);
    const lx = M, lw = 5.0, ax = M + 5.0, aw = 3.55, sx = M + 8.55, sw = 3.55;
    const hy = 1.82, hh = 0.48, ry0 = 2.42, rh = 0.335;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: sx - 0.05, y: hy - 0.05, w: sw + 0.1, h: hh + 0.1 + 12 * rh + 0.08, rectRadius: 0.08, fill: { color: "10140A" }, line: { color: "2B331A", width: 1 } });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: ax + 0.1, y: hy, w: aw - 0.2, h: hh, rectRadius: 0.08, fill: { color: CARD2 }, line: { color: CARDB, width: 1 } });
    s.addText("LAUNCH", { x: ax + 0.1, y: hy, w: aw - 0.2, h: hh, align: "center", valign: "middle", fontFace: Fh, fontSize: 14, bold: true, color: WHITE, margin: 0, charSpacing: 1 });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: sx + 0.1, y: hy, w: sw - 0.2, h: hh, rectRadius: 0.08, fill: { color: LIME } });
    s.addText("SCALE", { x: sx + 0.1, y: hy, w: sw - 0.2, h: hh, align: "center", valign: "middle", fontFace: Fh, fontSize: 14, bold: true, color: INKB, margin: 0, charSpacing: 1 });
    const rows = [
      ["Price / month", "$5,000", "$9,000", "b"], ["AI creator accounts", "50", "100"], ["Posts / day (up to)", "150", "300"],
      ["Posts produced / month", "~4,500", "~9,000", "b"], ["Posts produced / year", "~54,000", "~108,000", "b"],
      ["Est. verified views / month", "1M to 3M+", "3M to 6M+", "lime"], ["Est. cost / 1,000 views", "$1.70 to $3.30", "$1.50 to $3.00"],
      ["Effective cost / post", "~$1.11", "~$1.00"], ["Platforms", "4 platforms", "4 + priority"],
      ["Reporting", "Weekly", "2x weekly + strategy"], ["Account manager", "Dedicated", "Senior + strategy"],
      ["Replacement guarantee", "Included", "Included", "em"],
    ];
    for (let i = 0; i < rows.length; i++) { const [lab, a, b, mode] = rows[i]; const y = ry0 + i * rh; s.addShape(p.shapes.LINE, { x: lx, y: y + rh, w: lw + aw + sw, h: 0, line: { color: "1E1E28", width: 0.75 } }); s.addText(lab, { x: lx + 0.06, y, w: lw - 0.2, h: rh, align: "left", valign: "middle", fontFace: Fb, fontSize: 12.5, bold: mode === "b", color: mode === "b" ? WHITE : "C6C5D2", margin: 0 }); const aCol = mode === "em" ? GREEN : (mode === "b" ? WHITE : "C6C5D2"); const bCol = mode === "em" ? GREEN : (mode === "lime" || mode === "b" ? LIME2 : WHITE); s.addText(a, { x: ax, y, w: aw, h: rh, align: "center", valign: "middle", fontFace: Fb, fontSize: 12.5, bold: mode === "b" || mode === "lime", color: mode === "lime" ? WHITE : aCol, margin: 0 }); s.addText(b, { x: sx, y, w: sw, h: rh, align: "center", valign: "middle", fontFace: Fb, fontSize: 12.5, bold: mode === "b" || mode === "lime", color: bCol, margin: 0 }); }
    s.addText("Estimated views assume typical swarm output and blended per-post performance. Not guaranteed.", { x: M, y: 6.58, w: 11, h: 0.3, fontFace: Fb, fontSize: 9.5, italic: true, color: FAINT, margin: 0 });
    s.addText("VELLO", { x: M, y: H - 0.42, w: 2, h: 0.3, fontFace: Fh, fontSize: 12, bold: true, color: LIME, charSpacing: 2, margin: 0 });
    s.addText(String(7).padStart(2, "0"), { x: W - M - 0.6, y: H - 0.42, w: 0.6, h: 0.3, align: "right", fontFace: Fb, fontSize: 10, color: FAINT, margin: 0 });
  }

  // 8. FIRST 30 DAYS
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "What to expect"); title(s, M, 0.96, "Your first 30 days.", 12, 30);
    const ph = [["brief", "Days 0 to 3", "Onboarding", "Brief, brand guardrails and roster design signed off."], ["rocket", "Days 4 to 7", "Go live", "Accounts warm up and the first posts ship across platforms."], ["bolt", "Weeks 2 to 3", "Full cadence", "Swarm reaches target volume. First optimizations applied."], ["chart", "Week 4", "Review and scale", "Full report delivered. We double down on what is working."]];
    const cw = 2.86, gx = 0.22, y0 = 2.0, ch = 2.5, x0 = M;
    for (let i = 0; i < 4; i++) { const [ic, d1, h, d] = ph[i]; const x = x0 + i * (cw + gx); card(s, x, y0, cw, ch, CARD); await iconChip(s, x + 0.3, y0 + 0.3, 0.72, ic); s.addText(d1, { x: x + 0.3, y: y0 + 1.12, w: cw - 0.6, h: 0.3, fontFace: Fh, fontSize: 12, bold: true, color: LIME, margin: 0, charSpacing: 1 }); s.addText(h, { x: x + 0.3, y: y0 + 1.42, w: cw - 0.6, h: 0.4, fontFace: Fh, fontSize: 17, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: x + 0.3, y: y0 + 1.82, w: cw - 0.55, h: 0.6, fontFace: Fb, fontSize: 12, color: SUB, margin: 0, lineSpacingMultiple: 1.12 }); if (i < 3) s.addImage({ data: await icon("arrow", LIME), x: x + cw + (gx - 0.22) / 2, y: y0 + ch / 2 - 0.12, w: 0.22, h: 0.22 }); }
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 4.85, w: 12.1, h: 1.55, rectRadius: 0.1, fill: { color: "10140A" }, line: { color: "2B331A", width: 1 } });
    s.addText("What to expect", { x: M + 0.4, y: 5.02, w: 4, h: 0.3, fontFace: Fh, fontSize: 13, bold: true, color: LIME, margin: 0, charSpacing: 1 });
    const exp = ["Momentum builds through week 1 as accounts warm up.", "Volume compounds. More posts, more surface area, every week.", "Every clip is judged at 3 to 5 days. Winners get scaled.", "Quality bar stays high. Weak clips never ship."]; const chk2 = await icon("check", LIME);
    for (let i = 0; i < 4; i++) { const col = i % 2, row = Math.floor(i / 2); const x = M + 0.4 + col * 5.6; const y = 5.4 + row * 0.5; s.addImage({ data: chk2, x, y: y + 0.02, w: 0.22, h: 0.22 }); s.addText(exp[i], { x: x + 0.32, y: y - 0.04, w: 5.2, h: 0.35, fontFace: Fb, fontSize: 12.5, color: "D2D1DC", margin: 0 }); }
    foot(s, 8);
  }

  // 9. WEEKLY REPORT
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "Reporting"); title(s, M, 0.96, "What lands in your inbox every week.", 12, 30);
    const items = [["file", "Posts shipped", "Total posts, broken down by account and by platform."], ["eye", "Verified views", "Views tracked over a 7-day window. Real reach, not vanity."], ["film", "Top 10 clips", "Your best-performing videos, with direct links to each."], ["chart", "Engagement and growth", "Likes, comments, shares and follower movement per account."], ["gauge", "Account health", "Posting cadence and status across the whole roster."], ["rocket", "Next-week plan", "Exactly what we are doubling down on, and why."]];
    let y = 2.0; for (const [ic, h, d] of items) { await iconChip(s, M, y, 0.6, ic); s.addText(h, { x: M + 0.78, y: y - 0.03, w: 5.4, h: 0.35, fontFace: Fh, fontSize: 15.5, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: M + 0.78, y: y + 0.33, w: 5.4, h: 0.4, fontFace: Fb, fontSize: 12, color: SUB, margin: 0, lineSpacingMultiple: 1.1 }); y += 0.78; }
    card(s, 7.2, 1.95, 5.5, 4.15, CARD);
    s.addText("Posts shipped by platform", { x: 7.5, y: 2.15, w: 5, h: 0.35, fontFace: Fh, fontSize: 14, bold: true, color: WHITE, margin: 0 });
    s.addText("Illustrative, Launch package, one month", { x: 7.5, y: 2.48, w: 5, h: 0.3, fontFace: Fb, fontSize: 11, italic: true, color: SUB, margin: 0 });
    s.addChart(p.charts.BAR, [{ name: "Posts", labels: ["TikTok", "Reels", "Shorts", "X"], values: [1500, 1250, 1050, 700] }], { x: 7.35, y: 2.85, w: 5.2, h: 3.05, barDir: "col", chartColors: [LIME, LIME, LIME, LIME], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: WHITE, dataLabelFontSize: 10, dataLabelFontBold: true, catAxisLabelColor: "B7B6C4", catAxisLabelFontSize: 11, valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false, showTitle: false, barGapWidthPct: 55, chartArea: { fill: { color: CARD } }, plotArea: { fill: { color: CARD } } });
    foot(s, 9);
  }

  // 10. THE MATH
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "The economics"); title(s, M, 0.96, "The math brands love.", 12, 30);
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 2.05, w: 5.4, h: 4.05, rectRadius: 0.12, fill: { color: "10140A" }, line: { color: LIME, width: 1.5 }, shadow: shLime() });
    s.addText([{ text: "~$1", options: { fontSize: 82, bold: true, color: LIME } }], { x: M + 0.45, y: 2.45, w: 4.6, h: 1.4, fontFace: Fh, margin: 0 });
    s.addText("per fully-produced, posted video", { x: M + 0.5, y: 3.95, w: 4.5, h: 0.4, fontFace: Fb, fontSize: 15, color: "D5D2C6", margin: 0 });
    s.addText([{ text: "4,500+ ", options: { bold: true, color: WHITE, fontSize: 20 } }, { text: "posts a month on Launch", options: { color: "D5D2C6", fontSize: 15 } }], { x: M + 0.5, y: 4.7, w: 4.5, h: 0.5, fontFace: Fb, margin: 0 });
    s.addText("Distribution is unlimited. We meter production, not posting.", { x: M + 0.5, y: 5.35, w: 4.4, h: 0.6, fontFace: Fb, fontSize: 12, italic: true, color: SUB, margin: 0, lineSpacingMultiple: 1.15 });
    const comp = [["Freelance UGC video", "$150 to $500", "each, sourcing and briefing every time"], ["Agency retainer", "$8k to $15k / mo", "for ~15 to 30 posts a month"], ["Vello, Launch", "$5,000 / mo", "for ~4,500 posts a month, fully managed"]];
    let y = 2.15; for (let i = 0; i < 3; i++) { const [a, b, c] = comp[i]; const v = i === 2; s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 6.75, y, w: 5.95, h: 1.16, rectRadius: 0.1, fill: { color: v ? "10140A" : CARD }, line: { color: v ? LIME : CARDB, width: v ? 1.5 : 1 }, shadow: shDark() }); s.addText(a, { x: 7.05, y: y + 0.18, w: 3.4, h: 0.4, fontFace: Fh, fontSize: 15, bold: true, color: v ? LIME : WHITE, margin: 0 }); s.addText(c, { x: 7.05, y: y + 0.58, w: 4.2, h: 0.5, fontFace: Fb, fontSize: 12, color: SUB, margin: 0, lineSpacingMultiple: 1.05 }); s.addText(b, { x: 10.5, y: y + 0.2, w: 1.95, h: 0.7, align: "right", valign: "middle", fontFace: Fh, fontSize: 16, bold: true, color: v ? LIME : WHITE, margin: 0 }); y += 1.32; }
    foot(s, 10);
  }

  // 11. QUALITY (image)
  {
    const s = p.addSlide(); bgDark(s);
    kicker(s, M, 0.6, "Quality and brand safety"); title(s, M, 0.96, "Volume without the slop.", 7.6, 30);
    s.addText("Scale is only worth it if the content is good. Every Vello account is unique by construction and every clip clears a quality bar before it posts, so a swarm reads as many real creators discovering your brand, not one template on repeat.", { x: M, y: 2.05, w: 6.4, h: 1.4, fontFace: Fb, fontSize: 15, color: "CFCEDA", margin: 0, lineSpacingMultiple: 1.22 });
    const cards = [["wand", "Unique by design", "No two accounts or videos are alike. Anti-slop, built in."], ["shield", "Brand guardrails", "Your tone, your rules, your no-go list, enforced on every post."], ["thumb", "Approval on request", "Turn on approvals and sign off before anything ships."], ["repeat", "Replacement guarantee", "Accounts that underperform get swapped out. The roster stays sharp."]];
    let y = 3.7; for (let i = 0; i < 4; i++) { const [ic, h, d] = cards[i]; const col = i % 2, r = Math.floor(i / 2); const x = M + col * 3.15; const yy = y + r * 1.42; await iconChip(s, x, yy, 0.62, ic); s.addText(h, { x: x + 0.78, y: yy - 0.04, w: 2.35, h: 0.6, fontFace: Fh, fontSize: 14.5, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 0.95 }); s.addText(d, { x: x + 0.78, y: yy + 0.48, w: 2.4, h: 0.7, fontFace: Fb, fontSize: 11, color: SUB, margin: 0, lineSpacingMultiple: 1.12 }); }
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 8.72, y: 2.05, w: 4.02, h: 3.9, rectRadius: 0.16, fill: { color: CARD }, line: { color: LIMEDK, width: 1.5 }, shadow: shLime() });
    s.addImage({ path: "clip_round.png", x: 8.85, y: 2.32, w: 3.76, h: 2.87 });
    s.addText("A Vello AI clipper at work.", { x: 8.85, y: 5.28, w: 3.76, h: 0.4, align: "center", fontFace: Fb, fontSize: 12, italic: true, color: SUB, margin: 0 });
    foot(s, 11);
  }

  // 12. CLOSE
  {
    const s = p.addSlide(); bgDark(s);
    s.addImage({ path: "close_bg.png", x: 0, y: 0, w: W, h: H, sizing: { type: "cover", w: W, h: H } });
    logoW(s, M, 0.6, 2.1);
    s.addText("Let's put a swarm\non your brand.", { x: M, y: 2.05, w: 10, h: 1.8, fontFace: Fh, fontSize: 46, bold: true, color: WHITE, margin: 0, lineSpacingMultiple: 0.98 });
    const steps = [["1", "Pick a package", "Launch ($5k) or Scale ($9k)."], ["2", "30-minute kickoff", "Brand, guardrails, platforms."], ["3", "Live within a week", "Your roster starts posting."]];
    for (let i = 0; i < 3; i++) { const [n, h, d] = steps[i]; const x = M + i * 4.05; const y = 4.15; numChip(s, x, y, 0.5, n); s.addText(h, { x: x + 0.66, y: y - 0.06, w: 3.3, h: 0.4, fontFace: Fh, fontSize: 16, bold: true, color: WHITE, margin: 0 }); s.addText(d, { x: x + 0.66, y: y + 0.32, w: 3.3, h: 0.5, fontFace: Fb, fontSize: 12.5, color: "C9C6BC", margin: 0, lineSpacingMultiple: 1.1 }); }
    s.addShape(p.shapes.LINE, { x: M, y: 5.7, w: 12.1, h: 0, line: { color: "2A2A36", width: 1 } });
    s.addText([{ text: "Ready when you are.  ", options: { color: WHITE, bold: true } }, { text: "hello@vello.ai    vello.ai", options: { color: LIME } }], { x: M, y: 6.0, w: 11, h: 0.4, fontFace: Fb, fontSize: 15, margin: 0 });
    s.addText("Vello, the AI creator network.", { x: M, y: H - 0.55, w: 8, h: 0.3, fontFace: Fb, fontSize: 11, color: "8C8898", margin: 0 });
  }

  await p.writeFile({ fileName: "Vello-Client-Packages.pptx" });
  console.log("done");
}
main().catch(e => { console.error(e); process.exit(1); });
