"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, RefreshCw, Search, X, Users2, MessagesSquare } from "lucide-react";
import { shortAddr, timeAgo } from "@/components/admin/util";
import { TranscriptMessage } from "@/components/admin/TranscriptMessage";
import type { Id } from "@/convex/_generated/dataModel";
import type { ControlConversationUserRow, ControlConversationThreadRow } from "@/convex/adminControlPanel";

export default function AdminControlPanelPage() {
  const { accessToken } = useSupabaseAuth();
  const listUsers = useAction(api.adminControlPanel.listControlConversationUsers);
  const [rows, setRows] = useState<ControlConversationUserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openUserId, setOpenUserId] = useState<Id<"users"> | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try { setErr(null); setRows(await listUsers({ accessToken })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, listUsers]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const visible = (rows ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (r.accountName ?? "").toLowerCase().includes(q)
      || (r.accountEmail ?? "").toLowerCase().includes(q)
      || (r.walletAddress ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Control Panel conversations</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            Every account's /control chat history — teams and per-agent threads, grouped by who's talking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-amber-400">{err}</span>}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-700" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="account / email / wallet…"
              className="h-8 w-48 rounded-lg border border-[#1e1e24] bg-transparent pl-8 pr-2 text-[12px] text-white placeholder:text-zinc-700 outline-none focus:border-zinc-600"
            />
          </div>
          <button onClick={() => refresh()} className="text-zinc-600 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {rows === null ? (
        err ? (
          <div className="py-20 text-center text-[13px] text-zinc-600">
            Failed to load: <span className="text-amber-400">{err}</span>
            <div className="mt-3">
              <button onClick={() => void refresh()} className="text-emerald-400 hover:underline">Retry</button>
            </div>
          </div>
        ) : (
          <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
                <th className="py-3 px-4 text-left font-medium">Account</th>
                <th className="py-3 px-4 text-left font-medium">Wallet</th>
                <th className="py-3 px-4 text-right font-medium">Teams</th>
                <th className="py-3 px-4 text-right font-medium">Threads</th>
                <th className="py-3 px-4 text-right font-medium">Msgs</th>
                <th className="py-3 px-4 text-left font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.userId}
                  onClick={() => setOpenUserId(r.userId as Id<"users">)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenUserId(r.userId as Id<"users">); } }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open conversations for ${r.accountName ?? r.accountEmail ?? shortAddr(r.walletAddress)}`}
                  className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-white/[0.04]"
                >
                  <td className="py-3 px-4 max-w-[240px]">
                    {r.accountName || r.accountEmail ? (
                      <>
                        <p className="text-white font-semibold truncate">{r.accountName ?? r.accountEmail}</p>
                        {r.accountName && r.accountEmail && (
                          <p className="text-[11px] text-zinc-500 truncate">{r.accountEmail}</p>
                        )}
                      </>
                    ) : (
                      <span className="text-zinc-600">No account name</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-zinc-400 text-[11px]">{shortAddr(r.walletAddress)}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.teamCount}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.threadCount}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.totalMessages}</td>
                  <td className="py-3 px-4 text-zinc-500">{timeAgo(r.lastActivityAt)}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-zinc-700">
                  No /control chat activity yet — threads appear once a user opens the panel and chats with an agent or team.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {openUserId && accessToken && (
          <ControlUserModal
            userId={openUserId}
            accessToken={accessToken}
            row={visible.find((r) => r.userId === openUserId) ?? null}
            onClose={() => setOpenUserId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

type Detail = { user: { accountName?: string; accountEmail?: string; walletAddress?: string } | null; teams: unknown[]; threads: ControlConversationThreadRow[] };

// ─── One account's teams + agent threads, with the full transcript ─────────
function ControlUserModal({ userId, accessToken, row, onClose }: {
  userId: Id<"users">;
  accessToken: string;
  row: ControlConversationUserRow | null;
  onClose: () => void;
}) {
  const getDetail = useAction(api.adminControlPanel.getControlConversationDetail);
  const [detail, setDetail] = useState<Detail | null | "loading">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDetail({ accessToken, userId })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setActiveKey(d?.threads[0]?.key ?? null);
      })
      .catch((e) => {
        if (!cancelled) { setErr(e instanceof Error ? e.message : "Failed to load"); setDetail(null); }
      });
    return () => { cancelled = true; };
  }, [getDetail, accessToken, userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = detail !== "loading" && detail !== null ? detail.threads.find((t) => t.key === activeKey) ?? null : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Control panel conversations"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-[#1e1e24] bg-[#0d0d10] shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#18181c] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white truncate">
              {row?.accountName ?? row?.accountEmail ?? "Account"}
            </p>
            <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
              {shortAddr(row?.walletAddress)} · {row?.threadCount ?? 0} threads · {row?.totalMessages ?? 0} messages
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <X className="size-4" />
          </button>
        </div>

        {detail === "loading" ? (
          <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>
        ) : detail === null ? (
          <p className="py-20 text-center text-zinc-600 text-[13px]">
            {err ? <>Failed to load: <span className="text-amber-400">{err}</span></> : "Not found."}
          </p>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Thread list */}
            <div className="w-52 shrink-0 border-r border-[#18181c] overflow-y-auto py-2">
              {detail.threads.length === 0 && (
                <p className="px-4 py-8 text-center text-[11.5px] text-zinc-700">No threads yet.</p>
              )}
              {detail.threads.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveKey(t.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] transition-colors ${
                    activeKey === t.key ? "bg-emerald-500/10 text-emerald-300" : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
                  }`}
                >
                  {t.key.startsWith("team:") ? <Users2 className="size-3.5 shrink-0" /> : <MessagesSquare className="size-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.label}</span>
                    <span className="block text-[10px] text-zinc-600">{t.messages.length} msgs · {timeAgo(t.updatedAt)}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {!active ? (
                <p className="py-16 text-center text-zinc-700 text-[13px]">Select a thread.</p>
              ) : active.messages.length === 0 ? (
                <p className="py-16 text-center text-zinc-700 text-[13px]">No messages in this thread.</p>
              ) : (
                active.messages.map((m, i) => (
                  <motion.div
                    key={m.id ?? i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(i * 0.015, 0.25) }}
                  >
                    <TranscriptMessage m={m} />
                  </motion.div>
                ))
              )}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
