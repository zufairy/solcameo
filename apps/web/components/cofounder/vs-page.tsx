"use client";

import Link from "next/link";
import { Check, Minus, ArrowRight } from "lucide-react";
import { Navigation } from "@/components/cofounder/cofounder-landing";
import { Footer } from "@/components/cofounder/footer";

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;
const NEORIS = { fontFamily: "var(--font-neoris), sans-serif" } as const;

export type RowValue = true | false | string;

export function ComparisonCell({ value }: { value: RowValue }) {
  if (value === true) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-white/[0.06] text-white/25">
        <Minus className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  return <span className="text-[13px] text-white/70">{value}</span>;
}

export function VsPage({
  competitor,
  intro,
  rows,
  whenThem,
  whenVello,
  disclaimer,
}: {
  competitor: string;
  intro: string;
  rows: { label: string; vello: RowValue; them: RowValue }[];
  whenThem: string;
  whenVello: string;
  disclaimer?: string;
}) {
  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />

      <main className="mx-auto max-w-[1000px] px-6 pb-24 pt-16 sm:px-10 sm:pt-24">
        <p className="text-[13px] font-semibold uppercase tracking-[0.28em] text-white/50" style={MANROPE}>
          Comparison
        </p>
        <h1 className="mt-4 max-w-2xl text-[clamp(1.8rem,4.4vw,2.8rem)] font-medium leading-[1.15] tracking-[-0.03em]" style={NEORIS}>
          Vello vs {competitor}
        </h1>
        <p className="mt-4 max-w-xl text-[16px] font-light leading-relaxed text-white/60 sm:text-[17px]" style={MANROPE}>
          {intro}
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/builder"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
          >
            Start a clipping campaign
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="mt-14 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[560px] border-collapse text-left text-[14px]" style={MANROPE}>
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-5 py-4 font-medium text-white/50">Feature</th>
                <th className="px-5 py-4 text-center font-semibold text-white">Vello</th>
                <th className="px-5 py-4 text-center font-medium text-white/50">{competitor}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-white/[0.06] last:border-0">
                  <td className="px-5 py-4 text-white/80">{row.label}</td>
                  <td className="px-5 py-4 text-center">
                    <div className="flex justify-center">
                      <ComparisonCell value={row.vello} />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <div className="flex justify-center">
                      <ComparisonCell value={row.them} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-white/35" style={MANROPE}>
          {disclaimer ??
            `Feature comparison based on publicly available ${competitor} product information as of ${new Date().getFullYear()}. ${competitor} is a trademark of its respective owner; Vello is not affiliated with ${competitor}.`}
        </p>

        <section className="mt-16 space-y-10">
          <div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em]" style={NEORIS}>
              When to use {competitor}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] font-light leading-relaxed text-white/60" style={MANROPE}>
              {whenThem}
            </p>
          </div>
          <div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em]" style={NEORIS}>
              When to use Vello
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] font-light leading-relaxed text-white/60" style={MANROPE}>
              {whenVello}
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
