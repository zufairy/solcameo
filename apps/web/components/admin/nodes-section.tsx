"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Briefcase, Bot, Download, Globe2, Loader2, Mail, Phone, RefreshCw, Search, Sparkles } from "lucide-react";
import { timeAgo } from "./util";

type Row = Doc<"nodeApplications">;
const STATUSES = ["new", "contacted", "approved", "declined"] as const;
const STATUS_CLS: Record<string, string> = {
  new: "bg-sky-500/15 text-sky-300", contacted: "bg-amber-500/15 text-amber-300",
  approved: "bg-lime-500/15 text-lime-300", declined: "bg-zinc-500/15 text-zinc-400",
};
const PURPOSE: Record<string, { label: string; icon: typeof Bot; cls: string }> = {
  business: { label: "Business", icon: Briefcase, cls: "bg-violet-500/15 text-violet-300" },
  agents: { label: "Agents earn", icon: Bot, cls: "bg-emerald-500/15 text-emerald-300" },
  both: { label: "Both", icon: Sparkles, cls: "bg-fuchsia-500/15 text-fuchsia-300" },
};
const EXPERIENCE: Record<string, string> = { none: "None yet", "1-5": "1–5 agents", "6-20": "6–20 agents", "20+": "20+ agents" };
const DAY = 86_400_000;

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function exportCsv(rows: Row[]) {
  const head = ["Name", "Email", "Phone", "Country", "Purpose", "Business", "Agents today", "Telegram", "Status", "Registered"];
  const lines = rows.map((r) => [r.fullName, r.email, r.phone, r.country, r.purpose, r.businessName, EXPERIENCE[r.experience] ?? r.experience, r.telegram, r.status ?? "new", new Date(r.createdAt).toISOString()].map(csvCell).join(","));
  const url = URL.createObjectURL(new Blob([[head.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `vello-nodes-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Stat({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: string }) {
  return <div className="rounded-xl border border-[#1e1e24] bg-[#0d0d10] px-5 py-4">
    <p className="text-[11px] uppercase tracking-wide text-zinc-600">{label}</p>
    <p className={`mt-1.5 text-2xl font-bold tabular-nums ${accent ?? "text-white"}`}>{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>}
  </div>;
}

export function NodesSection() {
  const { accessToken } = useSupabaseAuth();
  const list = useAction(api.admin.listNodeApplications);
  const setStatus = useAction(api.admin.setNodeApplicationStatus);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [purpose, setPurpose] = useState("all");
  const [status, setStatusFilter] = useState("all");
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!accessToken) return;
    try { setRows(await list({ accessToken })); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, list]);
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void (async () => {
      try { const next = await list({ accessToken }); if (!cancelled) { setRows(next); setErr(null); } }
      catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load"); }
    })();
    return () => { cancelled = true; };
  }, [accessToken, list]);
  const refresh = async () => { setBusy(true); await load(); setBusy(false); };

  async function changeStatus(id: Row["_id"], next: string) {
    if (!accessToken) return;
    const prev = rows;
    setRows((r) => r?.map((x) => (x._id === id ? { ...x, status: next } : x)) ?? r);
    try { await setStatus({ accessToken, id, status: next }); } catch (e) { setRows(prev); setErr(e instanceof Error ? e.message : "Could not update status"); }
  }

  const stats = useMemo(() => {
    const r = rows ?? [];
    const countries = new Map<string, number>();
    r.forEach((x) => x.country && countries.set(x.country, (countries.get(x.country) ?? 0) + 1));
    return {
      total: r.length, today: r.filter((x) => x.createdAt >= now - DAY).length, week: r.filter((x) => x.createdAt >= now - 7 * DAY).length,
      business: r.filter((x) => x.purpose === "business" || x.purpose === "both").length,
      agents: r.filter((x) => x.purpose === "agents" || x.purpose === "both").length,
      approved: r.filter((x) => x.status === "approved").length,
      top: [...countries].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [rows, now]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (purpose === "all" || r.purpose === purpose) && (status === "all" || (r.status ?? "new") === status)
      && (!needle || [r.fullName, r.email, r.phone, r.country, r.businessName, r.telegram].some((f) => f?.toLowerCase().includes(needle))));
  }, [rows, q, purpose, status]);

  if (rows === null) return err ? <p className="py-12 text-center text-[13px] text-red-400">{err}</p> : <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  const maxC = stats.top[0]?.[1] ?? 1;

  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Registered" value={stats.total} accent="text-lime-300" />
      <Stat label="Today" value={stats.today} hint="last 24 hours" />
      <Stat label="This week" value={stats.week} hint="last 7 days" />
      <Stat label="For business" value={stats.business} hint="business or both" />
      <Stat label="Agents earn" value={stats.agents} hint="earn or both" />
      <Stat label="Approved" value={stats.approved} />
    </div>

    {stats.top.length > 0 && <div className="rounded-xl border border-[#1e1e24] bg-[#0d0d10] px-5 py-4">
      <p className="mb-3 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-600"><Globe2 className="size-3.5" /> Top countries</p>
      <div className="grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
        {stats.top.map(([c, n]) => <div key={c} className="flex items-center gap-3 text-[12.5px]">
          <span className="w-32 truncate text-zinc-300">{c}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-lime-400/80" style={{ width: `${(n / maxC) * 100}%` }} /></span>
          <span className="w-6 text-right tabular-nums text-zinc-500">{n}</span>
        </div>)}
      </div>
    </div>}

    <div className="overflow-hidden rounded-2xl border border-[#1e1e24] bg-[#0d0d10]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#18181c] px-6 py-4">
        <div className="mr-auto">
          <h2 className="text-[15px] font-bold text-white">Node registrations</h2>
          <p className="mt-0.5 text-[11.5px] text-zinc-600">{shown.length} of {rows.length} — people who reserved a seat on /node</p>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-[#26262c] px-3 py-1.5 text-[12px] text-zinc-400 focus-within:border-lime-400/50">
          <Search className="size-3.5" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, country…" className="w-52 bg-transparent text-zinc-200 outline-none placeholder:text-zinc-600" />
        </label>
        <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="rounded-lg border border-[#26262c] bg-[#0d0d10] px-3 py-1.5 text-[12px] text-zinc-300">
          <option value="all">All purposes</option><option value="business">Business</option><option value="agents">Agents earn</option><option value="both">Both</option>
        </select>
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-[#26262c] bg-[#0d0d10] px-3 py-1.5 text-[12px] text-zinc-300">
          <option value="all">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" onClick={() => exportCsv(shown)} disabled={!shown.length} className="flex items-center gap-1.5 rounded-lg border border-[#26262c] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-40"><Download className="size-3.5" /> CSV</button>
        <button type="button" onClick={() => void refresh()} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-[#26262c] px-3 py-1.5 text-[12px] font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh</button>
      </div>
      {err && <p className="px-6 py-3 text-[12px] text-red-400">{err}</p>}
      {shown.length === 0 ? <p className="px-6 py-12 text-center text-[13px] text-zinc-600">{rows.length ? "No registrations match these filters." : "No registrations yet — they appear the moment someone reserves a seat on /node."}</p> :
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead><tr className="border-b border-[#18181c] text-[11px] uppercase tracking-wide text-zinc-600">
              <th className="px-6 py-2.5 font-semibold">Operator</th><th className="px-4 py-2.5 font-semibold">Contact</th><th className="px-4 py-2.5 font-semibold">Country</th>
              <th className="px-4 py-2.5 font-semibold">Wants</th><th className="px-4 py-2.5 font-semibold">Status</th><th className="px-4 py-2.5 font-semibold whitespace-nowrap">Registered</th>
            </tr></thead>
            <tbody>{shown.map((r) => {
              const p = PURPOSE[r.purpose ?? ""], PIcon = p?.icon, s = r.status ?? "new", expanded = open === r._id;
              return <tr key={r._id} onClick={() => setOpen(expanded ? null : r._id)} className="cursor-pointer border-b border-[#131317] align-top transition-colors hover:bg-white/[0.02]">
                <td className="px-6 py-3"><p className="font-medium text-zinc-100">{r.fullName}</p>
                  {expanded && <div className="mt-1.5 space-y-0.5 text-[11.5px] text-zinc-500">
                    {r.businessName && <p>Business: <span className="text-zinc-300">{r.businessName}</span></p>}
                    <p>Runs today: <span className="text-zinc-300">{EXPERIENCE[r.experience] ?? r.experience}</span></p>
                    {r.telegram && <p>Telegram: <span className="text-zinc-300">{r.telegram}</span></p>}
                    {r.referer && <p className="max-w-[260px] truncate">From: {r.referer}</p>}</div>}</td>
                <td className="px-4 py-3 text-zinc-300">
                  <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-sky-300 hover:underline"><Mail className="size-3" />{r.email}</a>
                  {r.phone && <a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`} onClick={(e) => e.stopPropagation()} className="mt-1 flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200"><Phone className="size-3" />{r.phone}</a>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-300">{r.country ?? "—"}</td>
                <td className="px-4 py-3">{p && PIcon ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${p.cls}`}><PIcon className="size-3" />{p.label}</span> : <span className="text-zinc-600">—</span>}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <select value={s} onChange={(e) => void changeStatus(r._id, e.target.value)} className={`rounded-full border-0 px-2.5 py-1 text-[11px] font-semibold capitalize outline-none ${STATUS_CLS[s] ?? STATUS_CLS.new}`}>
                    {STATUSES.map((x) => <option key={x} value={x} className="bg-[#0d0d10] text-zinc-200">{x}</option>)}</select></td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{timeAgo(r.createdAt)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </div>
  </div>;
}
