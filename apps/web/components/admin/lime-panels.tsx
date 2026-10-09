"use client";

/** Flat lime panels shared by the admin overviews (users, posted videos). Built to be screenshotted. */

export type DayBar = { key: number; label: string; count: number };

export function LimeTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-[#e4ff59] p-5 text-[#10140a]">
      <p className="text-[12px] font-semibold text-[#10140a]/60">{label}</p>
      <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</p>
      {note && <p className="mt-2 text-[12px] font-medium text-[#10140a]/65">{note}</p>}
    </div>
  );
}

/** The big number card: label, headline figure, a line of context, and a bar per day underneath. */
export function LimeHero({ label, value, line, bars, barsCaption }: { label: string; value: string; line: React.ReactNode; bars: DayBar[]; barsCaption: string }) {
  const peak = Math.max(1, ...bars.map((b) => b.count));
  return (
    <div className="flex flex-col justify-between rounded-3xl bg-[#d7ff00] p-6 text-[#10140a] sm:p-7">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#10140a]/65">{label}</p>
        <p className="mt-3 text-[clamp(3.5rem,9vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums">{value}</p>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-medium">{line}</p>
      </div>
      <div className="mt-7">
        <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={barsCaption}>
          {bars.map((b) => (
            <span key={b.key} title={`${b.label}: ${b.count}`} className="flex-1 rounded-[2px] bg-[#10140a]"
              style={{ height: `${Math.max(b.count ? 8 : 3, (b.count / peak) * 100)}%`, opacity: b.count ? 1 : 0.2 }} />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] font-medium text-[#10140a]/60"><span>{bars.length} days ago</span><span>{barsCaption}</span><span>Today</span></div>
      </div>
    </div>
  );
}

export const Dot = () => <span className="text-[#10140a]/35">·</span>;

/** Hero on the left, a 2-column grid of tiles on the right. */
export function LimeLayout({ label, hero, children }: { label: string; hero: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="mb-5 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
      {hero}
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </section>
  );
}
