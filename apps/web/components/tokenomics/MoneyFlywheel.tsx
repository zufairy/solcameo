"use client";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BUYBACK_SPLIT, REVENUE_SPLIT, TIERS, TOKEN_SYMBOL } from "@/lib/tokenomics/platformToken";
import { TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
import { usePlatformToken } from "./usePlatformToken";

const LIME = "#d7ff00", ROSE = "#fb7185", SKY = "#7dd3fc", VIOLET = "#c4b5fd", AMBER = "#fcd34d";
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type PathDef = { id: string; d: string; color: string; dur: number };
const PATHS: PathDef[] = [
  { id: "p-agents", d: "M280,118 C390,118 380,170 436,185", color: LIME, dur: 3.2 },
  { id: "p-trades", d: "M280,263 C390,263 380,215 440,200", color: LIME, dur: 3.6 },
  { id: "p-epoch", d: "M604,190 L700,190", color: LIME, dur: 1.8 },
  { id: "p-ops", d: "M890,170 C940,170 940,82 980,82", color: SKY, dur: 2.2 },
  { id: "p-treasury", d: "M890,190 L980,202", color: VIOLET, dur: 2 },
  { id: "p-buyback", d: "M890,210 C940,210 940,322 980,322", color: LIME, dur: 2.2 },
  { id: "p-buy", d: "M1080,364 C1080,430 1000,472 960,472", color: LIME, dur: 2.4 },
  { id: "p-burn", d: "M700,480 C620,480 540,520 485,545", color: ROSE, dur: 2.6 },
  { id: "p-rewards", d: "M830,514 L830,575", color: AMBER, dur: 1.6 },
  { id: "p-holders", d: "M960,622 L1000,610", color: AMBER, dur: 1.4 },
  { id: "p-loop", d: "M1090,656 C1090,712 -10,712 -10,118 L30,118", color: SKY, dur: 9 },
];

type Step = { n: number; title: string; body: ReactNode; nodes: string[]; paths: string[] };
const STEPS: Step[] = [
  { n: 1, title: "Agents make videos and images", nodes: ["agents"], paths: ["p-agents"], body: <>Every video and image an agent generates is paid from the agent&apos;s own wallet at the provider&apos;s price <b>plus Solcameo&apos;s 15%</b>. That margin is the first source of platform revenue.</> },
  { n: 2, title: "Coins trade on the curve", nodes: ["trades"], paths: ["p-trades"], body: <>Each influencer has a coin on a Meteora bonding curve. Every trade pays a flat <b>{(TRADING_FEE_BPS / 100).toFixed(1)}% fee</b>. A share of it goes to creators and the curve; Solcameo&apos;s share joins the revenue.</> },
  { n: 3, title: "Revenue lands in a public wallet", nodes: ["revenue"], paths: ["p-agents", "p-trades", "p-epoch"], body: <>Margin and fee share arrive as USDC and SOL in one wallet. It is a normal Solana address, so anyone can check the balance on a block explorer.</> },
  { n: 4, title: "Every Monday the week is frozen", nodes: ["epoch"], paths: ["p-epoch"], body: <>The week that just ended is closed into an <b>epoch</b> using only USDC that really settled to the treasury. The figures are published below and nobody can change them afterwards.</> },
  { n: 5, title: "Revenue is split by a fixed policy", nodes: ["epoch", "ops", "treasury", "buyback"], paths: ["p-ops", "p-treasury", "p-buyback"], body: <><b>{REVENUE_SPLIT.opsBps / 100}%</b> runs the platform, <b>{REVENUE_SPLIT.treasuryBps / 100}%</b> goes to the treasury, and <b>{REVENUE_SPLIT.buybackBps / 100}%</b> is used to buy {TOKEN_SYMBOL}. The percentages are written into code, not decided week to week.</> },
  { n: 6, title: `The buyback buys ${TOKEN_SYMBOL}`, nodes: ["buyback", "buy"], paths: ["p-buy"], body: <>The buyback share is swapped for {TOKEN_SYMBOL} on the open market, which creates real buying pressure funded by real usage, not by new emissions.</> },
  { n: 7, title: "Half is burned, half pays holders", nodes: ["buy", "burn", "rewards"], paths: ["p-burn", "p-rewards"], body: <><b>{BUYBACK_SPLIT.burnBps / 100}%</b> of what was bought is burned and gone forever, so supply shrinks. The other <b>{BUYBACK_SPLIT.rewardsBps / 100}%</b> funds holder rewards. Each burn is a transaction you can open.</> },
  { n: 8, title: "Holders earn more and pay less", nodes: ["rewards", "holders"], paths: ["p-holders", "p-loop"], body: <>Your tier is read from your wallet balance: from <b>{TIERS[1].label}</b> to <b>{TIERS[4].label}</b>. Higher tiers get bigger rewards and up to <b>{TIERS[4].discountPct}% off</b> every generation. Nothing to stake or lock.</> },
  { n: 9, title: "Cheaper generations feed the loop", nodes: ["holders", "agents"], paths: ["p-loop"], body: <>Discounts make creating cheaper, so agents make more videos, which brings more revenue, more buybacks and more burns. That is the flywheel.</> },
];

function Particles({ path, reduced, dim }: { path: PathDef; reduced: boolean | null; dim: boolean }) {
  if (reduced) return null; // still diagram: the dashed paths already show the direction
  const count = path.dur > 5 ? 4 : 3;
  return (
    <g opacity={dim ? 0.3 : 1} style={{ transition: "opacity 0.4s ease" }}>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} r={path.dur > 5 ? 3.2 : 3.6} fill={path.color} style={{ filter: `drop-shadow(0 0 5px ${path.color})` }} >
          {<animateMotion dur={`${path.dur}s`} begin={`${(i * path.dur) / count}s`} repeatCount="indefinite" rotate="auto"><mpath href={`#${path.id}`} /></animateMotion>}
        </circle>
      ))}
    </g>
  );
}

function Box({ x, y, w, h, title, sub, live, color, active, dim, onPick, children }: { x: number; y: number; w: number; h: number; title: string; sub: string; live?: string; color: string; active: boolean; dim: boolean; onPick: () => void; children?: ReactNode }) {
  return (
    <g role="button" tabIndex={0} aria-label={`${title}. ${sub}`} onClick={onPick} onFocus={onPick} onMouseEnter={onPick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }} style={{ cursor: "pointer", outline: "none", opacity: dim ? 0.62 : 1, transition: "opacity 0.4s ease" }}>
      <rect x={x} y={y} width={w} height={h} rx={16} fill="#0d0f12" stroke={active ? color : "rgba(255,255,255,0.12)"} strokeWidth={active ? 1.6 : 1} />
      {active && <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={20} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1}><animate attributeName="stroke-opacity" values="0.15;0.5;0.15" dur="2.2s" repeatCount="indefinite" /></rect>}
      <rect x={x + 14} y={y + 16} width={5} height={h - 32} rx={2.5} fill={color} opacity={0.9} />
      <text x={x + 30} y={y + 34} fill="#f4f4f1" fontSize={17} fontWeight={600}>{title}</text>
      <text x={x + 30} y={y + 56} fill="rgba(255,255,255,0.62)" fontSize={13.5}>{sub}</text>
      {live && <text x={x + 30} y={y + h - 14} fill={color} fontSize={14.5} fontWeight={700} style={{ fontVariantNumeric: "tabular-nums" }}>{live}</text>}
      {children}
    </g>
  );
}

/** The whole money loop as one animated diagram: where revenue comes from, what the weekly policy does with it, and how burns and rewards feed back into cheaper generations. Click or hover any block to read what it does. */
export function MoneyFlywheel() {
  const reduced = useReducedMotion();
  const { data } = usePlatformToken();
  const [step, setStep] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold || reduced) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 5200);
    return () => clearInterval(t);
  }, [hold, reduced]);
  const cur = STEPS[step];
  const on = (id: string) => cur.nodes.includes(id);
  const dimNode = (id: string) => !on(id);
  const pick = (id: string) => { const i = STEPS.findIndex((s) => s.nodes[0] === id); if (i >= 0) { setHold(true); setStep(i); } };
  const revenue = data?.revenue.usdc;
  const burned = data?.burned ?? 0;
  const epochs = data?.epochs?.length ?? 0;

  return (
    <section aria-labelledby="flywheel" className="mt-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">The whole system</p>
        <h2 id="flywheel" className="mt-2 text-[26px] font-semibold tracking-[-0.025em] text-white sm:text-[34px]">Usage pays. The token gets bought and burned.</h2>
        <p className="mt-3 text-[14.5px] leading-7 text-white/55">Follow the glowing dots. Money enters on the left from real usage, is split by a fixed weekly policy in the middle, and the buyback side ends in a burn and in rewards for holders. Hover or tap any block to read what it does.</p>
      </div>

      <div className="mt-6 grid gap-4" onMouseLeave={() => setHold(false)}>
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0b0e] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div aria-hidden className="pointer-events-none absolute left-1/3 top-0 size-[420px] -translate-x-1/2 rounded-full bg-lime-300/[0.06] blur-[110px]" />
          <div aria-hidden className="pointer-events-none absolute bottom-0 right-1/4 size-[360px] rounded-full bg-rose-500/[0.07] blur-[110px]" />
          <div className="relative overflow-x-auto">
            <svg viewBox="-30 0 1260 730" className="mx-auto block h-auto w-full min-w-[760px]" role="img" aria-label="Diagram of the Solcameo revenue loop from usage to burn and holder rewards">
              <defs>
                <pattern id="fw-grid" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.9" fill="rgba(255,255,255,0.07)" /></pattern>
                <linearGradient id="fw-hub" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={LIME} stopOpacity="0.28" /><stop offset="1" stopColor={LIME} stopOpacity="0.04" /></linearGradient>
              </defs>
              <rect x="-30" y="0" width="1260" height="730" fill="url(#fw-grid)" />
              {PATHS.map((p) => (
                <g key={p.id}>
                  <path id={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={1.6} strokeDasharray="3 7" strokeLinecap="round" opacity={cur.paths.includes(p.id) ? 0.75 : 0.26} style={{ transition: "opacity 0.4s ease" }}>
                    {reduced ? null : <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.4s" repeatCount="indefinite" />}
                  </path>
                </g>
              ))}
              {PATHS.map((p) => <Particles key={p.id} path={p} reduced={reduced} dim={!cur.paths.includes(p.id)} />)}

              <Box x={30} y={70} w={250} h={96} title="Agents create" sub="videos and images, paid +15%" color={LIME} active={on("agents")} dim={dimNode("agents")} onPick={() => pick("agents")} />
              <Box x={30} y={215} w={250} h={96} title="Coins trade" sub={`${(TRADING_FEE_BPS / 100).toFixed(1)}% fee on every trade`} color={LIME} active={on("trades")} dim={dimNode("trades")} onPick={() => pick("trades")} />

              <g role="button" tabIndex={0} aria-label="Revenue wallet" onClick={() => pick("revenue")} onFocus={() => pick("revenue")} onMouseEnter={() => pick("revenue")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick("revenue"); } }} style={{ cursor: "pointer", outline: "none", opacity: dimNode("revenue") ? 0.62 : 1, transition: "opacity 0.4s ease" }}>
                <circle cx={520} cy={190} r={84} fill="url(#fw-hub)" stroke={on("revenue") ? LIME : "rgba(255,255,255,0.14)"} strokeWidth={on("revenue") ? 1.8 : 1} />
                <circle cx={520} cy={190} r={100} fill="none" stroke={LIME} strokeOpacity={0.18} strokeDasharray="2 8">{reduced ? null : <animateTransform attributeName="transform" type="rotate" from="0 520 190" to="360 520 190" dur="30s" repeatCount="indefinite" />}</circle>
                <text x={520} y={166} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={11} letterSpacing={1.6}>REVENUE WALLET</text>
                <text x={520} y={202} textAnchor="middle" fill="#f4f4f1" fontSize={26} fontWeight={700} style={{ fontVariantNumeric: "tabular-nums" }}>{revenue != null ? money(revenue) : "n/a"}</text>
                <text x={520} y={226} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize={11.5}>USDC held, live</text>
              </g>

              <Box x={700} y={140} w={190} h={100} title="Weekly epoch" sub="Mondays, frozen, public" live={`${epochs} published`} color={LIME} active={on("epoch")} dim={dimNode("epoch")} onPick={() => pick("epoch")} />
              <Box x={980} y={40} w={200} h={84} title={`Ops ${REVENUE_SPLIT.opsBps / 100}%`} sub="runs the platform" color={SKY} active={on("ops")} dim={dimNode("ops")} onPick={() => pick("ops")} />
              <Box x={980} y={160} w={200} h={84} title={`Treasury ${REVENUE_SPLIT.treasuryBps / 100}%`} sub="grants and partners" color={VIOLET} active={on("treasury")} dim={dimNode("treasury")} onPick={() => pick("treasury")} />
              <Box x={980} y={280} w={200} h={84} title={`Buyback ${REVENUE_SPLIT.buybackBps / 100}%`} sub={`buys ${TOKEN_SYMBOL}`} color={LIME} active={on("buyback")} dim={dimNode("buyback")} onPick={() => pick("buyback")} />

              <Box x={700} y={430} w={260} h={84} title="Buy on the market" sub={`swap revenue for ${TOKEN_SYMBOL}`} color={LIME} active={on("buy")} dim={dimNode("buy")} onPick={() => pick("buy")} />
              <Box x={360} y={545} w={250} h={100} title={`Burn ${BUYBACK_SPLIT.burnBps / 100}%`} sub="gone forever" live={`${compact(burned)} burned`} color={ROSE} active={on("burn")} dim={dimNode("burn")} onPick={() => pick("burn")}>
                {Array.from({ length: 5 }, (_, i) => (
                  <circle key={i} cx={470 + i * 14} cy={548} r={2.2} fill={i % 2 ? AMBER : ROSE} opacity={on("burn") || !reduced ? 0.9 : 0}>
                    {reduced ? null : <><animate attributeName="cy" values="548;515;500" dur={`${2 + i * 0.35}s`} begin={`${i * 0.4}s`} repeatCount="indefinite" /><animate attributeName="opacity" values="0.9;0.5;0" dur={`${2 + i * 0.35}s`} begin={`${i * 0.4}s`} repeatCount="indefinite" /></>}
                  </circle>
                ))}
              </Box>
              <Box x={700} y={575} w={260} h={96} title={`Rewards ${BUYBACK_SPLIT.rewardsBps / 100}%`} sub="paid to tier holders" color={AMBER} active={on("rewards")} dim={dimNode("rewards")} onPick={() => pick("rewards")} />
              <Box x={1000} y={560} w={190} h={96} title="Holders" sub="Bronze to Diamond" live={data?.holders?.length ? `${data.holders.length} top wallets` : "tiers by balance"} color={AMBER} active={on("holders")} dim={dimNode("holders")} onPick={() => pick("holders")} />
              <text x={420} y={706} fill="rgba(125,211,252,0.85)" fontSize={12} letterSpacing={0.4}>Holder discounts make every generation cheaper, which brings more usage back to the start</text>
            </svg>
          </div>
        </div>

        <div className="grid gap-5 rounded-3xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-6 md:grid-cols-[minmax(0,1fr)_300px] md:items-center md:gap-10">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={cur.n} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="min-h-[96px]">
              <h3 className="text-[21px] font-semibold leading-tight tracking-[-0.02em] text-white">{cur.title}</h3>
              <p className="mt-2 max-w-2xl text-[14px] leading-6 text-white/60 [&_b]:font-semibold [&_b]:text-white">{cur.body}</p>
            </motion.div>
          </AnimatePresence>
          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-white/40">Step {cur.n} of {STEPS.length}</span>
              <span className="flex gap-1.5">
                <button type="button" aria-label="Previous step" onClick={() => { setHold(true); setStep((s) => (s + STEPS.length - 1) % STEPS.length); }} className="grid size-8 place-items-center rounded-full border border-white/10 text-white/60 transition-colors hover:border-white/30 hover:text-white"><ChevronLeft className="size-4" /></button>
                <button type="button" aria-label="Next step" onClick={() => { setHold(true); setStep((s) => (s + 1) % STEPS.length); }} className="grid size-8 place-items-center rounded-full border border-white/10 text-white/60 transition-colors hover:border-white/30 hover:text-white"><ChevronRight className="size-4" /></button>
              </span>
            </div>
            <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Steps">
              {STEPS.map((st, i) => (
                <button key={st.n} type="button" role="tab" aria-selected={i === step} aria-label={`Step ${st.n}: ${st.title}`} onClick={() => { setHold(true); setStep(i); }} className="relative h-6 flex-1">
                  <span className={`absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full ${i === step ? "bg-[#d7ff00]" : i < step ? "bg-white/35" : "bg-white/12"} transition-colors duration-300`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
