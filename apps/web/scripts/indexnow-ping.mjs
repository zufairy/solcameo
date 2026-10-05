#!/usr/bin/env node
// Push every sitemap URL to IndexNow (Bing, Yandex, Seznam, Naver — Bing's
// index also feeds DuckDuckGo, Yahoo and ChatGPT search) so new/changed pages
// get crawled in hours instead of weeks. Google does not use IndexNow; for
// Google, submit the sitemap in Search Console.
//
// The key file must already be LIVE at https://velloagents.com/<KEY>.txt
// (public/<KEY>.txt) — deploy first, then run:
//   node scripts/indexnow-ping.mjs
const HOST = "velloagents.com";
const KEY = "c12e77890fd67ca102d54cb0615100b7";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

const keyRes = await fetch(KEY_LOCATION);
if (!keyRes.ok || (await keyRes.text()).trim() !== KEY) {
  console.error(`Key file not live at ${KEY_LOCATION} — deploy public/${KEY}.txt first.`);
  process.exit(1);
}

const xml = await (await fetch(`https://${HOST}/sitemap.xml`)).text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (urlList.length === 0) {
  console.error("No URLs found in sitemap.xml");
  process.exit(1);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
});
// 200 = accepted, 202 = accepted (key validation pending).
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`);
if (res.status >= 300) console.log(await res.text());
