/* eslint-disable @next/next/no-img-element -- remote avatars */
/** Influencer row: portrait, bold all-caps name, ticker chip. */
export function AgentOption({ name, ticker, avatarUrl }: { name: string; ticker?: string; avatarUrl?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {avatarUrl ? <img src={avatarUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-white/15" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10 text-sm font-bold">{name.slice(0, 1).toUpperCase()}</span>}
      <span className="truncate text-[15px] font-extrabold uppercase tracking-wide text-white">{name}</span>
      {ticker && <span className="shrink-0 rounded-md bg-[#d7ff00]/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#d7ff00]">${ticker}</span>}
    </span>
  );
}
