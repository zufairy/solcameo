import { chromium } from "@playwright/test";
const out = "C:/Users/ongee/.claude/jobs/63a180f7/tmp/pw-proof.png";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
let url = "https://velloagents.com";
try { await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
catch (e) { console.log("velloagents.com load issue: " + String(e.message).slice(0,80) + " — fallback example.com"); url = "https://example.com"; await p.goto(url, { timeout: 15000 }); }
await p.waitForTimeout(2500);
await p.screenshot({ path: out, fullPage: false });
console.log("TITLE: " + (await p.title()));
console.log("FINAL URL: " + p.url());
console.log("SAVED: " + out);
await b.close();
