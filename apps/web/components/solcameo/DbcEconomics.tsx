"use client";
import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, TrendingUp, Rocket, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DbcOptions } from "@/lib/meteora/options";
import type { previewDbc } from "@/lib/meteora/curve";
type Preview = ReturnType<typeof previewDbc>;
const shapes = [
  { key: "classic", name: "Classic", Icon: Activity },
  { key: "steady", name: "Steady", Icon: TrendingUp },
  { key: "rocket", name: "Rocket", Icon: Rocket },
  { key: "whale", name: "Whale wall", Icon: Layers },
] as const;
const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });
export function DbcEconomics({
  value,
  onChange,
  readOnly = false,
}: {
  value: DbcOptions;
  onChange: (v: DbcOptions) => void;
  readOnly?: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const reduced = useReducedMotion(),
    id = useId().replaceAll(":", "");
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
          setError(
            e instanceof Error ? e.message : "Curve preview unavailable.",
          );
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);
  const patch = (fields: Partial<DbcOptions>) =>
    onChange({ ...value, ...fields });
  const points =
    preview?.points
      .map(
        (p) =>
          `${40 + (p.inputSol / preview.points.at(-1)!.inputSol) * 660},${260 - ((p.capSol - value.initialCapSol) / (value.graduationCapSol - value.initialCapSol)) * 210}`,
      )
      .join(" ") ?? "";
  return (
    <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          The curve<span className="text-[#d7ff00]">.</span>
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Your coin trades on Meteora DBC, then graduates to DAMM v2 when its
          SOL reserve reaches the target. Set the opening cap, curve shape, and
          trading fee.
        </p>
      </div>
      <Label>Graduation market cap & curve shape</Label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shapes.map(({ key, name, Icon }) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            disabled={readOnly}
            aria-pressed={value.shape === key}
            onClick={() => patch({ shape: key })}
            className={`h-12 rounded-xl ${value.shape === key ? "border-[#f5f4ef] bg-white/5 text-white ring-1 ring-white/50" : "border-white/10 bg-white/[0.035] text-zinc-400"}`}
          >
            <Icon className="size-4 text-[#d7ff00]" />
            {name}
          </Button>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-3">
        {preview ? (
          <svg
            viewBox="0 0 740 310"
            className="w-full"
            role="img"
            aria-label={`SDK bonding curve: opens at ${value.initialCapSol} SOL cap, graduates at ${value.graduationCapSol} SOL cap`}
          >
            <defs>
              <linearGradient id={`line-${id}`}>
                <stop stopColor="#e4ff59" />
                <stop offset="1" stopColor="#d7ff00" />
              </linearGradient>
              <linearGradient id={`fill-${id}`} x2="0" y2="1">
                <stop stopColor="#d7ff00" stopOpacity=".25" />
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
                  SOL
                </text>
              </g>
            ))}
            <polygon
              points={`40,280 ${points} 700,280`}
              fill={`url(#fill-${id})`}
            />
            <motion.polyline
              points={points}
              fill="none"
              stroke={`url(#line-${id})`}
              strokeWidth="3"
              initial={{ pathLength: reduced ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.45 }}
            />
            <circle
              cx="700"
              cy="50"
              r="7"
              fill="#d7ff00"
              stroke="#202326"
              strokeWidth="3"
            />
            <text x="695" y="25" textAnchor="end" fill="#f5f4ef" fontSize="12">
              {fmt(value.graduationCapSol)} SOL cap · {fmt(preview.raisedSol)}{" "}
              SOL reserve
            </text>
            <text x="695" y="300" textAnchor="end" fill="#85898d" fontSize="11">
              Cumulative buys (SOL) →
            </text>
          </svg>
        ) : (
          <div className="grid aspect-[740/310] place-items-center text-sm text-zinc-500">
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <Loader2 className="size-5 animate-spin" />
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[175, 250, 350].map((cap, i) => (
          <Button
            key={cap}
            type="button"
            variant="outline"
            disabled={readOnly}
            onClick={() => patch({ graduationCapSol: cap })}
            aria-pressed={value.graduationCapSol === cap}
            className={`h-auto flex-col items-start rounded-xl p-3 ${value.graduationCapSol === cap ? "border-white/80 bg-white/5 ring-1 ring-white/50" : "border-white/10 bg-white/[0.035]"}`}
          >
            <span className="text-lg font-semibold">{cap} SOL</span>
            <span className="text-[10px] font-normal text-zinc-500">
              {["Fast · smaller reserve", "Balanced", "Deeper liquidity"][i]}
            </span>
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`open-${id}`}>Opening cap (SOL)</Label>
          <Input
            id={`open-${id}`}
            type="number"
            min="0.1"
            max="1000"
            step="0.1"
            readOnly={readOnly}
            value={value.initialCapSol}
            onChange={(e) => patch({ initialCapSol: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`graduate-${id}`}>Graduation cap (SOL)</Label>
          <Input
            id={`graduate-${id}`}
            type="number"
            min="1"
            max="10000"
            readOnly={readOnly}
            value={value.graduationCapSol}
            onChange={(e) =>
              patch({ graduationCapSol: Number(e.target.value) })
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Fixed trading fee · curve and graduated pool</Label>
        <div className="flex gap-2">
          {([25, 100, 200] as const).map((fee) => (
            <Button
              type="button"
              key={fee}
              disabled={readOnly}
              variant="outline"
              onClick={() => patch({ feeBps: fee })}
              aria-pressed={value.feeBps === fee}
              className={
                value.feeBps === fee
                  ? "border-[#d7ff00] bg-[#d7ff00]/10 text-[#d7ff00]"
                  : "border-white/10"
              }
            >
              {fee / 100}%
            </Button>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {[
          [
            "Target SOL reserve",
            preview ? `${fmt(preview.raisedSol)} SOL` : "—",
          ],
          ["Supply", "1 billion"],
          ["Locked liquidity", "100%"],
          ["Creator fee share", "100%*"],
        ].map(([label, val]) => (
          <div key={label} className="rounded-xl border border-white/10 p-3">
            <dd className="text-sm font-semibold">{val}</dd>
            <dt className="mt-2 text-[10px] text-zinc-500">{label}</dt>
          </div>
        ))}
      </dl>
      {preview && (
        <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
          {preview.examples.map((q) => (
            <span key={q.inputSol}>
              {q.inputSol} SOL initial buy → {fmt((q.tokens / 1e9) * 100)}% of
              supply
            </span>
          ))}
        </div>
      )}
      <p className="text-xs leading-5 text-zinc-500">
        SOL values avoid a stale dollar conversion. Buy examples include the
        configured fee; reserve target excludes fees. *Creator receives the
        creator/partner allocation; Meteora protocol fees are separate. No
        automatic holder payouts or AI funding. Graduated liquidity is
        permanently locked, with fee rights retained. 1,000 tokens (0.0001%
        rounding buffer) remain withdrawable after migration by the creator. No
        initial buy. Wallet pays network fees and rent.{" "}
        <a
          href="https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/docs.md"
          target="_blank"
          rel="noreferrer"
          className="text-[#d7ff00] underline"
        >
          Meteora documentation
        </a>
      </p>
    </section>
  );
}
