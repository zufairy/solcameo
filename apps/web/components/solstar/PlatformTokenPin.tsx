"use client";
/* eslint-disable @next/next/no-img-element -- hosted token artwork */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { useSolUsd } from "@/lib/client/useSolUsd";

type Snapshot = {
  available: boolean; characterId?: string | null; name?: string; ticker?: string; mint?: string; pool?: string; image?: string;
  capSol?: number | null; changeSinceLaunchPct?: number | null; progress?: number; reserveSol?: number; targetSol?: number; migrated?: boolean;
};

const usd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;

/** The SOLCAMEO platform token, pinned above every market list with live numbers from its Meteora pool. */
export function PlatformTokenPin() {
  const solUsd = useSolUsd();
  const [data, setData] = useState<Snapshot | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/market/platform", { cache: "no-store" });
        if (res.ok && active) setData(await res.json());
      } catch { /* keep the last numbers */ }
    };
    void load();
    const timer = setInterval(load, 5000);
    window.addEventListener("focus", load);
    window.addEventListener("solcameo:trade-confirmed", load);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", load); window.removeEventListener("solcameo:trade-confirmed", load); };
  }, []);

  if (!data?.available || !data.pool) return null;
  const cap = data.capSol != null && solUsd != null ? usd(data.capSol * solUsd) : data.capSol != null ? `${data.capSol.toFixed(2)} SOL` : "—";
  const change = data.changeSinceLaunchPct;
  const up = (change ?? 0) >= 0;
  const progress = Math.round((data.progress ?? 0) * 100);
  const market = data.characterId ? `/market/${data.characterId}` : "/tokenomics";
  return (
    <section aria-label="SOLCAMEO platform token" className="group relative mb-4 overflow-hidden rounded-xl border border-[#d7ff00]/35 bg-[linear-gradient(135deg,rgba(215,255,0,0.08),rgba(255,255,255,0.02)_45%,rgba(255,255,255,0.04))] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.9)]">
      <Link href={market} aria-label={`Open ${data.name} market`} className="absolute inset-0 z-0" />
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4 sm:p-5">
        <Link href={market} className="relative z-10 flex min-w-0 items-center gap-3.5">
          {data.image ? <img src={data.image} alt="" className="size-12 shrink-0 rounded-xl border border-white/15 object-cover" /> : <span className="size-12 shrink-0 rounded-xl bg-white/10" />}
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-lg font-semibold tracking-tight text-white">{data.name}</span>
              <span className="inline-flex items-center gap-1 rounded-[3px] bg-[#d7ff00] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-black"><BadgeCheck className="size-3" />Platform</span>
            </span>
            <span className="mt-1 block font-mono text-sm text-[#d7ff00]">${data.ticker}</span>
          </span>
        </Link>
        <dl className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-[10px] uppercase tracking-wider text-zinc-500">Market cap</dt><dd className="mt-0.5 text-base font-semibold tabular-nums text-white">{cap}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wider text-zinc-500">Since launch</dt><dd className={`mt-0.5 text-base font-semibold tabular-nums ${change == null ? "text-zinc-500" : up ? "text-[#5de39a]" : "text-red-400"}`}>{change == null ? "—" : `${up ? "+" : ""}${change.toFixed(2)}%`}</dd></div>
          <div className="min-w-[150px]">
            <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{data.migrated ? "Graduated" : "Graduation"}</dt>
            <dd className="mt-1.5"><span className="block h-1.5 overflow-hidden rounded-[2px] bg-white/10"><span className="block h-full bg-[#d7ff00] transition-[width] duration-700" style={{ width: `${progress}%` }} /></span><span className="mt-1 block text-xs tabular-nums text-zinc-400">{progress}%{!data.migrated && data.targetSol ? ` · ${data.reserveSol?.toFixed(1)} / ${data.targetSol.toFixed(1)} SOL` : ""}</span></dd>
          </div>
        </dl>
        <div className="relative z-10 flex shrink-0 items-center gap-2">
          <Link href="/tokenomics" className="inline-flex h-9 items-center rounded-[3px] border border-white/15 bg-white/[0.06] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/10">Tokenomics</Link>
          <Link href={market} className="inline-flex h-9 items-center gap-1.5 rounded-[3px] bg-[#d7ff00] px-3.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#e4ff59]">Buy / Sell <ArrowUpRight className="size-3.5" /></Link>
        </div>
      </div>
    </section>
  );
}
