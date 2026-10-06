"use client";
import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  Loader2,
  Coins,
  Video,
  Settings2,
  ShieldCheck,
  Activity,
  HeartPulse,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ANTI_SNIPER_LEVELS, type DbcOptions } from "@/lib/meteora/options";
import type { previewDbc } from "@/lib/meteora/curve";
import { feeExample } from "@/lib/meteora/flywheel";
import { FEE_SPLIT_PERCENT, TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
type Preview = ReturnType<typeof previewDbc>;
const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 3 });
export function DbcEconomics({
  value,
  onChange,
  readOnly = false,
  creatorImage,
  coinImage,
}: {
  value: DbcOptions;
  onChange: (v: DbcOptions) => void;
  readOnly?: boolean;
  /** The creator's profile picture, shown for the creator share. */
  creatorImage?: string;
  /** The coin's picture (the character portrait), shown for the content budget. */
  coinImage?: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [buy, setBuy] = useState(0.1);
  const id = useId().replaceAll(":", ""),
    reduced = useReducedMotion(),
    sustainable = value.economy === "sustainable-v1";
  const patch = (p: Partial<DbcOptions>) => onChange({ ...value, ...p });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreview(null);
      setError("");
      try {
        const res = await fetch("/api/meteora/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPreview(data);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Preview unavailable");
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);
  const points =
    preview?.points
      .map(
        (p) =>
          `${40 + (p.inputSol / preview.points.at(-1)!.inputSol) * 660},${260 - ((p.capSol - value.initialCapSol) / (value.graduationCapSol - value.initialCapSol)) * 210}`,
      )
      .join(" ") ?? "";
  const fees = feeExample(100, TRADING_FEE_BPS, sustainable);
  const example = preview?.examples.find((q) => q.inputSol === buy);
  return (
    <section className="space-y-6">
      <div>
        <Badge variant="outline" className="border-[#d7ff00]/25 text-[#d7ff00]">
          {sustainable ? "Sustainable launch" : "Original creator-only launch"}
        </Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          Give your character a future.
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Choose a launch target. The curve discovers your token’s price, then
          its SOL reserve seeds a permanently locked Meteora pool.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {[175, 250, 350].map((cap, i) => (
          <Button
            key={cap}
            variant="outline"
            disabled={readOnly}
            aria-pressed={value.graduationCapSol === cap}
            onClick={() => patch({ graduationCapSol: cap })}
            className={`relative h-auto items-start justify-start rounded-xl border-white/10 bg-[#202326] p-4 text-left ${value.graduationCapSol === cap ? "border-[#d7ff00] ring-1 ring-[#d7ff00]/20" : ""}`}
          >
            <span className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {["Quick start", "Balanced", "More liquidity"][i]}
              </span>
              <span className="text-2xl font-semibold">
                {cap}{" "}
                <span className="text-xs font-normal text-zinc-500">
                  SOL valuation
                </span>
              </span>
              <span className="text-xs font-normal text-zinc-500">
                {
                  [
                    "Lower reserve target",
                    "Recommended for a first launch",
                    "Higher reserve target",
                  ][i]
                }
              </span>
            </span>
            {value.graduationCapSol === cap && (
              <Check className="absolute right-3 top-3 size-4 text-[#d7ff00]" />
            )}
          </Button>
        ))}
      </div>
      <Card className="overflow-hidden border-white/10 bg-[#202326] shadow-none">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-500">
                SOL reserve needed to graduate
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {preview ? fmt(preview.raisedSol) : "…"}{" "}
                <span className="text-sm font-normal text-zinc-400">SOL</span>
              </p>
            </div>
            <Badge variant="outline" className="border-white/10 text-zinc-400">
              Simulation · buys only
            </Badge>
          </div>
          {preview ? (
            <svg
              viewBox="0 0 740 310"
              className="mt-4 w-full"
              role="img"
              aria-label={`Simulated buy-only curve from ${value.initialCapSol} to ${value.graduationCapSol} SOL valuation`}
            >
              <defs>
                <linearGradient id={`fill-${id}`} x2="0" y2="1">
                  <stop stopColor="#d7ff00" stopOpacity=".2" />
                  <stop offset="1" stopColor="#d7ff00" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 0.5, 1].map((n) => (
                <g key={n}>
                  <line
                    x1="40"
                    x2="700"
                    y1={260 - n * 210}
                    y2={260 - n * 210}
                    stroke="#ffffff12"
                    strokeDasharray="3 5"
                  />
                  <text x="40" y={250 - n * 210} fill="#85898d" fontSize="11">
                    {fmt(
                      value.initialCapSol +
                        n * (value.graduationCapSol - value.initialCapSol),
                    )}{" "}
                    SOL valuation
                  </text>
                </g>
              ))}
              <polygon
                points={`40,280 ${points} 700,280`}
                fill={`url(#fill-${id})`}
              />
              <motion.polyline
                key={points}
                points={points}
                fill="none"
                stroke="#d7ff00"
                strokeWidth="3"
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5 }}
              />
              <circle cx="700" cy="50" r="6" fill="#d7ff00" />
              <text
                x="695"
                y="300"
                textAnchor="end"
                fill="#85898d"
                fontSize="11"
              >
                Gross simulated buys (SOL) →
              </text>
            </svg>
          ) : (
            <div className="grid aspect-[740/310] place-items-center text-sm text-zinc-400">
              {error ? (
                <p role="alert">{error}</p>
              ) : (
                <Loader2 className="size-5 animate-spin" />
              )}
            </div>
          )}
          <p className="text-xs leading-5 text-zinc-500">
            Valuation is price × total supply. The reserve is actual SOL in the
            pool, excluding trading fees. Sells reduce reserve progress. This
            chart describes pricing, not future demand or returns.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
            <span className="mr-2 text-xs text-zinc-400">
              Try an opening buy
            </span>
            {[0.1, 1, 5].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={buy === n ? "secondary" : "ghost"}
                onClick={() => setBuy(n)}
              >
                {n} SOL
              </Button>
            ))}
            <span className="ml-auto text-xs tabular-nums text-zinc-300">
              {example
                ? `${fmt(example.tokens)} tokens · ${fmt((example.tokens / 1e9) * 100)}% of supply`
                : "Calculating…"}
            </span>
          </div>
        </CardContent>
      </Card>
      <div>
        <h3 className="text-base font-medium">
          Where the {TRADING_FEE_BPS / 100}% trading fee goes
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Example: a 100 SOL buy pays {fmt(fees.total)} SOL in trading fees.
          Network fees and rent are additional.
        </p>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full">
          {(sustainable ? [FEE_SPLIT_PERCENT.creator, FEE_SPLIT_PERCENT.content, FEE_SPLIT_PERCENT.platform, FEE_SPLIT_PERCENT.meteora] : [80, 20]).map((p, i) => (
            <motion.div
              key={i}
              initial={{ width: 0 }}
              animate={{ width: `${p}%` }}
              transition={{ duration: reduced ? 0 : 0.45, delay: i * 0.08 }}
              className={
                [
                  "bg-[#d7ff00]",
                  "bg-emerald-400",
                  "bg-zinc-400",
                  "bg-zinc-600",
                ][i]
              }
            />
          ))}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { label: "Creator", pct: sustainable ? FEE_SPLIT_PERCENT.creator : 80, amount: fees.creator, kind: "creator" },
            { label: "Content budget", pct: sustainable ? FEE_SPLIT_PERCENT.content : 0, amount: fees.content, kind: "content" },
            { label: "Solcameo", pct: sustainable ? FEE_SPLIT_PERCENT.platform : 0, amount: fees.platform, kind: "solcameo" },
            { label: "Meteora", pct: FEE_SPLIT_PERCENT.meteora, amount: fees.protocol, kind: "meteora" },
          ] as const).map(({ label, pct, amount, kind }, i) => (
            <motion.div key={label} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <dt className="flex items-center gap-2 text-xs text-zinc-400">
                <FeeLogo kind={kind} creatorImage={creatorImage} coinImage={coinImage} />
                <span className="min-w-0 truncate">{label}<span className="ml-1 text-zinc-600">{pct}%</span></span>
              </dt>
              <dd className="mt-2.5 text-lg font-medium tabular-nums">
                {fmt(Number(amount))}{" "}
                <span className="text-xs font-normal text-zinc-500">SOL</span>
              </dd>
            </motion.div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="text-base font-medium">Launch switches</h3>
        <p className="mt-1 text-xs text-zinc-500">Turn Meteora protections and automation on or off. On-chain switches are written into the pool at launch and cannot be changed afterwards.</p>
        <div className="mt-3 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <SwitchRow
            icon={<ShieldCheck className="size-4" />} title="Anti-sniper fee" chain
            description={value.antiSniper ? `Trading fee starts at ${ANTI_SNIPER_LEVELS[value.antiSniperLevel].startingFeeBps / 100}% and decays to ${TRADING_FEE_BPS / 100}% over ${ANTI_SNIPER_LEVELS[value.antiSniperLevel].totalDuration / 60} min, so bots that buy in the first seconds pay for it. Your first swap is charged the minimum fee.` : "Flat trading fee from the first second. Bots pay the same as everyone else."}
            checked={value.antiSniper} disabled={readOnly} onChange={(antiSniper) => patch({ antiSniper })}
          >
            <Segmented label="Strength" disabled={readOnly} value={value.antiSniperLevel} onChange={(antiSniperLevel) => patch({ antiSniperLevel })} options={[["light", "Light · 1 min"], ["standard", "Standard · 3 min"], ["strict", "Strict · 5 min"]]} />
          </SwitchRow>
          <SwitchRow
            icon={<Activity className="size-4" />} title="Dynamic volatility fee" chain
            description="Adds a small extra fee when the price is moving fast, on the bonding curve and again after graduation. Calm markets keep the normal fee."
            checked={value.dynamicFee} disabled={readOnly} onChange={(dynamicFee) => patch({ dynamicFee })}
          />
          <SwitchRow
            icon={<HeartPulse className="size-4" />} title="Autopilot content"
            description="After launch, the agent’s heartbeat switches on: it plans viral ideas, makes videos and posts them by itself, spending only from its own wallet. You can pause it any time from the agent page."
            checked={value.autopilot} disabled={readOnly} onChange={(autopilot) => patch({ autopilot })}
          >
            <Segmented label="Runs" disabled={readOnly} value={value.autopilotCadence} onChange={(autopilotCadence) => patch({ autopilotCadence })} options={[["every_4h", "Every 4h"], ["every_12h", "Every 12h"], ["daily", "Daily"]]} />
          </SwitchRow>
        </div>
      </div>
      <details className="rounded-xl border border-white/10 p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
          <Settings2 className="size-4" />
          Advanced launch settings
        </summary>
        <div className="mt-5 space-y-5">
          <div>
            <Label>Curve behavior</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["classic", "Classic · simple pricing"],
                  ["steady", "Increasing liquidity"],
                  ["rocket", "Decreasing liquidity"],
                  ["whale", "Stronger late liquidity"],
                ] as const
              ).map(([shape, label]) => (
                <Button
                  key={shape}
                  disabled={readOnly}
                  variant="outline"
                  aria-pressed={value.shape === shape}
                  onClick={() => patch({ shape })}
                  className={
                    value.shape === shape
                      ? "border-[#d7ff00] text-[#d7ff00]"
                      : "border-white/10"
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                ["initialCapSol", "Opening valuation"],
                ["graduationCapSol", "Graduation valuation"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label htmlFor={`${key}-${id}`}>{label} (SOL)</Label>
                <Input
                  id={`${key}-${id}`}
                  className="mt-2"
                  type="number"
                  readOnly={readOnly}
                  value={value[key]}
                  onChange={(e) => patch({ [key]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <div>
            <Label>Trading fee · DBC and graduated pool</Label>
            <p className="mt-2 inline-flex h-9 items-center rounded-md border border-[#d7ff00] px-3 text-sm tabular-nums text-[#d7ff00]">{TRADING_FEE_BPS / 100}% flat on every trade</p>
            <p className="mt-1.5 text-[11px] text-zinc-500">Same for every coin. Creator {FEE_SPLIT_PERCENT.creator}%, Solcameo {FEE_SPLIT_PERCENT.platform}%, content {FEE_SPLIT_PERCENT.content}%, Meteora {FEE_SPLIT_PERCENT.meteora}%.</p>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-500">
        <span>1 billion tokens</span>
        <span>100% permanently locked LP</span>
        <span>No initial buy</span>
        <span>No additional platform launch fee</span>
      </div>
      <p className="text-[11px] leading-5 text-zinc-500">
        Graduation needs a confirmed migration transaction. Meteora’s separate
        protocol liquidity migration fee applies. The creator retains 1,000
        leftover tokens as a rounding buffer; LP fee rights follow the onchain
        distribution. Paid content uses configured service pricing and prepaid
        provider credits.
      </p>
    </section>
  );
}

/* eslint-disable @next/next/no-img-element -- small brand and profile images */
/** Logo or profile picture for each slice of the trading fee. Falls back to an icon when no picture is known. */
function FeeLogo({ kind, creatorImage, coinImage }: { kind: "creator" | "content" | "solcameo" | "meteora"; creatorImage?: string; coinImage?: string }) {
  if (kind === "creator") return creatorImage
    ? <img src={creatorImage} alt="" className="size-7 rounded-full object-cover ring-1 ring-white/20" />
    : <span className="grid size-7 place-items-center rounded-full bg-[#d7ff00]/15 text-[#d7ff00]"><Coins className="size-3.5" /></span>;
  if (kind === "content") return coinImage
    ? <img src={coinImage} alt="" className="size-7 rounded-[6px] object-cover ring-1 ring-white/20" />
    : <span className="grid size-7 place-items-center rounded-[6px] bg-white/10 text-white/70"><Video className="size-3.5" /></span>;
  if (kind === "solcameo") return <img src="/brand/solcameo-mark.png" alt="" className="size-7 rounded-[6px] bg-white/5 object-contain p-0.5 ring-1 ring-white/15" />;
  return <img src="/logos/meteora.svg" alt="" className="size-7 rounded-[6px] bg-white/5 object-contain p-1 ring-1 ring-white/15" />;
}

function SwitchRow({ icon, title, description, checked, onChange, disabled, chain, children }: { icon: React.ReactNode; title: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; chain?: boolean; children?: React.ReactNode }) {
  const id = useId().replaceAll(":", "");
  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] border transition-colors ${checked ? "border-[#d7ff00]/40 bg-[#d7ff00]/10 text-[#d7ff00]" : "border-white/10 bg-white/[0.04] text-zinc-500"}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-sm font-medium">{title}</label>
            <span className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${chain ? "border-sky-400/30 text-sky-300" : "border-white/15 text-zinc-400"}`}>{chain ? "On-chain" : "Off-chain"}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
          {checked && children ? <div className="mt-3">{children}</div> : null}
        </div>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, onChange, options, disabled }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][]; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/30 p-0.5">
      {options.map(([id, text]) => (
        <button key={id} type="button" disabled={disabled} aria-pressed={value === id} onClick={() => onChange(id)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${value === id ? "bg-[#d7ff00] text-black" : "text-zinc-400 hover:text-white"}`}>{text}</button>
      ))}
    </div>
  );
}
