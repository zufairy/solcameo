"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ExternalLink, Loader2, RefreshCw, Search, X, Headset } from "lucide-react";
import { shortAddr, timeAgo } from "@/components/admin/util";
import { TranscriptMessage, type TranscriptMsg } from "@/components/admin/TranscriptMessage";

// String refs so this typechecks before `npx convex deploy` regenerates types.
const LIST = makeFunctionReference<"action">("liveChat:listForAdmin");
const GET = makeFunctionReference<"action">("liveChat:getForAdmin");

type Identity = {
  wallet?: string;
  name?: string;
  email?: string;
  accountName?: string;
  accountEmail?: string;
};
type Row = Identity & {
  sessionId: string;
  page?: string;
  messageCount: number;
  startedAt: number;
  lastActivityAt: number;
  lastMessagePreview: string;
};
type Detail = Identity & {
  sessionId: string;
  page?: string;
  messages: TranscriptMsg[];
  messageCount: number;
  startedAt: number;
  lastActivityAt: number;
};

/** Best display name + email for a visitor: resolved account first, then what
 *  the chat itself captured, then the wallet. */
function visitorLabel(r: Identity): { title: string; email?: string; anonymous: boolean } {
  const email = r.accountEmail || r.email;
  const name = r.accountName || r.name;
  if (name) return { title: name, email, anonymous: false };
  if (email) return { title: email, anonymous: false };
  if (r.wallet) return { title: shortAddr(r.wallet), anonymous: false };
  return { title: "Anonymous", anonymous: true };
}

/** Stored `page` is the path the widget was opened from (e.g. "/agents"). Make
 *  it an absolute link on this site so it opens the real page. */
function pageHref(page: string): string {
  if (/^https?:\/\//i.test(page)) return page;
  const path = page.startsWith("/") ? page : `/${page}`;
  return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
}

function PageLink({ page, className }: { page: string; className?: string }) {
  return (
    <a
      href={pageHref(page)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-emerald-400 hover:underline ${className ?? ""}`}
      title={pageHref(page)}
    >
      <span className="truncate">{page}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

export default function AdminLiveChatsPage() {
  const { accessToken } = useSupabaseAuth();
  const listChats = useAction(LIST) as (a: { accessToken: string }) => Promise<Row[]>;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openRow, setOpenRow] = useState<Row | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try { setErr(null); setRows(await listChats({ accessToken })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, listChats]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  // Live-ish: poll every 8s so new visitor chats surface without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => { void refresh(); }, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const visible = (rows ?? []).filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (r.wallet ?? "").toLowerCase().includes(q)
      || (r.name ?? "").toLowerCase().includes(q)
      || (r.accountName ?? "").toLowerCase().includes(q)
      || (r.email ?? "").toLowerCase().includes(q)
      || (r.accountEmail ?? "").toLowerCase().includes(q)
      || r.lastMessagePreview.toLowerCase().includes(q);
  });

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white flex items-center gap-2"><Headset className="size-4 text-emerald-400" /> Live Chat</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            Every visitor conversation with the site&apos;s AI assistant · newest first · auto-refreshes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-[11px] text-amber-400">{err}</span>}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-700" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="email / name / wallet / text…"
              className="h-8 w-56 rounded-lg border border-[#1e1e24] bg-transparent pl-8 pr-2 text-[12px] text-white placeholder:text-zinc-700 outline-none focus:border-zinc-600"
            />
          </div>
          <button onClick={() => refresh()} className="text-zinc-600 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5">
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {rows === null ? (
        <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
                <th className="py-3 px-4 text-left font-medium">Visitor</th>
                <th className="py-3 px-4 text-left font-medium">Opened on</th>
                <th className="py-3 px-4 text-right font-medium">Msgs</th>
                <th className="py-3 px-4 text-left font-medium">Last message</th>
                <th className="py-3 px-4 text-left font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const who = visitorLabel(r);
                return (
                <tr
                  key={r.sessionId}
                  onClick={() => setOpenRow(r)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenRow(r); } }}
                  className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-white/[0.04]"
                >
                  <td className="py-3 px-4 max-w-[240px]">
                    <p className={`font-semibold truncate ${who.anonymous ? "text-zinc-500" : "text-white"}`}>{who.title}</p>
                    {who.email && who.email !== who.title && (
                      <p className="text-[11px] text-zinc-500 truncate">{who.email}</p>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] max-w-[220px]">
                    {r.page ? <PageLink page={r.page} className="max-w-full" /> : <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.messageCount}</td>
                  <td className="py-3 px-4 text-zinc-500 max-w-[340px] truncate">{r.lastMessagePreview || "—"}</td>
                  <td className="py-3 px-4 text-zinc-500">{timeAgo(r.lastActivityAt)}</td>
                </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-zinc-700">
                  No live chats yet — they appear here once a visitor messages the assistant.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {openRow && accessToken && (
          <ChatModal row={openRow} accessToken={accessToken} onClose={() => setOpenRow(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function ChatModal({ row, accessToken, onClose }: { row: Row; accessToken: string; onClose: () => void }) {
  const getChat = useAction(GET) as (a: { accessToken: string; sessionId: string }) => Promise<Detail | null>;
  const [detail, setDetail] = useState<Detail | null | "loading">("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChat({ accessToken, sessionId: row.sessionId })
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) { setErr(e instanceof Error ? e.message : "Failed to load"); setDetail(null); } });
    return () => { cancelled = true; };
  }, [getChat, accessToken, row.sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const messages = detail !== "loading" && detail !== null ? detail.messages : [];
  const who = visitorLabel(detail !== "loading" && detail !== null ? { ...row, ...detail } : row);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Live chat transcript"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-[#1e1e24] bg-[#0d0d10] shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[#18181c] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white truncate">{who.anonymous ? "Anonymous visitor" : who.title}</p>
            {(who.email && who.email !== who.title) || row.wallet ? (
              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {[who.email !== who.title ? who.email : undefined, row.wallet ? shortAddr(row.wallet) : undefined].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <p className="text-[11px] text-zinc-600 mt-0.5 font-mono flex items-center gap-1 min-w-0">
              <span className="shrink-0">{row.messageCount} messages · {timeAgo(row.lastActivityAt)}</span>
              {row.page && <><span className="shrink-0">·</span><PageLink page={row.page} className="min-w-0" /></>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {detail === "loading" ? (
            <div className="py-16 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>
          ) : detail === null ? (
            <p className="py-16 text-center text-zinc-600 text-[13px]">
              {err ? <>Failed to load: <span className="text-amber-400">{err}</span></> : "Chat not found."}
            </p>
          ) : (
            <>
              {messages.map((m, i) => (
                <TranscriptMessage key={i} m={m} />
              ))}
              {messages.length === 0 && <p className="py-12 text-center text-zinc-700 text-[13px]">No messages.</p>}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
