/**
 * Live smoke + light load test. Usage:
 *   BASE=https://solcameo.com INTERNAL_CRON_SECRET=... node scripts/smoke-live.mjs [concurrency=10] [rounds=5]
 * Hits the public read endpoints the Market, Make, Tokenomics and Leaderboard pages depend on, checks they return
 * real mainnet data (no paper/devnet rows), and reports status and latency percentiles. Exit code 1 on any failure.
 */
const BASE = (process.env.BASE ?? "https://solcameo.com").replace(/\/$/, "");
const CONC = Number(process.argv[2] ?? 10), ROUNDS = Number(process.argv[3] ?? 5);
const secret = process.env.INTERNAL_CRON_SECRET;
const targets = [
  { path: "/api/tokenomics/live", check: (j) => j.ok === true && (j.network === "mainnet-beta" || j.network === "mainnet") && Array.isArray(j.coins) },
  { path: "/api/solstar/leaderboard?period=all", check: (j) => j.network === "mainnet" },
  { path: "/api/meteora/readiness", check: (j) => j.ready === true && j.network === "mainnet" },
  { path: "/api/explore?cursor=1", check: (j) => Array.isArray(j.items) && j.items.length > 0 },
  { path: "/market", html: true }, { path: "/make", html: true }, { path: "/explore", html: true }, { path: "/agents", html: true }, { path: "/tokenomics", html: true },
  ...(secret ? [{ path: "/api/health/mainnet", headers: { authorization: `Bearer ${secret}` }, check: (j) => j.ready === true }] : []),
];
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
let failed = false;
for (const t of targets) {
  const times = []; let bad = 0, note = "";
  for (let r = 0; r < ROUNDS; r++) {
    await Promise.all(Array.from({ length: CONC }, async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(BASE + t.path, { headers: t.headers, signal: AbortSignal.timeout(20000) });
        times.push(performance.now() - t0);
        if (!res.ok) { bad++; note = `HTTP ${res.status}`; return; }
        if (t.html) return;
        const j = await res.json();
        if (t.check && !t.check(j)) { bad++; note = "unexpected payload: " + JSON.stringify(j).slice(0, 160); }
      } catch (e) { bad++; note = String(e.message ?? e); }
    }));
  }
  if (bad) failed = true;
  console.log(`${bad ? "FAIL" : "ok  "} ${t.path.padEnd(40)} n=${times.length} p50=${pct(times, .5).toFixed(0)}ms p95=${pct(times, .95).toFixed(0)}ms${bad ? `  failures=${bad} ${note}` : ""}`);
}
process.exit(failed ? 1 : 0);
