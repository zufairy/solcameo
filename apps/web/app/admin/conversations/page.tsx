"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Bot, ExternalLink, Loader2, MessageCircle, RefreshCw, Search, UserRound, X } from "lucide-react";
import { shortAddr, timeAgo } from "@/components/admin/util";
import { TranscriptMessage } from "@/components/admin/TranscriptMessage";
import type { FunctionReturnType } from "convex/server";
import type { BuilderSessionDetail } from "@/convex/adminBuilder";

type Row = FunctionReturnType<typeof api.adminBuilder.listBuilderSessions>[number];
type Filter = "all" | "not_minted" | "minted";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_minted", label: "Didn't mint" },
  { key: "minted", label: "Minted" },
];

const STATUS_STYLE: Record<Row["status"], string> = {
  minted: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  draft: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  abandoned: "text-amber-400 bg-amber-500/10 border-amber-500/20",
};

export default function AdminConversationsPage() {
  const { accessToken } = useSupabaseAuth();
  const listSessions = useAction(api.adminBuilder.listBuilderSessions);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<Row | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try { setErr(null); setRows(await listSessions({ accessToken, filter })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, listSessions, filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const visible = (rows ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.wallet.toLowerCase().includes(q)
      || (r.accountName ?? "").toLowerCase().includes(q)
      || (r.accountEmail ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Builder conversations</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            Filtered from the latest 300 wallet-connected sessions · synced from /builder since this feature shipped
          </p>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-amber-400">{err}</span>}
          <div className="flex items-center gap-1 rounded-lg border border-[#1e1e24] p-0.5">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  filter === key ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-600 hover:text-zinc-300"
                }`}
              >{label}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-700" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="account / email / wallet…"
              className="h-8 w-44 rounded-lg border border-[#1e1e24] bg-transparent pl-8 pr-2 text-[12px] text-white placeholder:text-zinc-700 outline-none focus:border-zinc-600"
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
                <th className="py-3 px-4 text-left font-medium">Agent</th>
                <th className="py-3 px-4 text-left font-medium">Type</th>
                <th className="py-3 px-4 text-right font-medium">Msgs</th>
                <th className="py-3 px-4 text-left font-medium">Last message</th>
                <th className="py-3 px-4 text-left font-medium">Last active</th>
                <th className="py-3 px-4 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.sessionId}
                  onClick={() => setOpenRow(r)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenRow(r); } }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open conversation with ${r.accountName ?? r.accountEmail ?? shortAddr(r.wallet)}`}
                  className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-white/[0.04]"
                >
                  <td className="py-3 px-4 max-w-[220px]">
                    {r.accountName || r.accountEmail ? (
                      <>
                        <p className="text-white font-semibold truncate">{r.accountName ?? r.accountEmail}</p>
                        {r.accountName && r.accountEmail && (
                          <p className="text-[11px] text-zinc-500 truncate">{r.accountEmail}</p>
                        )}
                      </>
                    ) : (
                      <span className="text-zinc-600">No account</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <Link
                      href={`/admin/conversations/${encodeURIComponent(r.sessionId)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-emerald-400 hover:underline text-[11px]"
                    >
                      {shortAddr(r.wallet)}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-white font-semibold">{r.draftName ?? r.projectName ?? "—"}</td>
                  <td className="py-3 px-4 text-zinc-500">{r.agentType ?? "—"}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.messageCount}</td>
                  <td className="py-3 px-4 text-zinc-500 max-w-[320px] truncate">{r.lastMessagePreview || "—"}</td>
                  <td className="py-3 px-4 text-zinc-500">{timeAgo(r.lastActivityAt)}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center text-[10px] font-semibold rounded-md px-2 py-0.5 border ${STATUS_STYLE[r.status]}`}>
                      {r.status === "draft" ? "in progress" : r.status}
                    </span>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-zinc-700">
                  No sessions yet — transcripts appear once wallet-connected users chat in the builder.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {openRow && accessToken && (
          <ConversationModal
            row={openRow}
            accessToken={accessToken}
            onClose={() => setOpenRow(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Conversation popup — full transcript in an animated modal ────────────────
function ConversationModal({ row, accessToken, onClose }: {
  row: Row;
  accessToken: string;
  onClose: () => void;
}) {
  const getSession = useAction(api.adminBuilder.getBuilderSession);
  const [detail, setDetail] = useState<BuilderSessionDetail | null | "loading">("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSession({ accessToken, sessionId: row.sessionId })
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => {
        if (!cancelled) { setErr(e instanceof Error ? e.message : "Failed to load"); setDetail(null); }
      });
    return () => { cancelled = true; };
  }, [getSession, accessToken, row.sessionId]);

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const session = detail !== "loading" && detail !== null ? detail.session : null;
  const userMessageCount = session?.messages.filter((message) => message.role === "user").length ?? 0;
  const aiMessageCount = session?.messages.filter((message) => message.role === "assistant").length ?? 0;

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
      aria-label="Conversation transcript"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="flex h-[min(860px,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#1e1e24] bg-[#0d0d10] shadow-2xl shadow-black/60"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#18181c] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white truncate">
              {row.draftName ?? row.projectName ?? "Builder session"}
            </p>
            <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
              {row.accountName || row.accountEmail ? `${[row.accountName, row.accountEmail].filter(Boolean).join(" · ")} · ` : ""}{shortAddr(row.wallet)} · {row.messageCount} messages · {timeAgo(row.lastActivityAt)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Link
              href={`/admin/conversations/${encodeURIComponent(row.sessionId)}`}
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline px-2 py-1.5"
            >
              <ExternalLink className="size-3" /> Full page
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Transcript */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
          {detail === "loading" ? (
            <div className="py-16 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>
          ) : detail === null || !session ? (
            <p className="py-16 text-center text-zinc-600 text-[13px]">
              {err ? <>Failed to load: <span className="text-amber-400">{err}</span></> : "Session not found."}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 pb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#111115]/95 px-2.5 py-1 text-[10.5px] text-zinc-500 backdrop-blur">
                  <MessageCircle className="size-3" /> {session.messages.length} turns loaded
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-[#111115]/95 px-2.5 py-1 text-[10.5px] text-emerald-400/80 backdrop-blur">
                  <UserRound className="size-3" /> {userMessageCount} user
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/15 bg-[#111115]/95 px-2.5 py-1 text-[10.5px] text-violet-300/80 backdrop-blur">
                  <Bot className="size-3" /> {aiMessageCount} AI
                </span>
              </div>
              {session.messageCount > session.messages.length && (
                <p className="text-[11px] text-zinc-600 text-center">
                  Showing the last {session.messages.length} of {session.messageCount} messages (older messages trimmed at sync).
                </p>
              )}
              {session.messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(i * 0.015, 0.25) }}
                >
                  <TranscriptMessage m={m} />
                </motion.div>
              ))}
              {session.messages.length === 0 && (
                <p className="py-12 text-center text-zinc-700 text-[13px]">No text messages captured.</p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
