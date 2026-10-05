"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ShieldCheck, ShieldOff, Ban, Check, Loader2, RefreshCw, Coins, Plus } from "lucide-react";
import { fmtUsd, shortAddr, timeAgo, fmtDate, isOnline } from "./util";

type Row = {
  _id: string; name?: string; email?: string; image?: string; walletAddress?: string;
  isAdmin: boolean; status: string; createdAt?: number; lastSeenAt?: number; agentCount: number; investedUsdc: number;
  creditBalance: number;
  clipsProduced: number;
  clipsPosted: number;
};

const nf = (n: number) => n.toLocaleString("en-US");

/** Inline "add credit" control for one row — click the balance to open a
 *  small amount input in place, confirm to grant. Collapses back to the plain
 *  balance display on success, cancel, or blur so the table stays quiet by
 *  default and only one row is ever mid-edit. */
function CreditCell({
  balance, disabled, busy, onAdd,
}: { balance: number; disabled: boolean; busy: boolean; onAdd: (amount: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function submit() {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n <= 0) return;
    await onAdd(n);
    setAmount("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-zinc-300">
          <Coins className="size-3 text-amber-400/70" />{nf(balance)}
        </span>
        <button
          title="Add credit"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="p-1 rounded-md border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors disabled:opacity-40"
        >
          <Plus className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <input
        ref={inputRef}
        type="number"
        min={1}
        step={1}
        placeholder="amount"
        value={amount}
        disabled={busy}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") { setOpen(false); setAmount(""); }
        }}
        className="w-20 rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-[12px] text-white font-mono text-right outline-none focus:border-emerald-500/50 disabled:opacity-50"
      />
      <button
        title="Confirm"
        disabled={busy || !amount}
        onClick={() => void submit()}
        className="p-1 rounded-md border border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      </button>
      <button
        title="Cancel"
        disabled={busy}
        onClick={() => { setOpen(false); setAmount(""); }}
        className="p-1 rounded-md border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-white transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

export function UsersSection() {
  const { accessToken } = useSupabaseAuth();
  const listUsers = useAction(api.admin.listUsers);
  const setUserAdmin = useAction(api.admin.setUserAdmin);
  const setUserStatus = useAction(api.admin.setUserStatus);
  const adjustUserCredits = useAction(api.admin.adjustUserCredits);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Ticks so relative times ("5m ago") and the online dots recompute on their
  // own, even between data refreshes — "last seen" then reads as live.
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = (await listUsers({ accessToken })) as Row[];
      // Backend already returns newest-first; sort defensively so the UI never
      // shows stale order if the payload shape ever changes.
      next.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setRows(next);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, listUsers]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Auto-refresh the list (pulls fresh lastSeenAt) + advance the clock, so the
  // admin view stays live without a manual reload. Only polls while the tab is
  // visible to avoid background churn.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [refresh]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  }

  if (rows === null) {
    return <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  }

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-white">Users</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            {rows.length} accounts
            {(() => { const online = rows.filter((r) => isOnline(r.lastSeenAt, now)).length;
              return online > 0 ? <span className="text-emerald-500"> · {online} online now</span> : null; })()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {err && <span className="text-[11px] text-amber-400">{err}</span>}
          <button onClick={() => refresh()} className="text-zinc-600 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5"><RefreshCw className="size-3.5" /></button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
              <th className="py-3 px-4 text-left font-medium">User</th>
              <th className="py-3 px-4 text-left font-medium">Wallet</th>
              <th className="py-3 px-4 text-right font-medium">Agents</th>
              <th className="py-3 px-4 text-right font-medium whitespace-nowrap">Clips<span className="block text-[10px] font-normal">Produced / posted</span></th>
              <th className="py-3 px-4 text-right font-medium">Invested</th>
              <th className="py-3 px-4 text-right font-medium">Credits</th>
              <th className="py-3 px-4 text-left font-medium">Registered</th>
              <th className="py-3 px-4 text-left font-medium">Last seen</th>
              <th className="py-3 px-4 text-left font-medium">Status</th>
              <th className="py-3 px-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const suspended = u.status === "suspended";
              return (
                <tr key={u._id} className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded-full overflow-hidden bg-emerald-700/40 border border-[#27272a] shrink-0 flex items-center justify-center text-[11px] font-bold">
                        {u.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={u.image} alt="" className="w-full h-full object-cover" />
                          : (u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white leading-tight truncate flex items-center gap-1.5">
                          {u.name ?? "—"}
                          {u.isAdmin && <ShieldCheck className="size-3 text-emerald-400 shrink-0" />}
                        </p>
                        <p className="text-[10.5px] text-zinc-600 truncate">{u.email ?? "no email"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-zinc-500 text-[11px]">{shortAddr(u.walletAddress)}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{u.agentCount}</td>
                  <td className="py-3 px-4 text-right font-mono whitespace-nowrap" aria-label={`${u.clipsProduced ?? 0} clips produced, ${u.clipsPosted ?? 0} posted`}>
                    <span className="text-zinc-300">{nf(u.clipsProduced ?? 0)}</span><span className="mx-1 text-zinc-600">/</span><span className="text-emerald-400">{nf(u.clipsPosted ?? 0)}</span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{fmtUsd(u.investedUsdc)}</td>
                  <td className="py-3 px-4">
                    <CreditCell
                      balance={u.creditBalance}
                      disabled={!accessToken}
                      busy={busy === `credit-${u._id}`}
                      onAdd={(amount) => run(`credit-${u._id}`, () => adjustUserCredits({ accessToken: accessToken!, userId: u._id as never, deltaCredits: amount }))}
                    />
                  </td>
                  <td className="py-3 px-4 text-zinc-500 whitespace-nowrap" title={u.createdAt ? new Date(u.createdAt).toLocaleString() : undefined}>{fmtDate(u.createdAt)}</td>
                  <td className="py-3 px-4 text-zinc-500">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "never seen"}>
                      <span className={`size-1.5 rounded-full shrink-0 ${isOnline(u.lastSeenAt, now) ? "bg-emerald-400 shadow-[0_0_6px_1px_rgba(52,211,153,0.6)]" : "bg-zinc-700"}`} />
                      {isOnline(u.lastSeenAt, now) ? "online" : timeAgo(u.lastSeenAt, now)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center text-[10px] font-semibold rounded-md px-2 py-0.5 border ${
                      suspended ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                    }`}>{u.status}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        title={u.isAdmin ? "Revoke admin" : "Make admin"}
                        disabled={busy === `admin-${u._id}` || !accessToken}
                        onClick={() => run(`admin-${u._id}`, () => setUserAdmin({ accessToken: accessToken!, userId: u._id as never, isAdmin: !u.isAdmin }))}
                        className="p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors"
                      >
                        {busy === `admin-${u._id}` ? <Loader2 className="size-3.5 animate-spin" /> : u.isAdmin ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                      </button>
                      <button
                        title={suspended ? "Reactivate" : "Suspend"}
                        disabled={busy === `status-${u._id}` || !accessToken}
                        onClick={() => run(`status-${u._id}`, () => setUserStatus({ accessToken: accessToken!, userId: u._id as never, status: suspended ? "active" : "suspended" }))}
                        className="p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors"
                      >
                        {busy === `status-${u._id}` ? <Loader2 className="size-3.5 animate-spin" /> : suspended ? <Check className="size-3.5" /> : <Ban className="size-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-12 text-center text-zinc-700">No users yet — sign in with Google to create the first account.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
