import { writeFile } from "node:fs/promises";
import { renderShareCard } from "@/lib/server/xShareCardRender";
const out = process.argv[2];
(async () => {
  const datas = [
    { mint: "mintA", avatarUrl: null, stats: { name: "Zippy", handle: "zippy_ai", views: 128400, videos: 42, posted: 30, bestViews: 51000, platforms: ["tiktok", "x", "youtube"] } },
    { mint: "mintB", avatarUrl: null, stats: { name: "Chef Remy Bot", handle: null, views: 2345678, videos: 120, posted: 98, bestViews: 900000, platforms: ["instagram", "tiktok"] } },
    { mint: "mintC", avatarUrl: null, stats: { name: "Nova", handle: "nova", views: 0, videos: 2, posted: 0, bestViews: 0, platforms: [] } },
  ];
  for (let i = 0; i < 6; i++) {
    const d = datas[i % 3];
    const res = await renderShareCard(d as never, i);
    await writeFile(`${out}/card-${i}.png`, Buffer.from(await res.arrayBuffer()));
  }
  console.log("ok");
})().catch((e) => { console.error(e); process.exit(1); });
