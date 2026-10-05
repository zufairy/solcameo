"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  Loader2, UsersRound, Eye, Film, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  Check, X, Search,
} from "lucide-react";
import { timeAgo } from "./util";

const LIST = makeFunctionReference<"query">("opsInterns:list");
const DASHBOARD = makeFunctionReference<"query">("opsInterns:dashboard");
const AGENTS = makeFunctionReference<"query">("opsInterns:listClippingAgents");
const UPSERT = makeFunctionReference<"mutation">("opsInterns:upsert");
const REMOVE = makeFunctionReference<"mutation">("opsInterns:remove");

type RangeKey = "today" | "7d";

type AgentLite = {
  mintAddress: string;
  name: string;
  handle: string;
  avatarUrl: string;
  agentType: string;
};

type InternRow = {
  id: string;
  name: string;
  note: string;
  mintAddresses: string[];
  active: boolean;
  sortOrder: number;
};

type DashAccount = {
  mintAddress: string;
  agentName: string;
  agentHandle: string;
  agentAvatar: string;
  agentType: string;
  postsInRange: number;
  viewsInRange: number;
  lastPostedAt: number | null;
};

type DashIntern = {
  id: string;
  name: string;
  note: string;
  active: boolean;
  mintAddresses: string[];
  postsInRange: number;
  viewsInRange: number;
  accounts: DashAccount[];
};

type Dashboard = {
  rangeStartMs: number;
  rangeEndMs: number;
  totals: { posts: number; views: number; accounts: number; internsActive: number };
  interns: DashIntern[];
};

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function rangeFor(key: RangeKey): { start: number; end: number } {
  const end = Date.now();
  if (key === "today") return { start: startOfLocalDay(), end };
  return { start: startOfLocalDay() - 6 * 24 * 60 * 60 * 1000, end };
}

const fmtViews = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0e0e12] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums tracking-tight text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function ProgressBar({ value, target }: { value: number; target: number }) {
  const pct = target <= 0 ? 0 : Math.min(100, Math.round((value / target) * 100));
  const tone = pct >= 100 ? "bg-emerald-400" : pct >= 50 ? "bg-amber-400" : "bg-zinc-500";
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
        <span>Progress</span>
        <span className="tabular-nums text-zinc-400">{value} / {target} posts</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RosterEditor({
  agents,
  initial,
  onClose,
  onSaved,
}: {
  agents: AgentLite[];
  initial: InternRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsert = useMutation(UPSERT);
  const [name, setName] = useState(initial?.name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [mints, setMints] = useState<string[]>(initial?.mintAddresses ?? []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return agents.slice(0, 80);
    return agents.filter((a) =>
      a.name.toLowerCase().includes(needle) ||
      a.handle.toLowerCase().includes(needle) ||
      a.mintAddress.toLowerCase().includes(needle),
    ).slice(0, 80);
  }, [agents, q]);

  const toggle = (mint: string) => {
    setMints((prev) => prev.includes(mint) ? prev.filter((m) => m !== mint) : [...prev, mint]);
  };

  async function save() {
    if (!name.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr(null);
    try {
      await upsert({
        ...(initial?.id ? { id: initial.id as never } : {}),
        name: name.trim(),
        note: note.trim() || undefined,
        mintAddresses: mints,
        active,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-hidden rounded-2xl border border-[#1e1e24] bg-[#0d0d10] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e24]">
          <h3 className="text-[15px] font-bold text-white">{initial ? "Edit intern" : "Add intern"}</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aisha"
              className="mt-1 w-full h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-[13px] text-white outline-none focus:border-zinc-600"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Shift, focus niche…"
              className="mt-1 w-full h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-[13px] text-white outline-none focus:border-zinc-600"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-zinc-300">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-zinc-600" />
            Active on the meeting board
          </label>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Clipping accounts · {mints.length} selected
              </span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-zinc-600" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, @handle, mint…"
                className="w-full h-9 rounded-xl border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-[12.5px] text-white outline-none focus:border-zinc-600"
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-zinc-800 divide-y divide-zinc-900">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-zinc-600">No agents match.</p>
              ) : filtered.map((a) => {
                const on = mints.includes(a.mintAddress);
                return (
                  <button
                    key={a.mintAddress}
                    type="button"
                    onClick={() => toggle(a.mintAddress)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-900/60 ${on ? "bg-emerald-500/5" : ""}`}
                  >
                    {a.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatarUrl} alt="" className="size-7 rounded-full object-cover border border-zinc-700" />
                    ) : (
                      <div className="size-7 rounded-full bg-zinc-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-white truncate">{a.name}</p>
                      <p className="text-[10.5px] text-zinc-500 truncate">
                        {a.handle ? `@${a.handle.replace(/^@/, "")}` : a.mintAddress.slice(0, 12) + "…"}
                        {a.agentType ? ` · ${a.agentType}` : ""}
                      </p>
                    </div>
                    {on ? <Check className="size-4 text-emerald-400 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
          {err ? <p className="text-[12px] text-red-400">{err}</p> : null}
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-[#1e1e24]">
          <button type="button" onClick={onClose} className="flex-1 h-10 rounded-xl border border-zinc-700 text-zinc-300 text-[13px] font-semibold hover:border-zinc-500">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="flex-1 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[13px] font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function InternsSection() {
  const [range, setRange] = useState<RangeKey>("today");
  const bounds = useMemo(() => rangeFor(range), [range]);
  const roster = useQuery(LIST) as InternRow[] | undefined;
  const dash = useQuery(DASHBOARD, { rangeStartMs: bounds.start, rangeEndMs: bounds.end }) as Dashboard | undefined;
  const agents = (useQuery(AGENTS) ?? []) as AgentLite[];
  const remove = useMutation(REMOVE);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<InternRow | null | "new">(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loading = roster === undefined || dash === undefined;

  const postsPerAccountTarget = range === "today" ? 4 : 28;

  async function onDelete(id: string, name: string) {
    if (!confirm(`Remove ${name} from the roster?`)) return;
    setBusyId(id);
    try {
      await remove({ id: id as never });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-tight text-white">
            <UsersRound className="size-5 text-emerald-400" />
            Intern clipping
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 max-w-xl">
            God-eye board for meetings — posts and views across each intern&apos;s clipping accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-zinc-800 p-0.5 bg-zinc-950">
            {([
              ["today", "Today"],
              ["7d", "Last 7 days"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                className={`h-8 px-3 rounded-[10px] text-[12px] font-semibold transition-colors ${
                  range === k ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEditor("new")}
            className="h-9 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[12.5px] font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="size-3.5" /> Add intern
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-16 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading board…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Posts" value={String(dash.totals.posts)} sub={range === "today" ? "posted today" : "last 7 days"} />
            <Kpi label="Views" value={fmtViews(dash.totals.views)} sub="synced view counts" />
            <Kpi label="Interns" value={String(dash.totals.internsActive)} sub="active on roster" />
            <Kpi label="Accounts" value={String(dash.totals.accounts)} sub="clipping agents tracked" />
          </div>

          {dash.interns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-[#0e0e12] px-6 py-14 text-center">
              <UsersRound className="size-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-[15px] font-semibold text-white">Add your first intern</p>
              <p className="mt-1 text-[13px] text-zinc-500 max-w-sm mx-auto">
                Map each person to the Vello clipping agents they run (~4 accounts each). Then this board fills with live posts and views.
              </p>
              <button
                type="button"
                onClick={() => setEditor("new")}
                className="mt-5 h-10 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[13px] font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="size-4" /> Add intern
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {dash.interns.map((intern) => {
                const open = expanded[intern.id] ?? true;
                const target = Math.max(1, intern.accounts.length) * postsPerAccountTarget;
                const rosterRow = roster?.find((r) => r.id === intern.id) ?? null;
                return (
                  <div key={intern.id} className={`rounded-2xl border bg-[#0e0e12] overflow-hidden ${intern.active ? "border-[#1e1e24]" : "border-zinc-900 opacity-70"}`}>
                    <div className="flex items-stretch gap-2 px-4 py-3">
                      <button
                        type="button"
                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                        onClick={() => setExpanded((s) => ({ ...s, [intern.id]: !open }))}
                      >
                        {open ? <ChevronDown className="size-4 text-zinc-600 shrink-0" /> : <ChevronRight className="size-4 text-zinc-600 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[15px] font-bold text-white">{intern.name}</p>
                            {!intern.active ? (
                              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Paused</span>
                            ) : null}
                            {intern.note ? <span className="text-[11px] text-zinc-500 truncate">{intern.note}</span> : null}
                          </div>
                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-md">
                            <div className="rounded-lg bg-zinc-900/70 border border-zinc-800 px-2.5 py-1.5">
                              <p className="text-[9.5px] uppercase tracking-wide text-zinc-600 flex items-center gap-1"><Film className="size-2.5" /> Posts</p>
                              <p className="text-[16px] font-bold tabular-nums text-white">{intern.postsInRange}</p>
                            </div>
                            <div className="rounded-lg bg-zinc-900/70 border border-zinc-800 px-2.5 py-1.5">
                              <p className="text-[9.5px] uppercase tracking-wide text-zinc-600 flex items-center gap-1"><Eye className="size-2.5" /> Views</p>
                              <p className="text-[16px] font-bold tabular-nums text-white">{fmtViews(intern.viewsInRange)}</p>
                            </div>
                            <div className="rounded-lg bg-zinc-900/70 border border-zinc-800 px-2.5 py-1.5 col-span-2 sm:col-span-1">
                              <p className="text-[9.5px] uppercase tracking-wide text-zinc-600">Accounts</p>
                              <p className="text-[16px] font-bold tabular-nums text-white">{intern.accounts.length}</p>
                            </div>
                          </div>
                          <ProgressBar value={intern.postsInRange} target={target} />
                        </div>
                      </button>
                      <div className="flex flex-col gap-1 shrink-0 pt-1">
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => setEditor(rosterRow)}
                          className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          disabled={busyId === intern.id}
                          onClick={() => void onDelete(intern.id, intern.name)}
                          className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                        >
                          {busyId === intern.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </button>
                      </div>
                    </div>

                    {open ? (
                      <div className="border-t border-[#1e1e24]">
                        {intern.accounts.length === 0 ? (
                          <p className="px-4 py-3 text-[12px] text-zinc-600">No accounts assigned — edit to attach clipping agents.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left min-w-[560px]">
                              <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-zinc-600 border-b border-zinc-900">
                                  <th className="px-4 py-2 font-semibold">Account</th>
                                  <th className="px-3 py-2 font-semibold text-right">Posts</th>
                                  <th className="px-3 py-2 font-semibold text-right">Views</th>
                                  <th className="px-4 py-2 font-semibold text-right">Last posted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {intern.accounts.map((a) => (
                                  <tr key={a.mintAddress} className="border-b border-zinc-900/80 last:border-0">
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        {a.agentAvatar ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={a.agentAvatar} alt="" className="size-7 rounded-full object-cover border border-zinc-700 shrink-0" />
                                        ) : (
                                          <div className="size-7 rounded-full bg-zinc-800 shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                          <p className="text-[12.5px] font-semibold text-white truncate">{a.agentName}</p>
                                          <p className="text-[10.5px] text-zinc-500 truncate">
                                            {a.agentHandle ? `@${a.agentHandle.replace(/^@/, "")}` : a.mintAddress.slice(0, 10) + "…"}
                                          </p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className={`px-3 py-2.5 text-right text-[13px] font-bold tabular-nums ${a.postsInRange === 0 ? "text-zinc-600" : "text-white"}`}>
                                      {a.postsInRange}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums text-zinc-300">
                                      {fmtViews(a.viewsInRange)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-[11px] text-zinc-500">
                                      {a.lastPostedAt ? timeAgo(a.lastPostedAt) : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {editor !== null ? (
        <RosterEditor
          agents={agents}
          initial={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
