"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Send, Loader2, Clapperboard } from "lucide-react";
export function MarketCharacterChat({ characterId }: { characterId: string }) {
  const { authenticated, login, accessToken } = useSupabaseAuth();
  const [before, setBefore] = useState<number>();
  const live = useQuery(api.communityChat.list, {
    characterId: characterId as Id<"ssCharacters">,
  });
  const past = useQuery(
    api.communityChat.list,
    before
      ? { characterId: characterId as Id<"ssCharacters">, before }
      : "skip",
  );
  const [archive, setArchive] = useState<NonNullable<typeof live>["messages"]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const rows = useMemo(() => {
    if (!live) return undefined;
    const unique = new Map([...archive, ...live.messages].map(message => [message._id, message]));
    return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [archive, live]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const loadingHistory = before !== undefined;
  function loadOlder() {
    if (loadingHistory || !hasOlder || !rows?.length) return;
    follow.current = false;
    if (viewport.current) anchor.current = { height: viewport.current.scrollHeight, top: viewport.current.scrollTop };
    setBefore(rows[0].createdAt);
  }
  useEffect(() => {
    if (!past || before === undefined) return;
    // Cache the received Convex history page before moving the pagination cursor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArchive(previous => [...new Map([...previous, ...past.messages].map(message => [message._id, message])).values()]);
    setHasOlder(past.messages.length === 100);
    setBefore(undefined);
  }, [past, before]);
  // Retain messages that leave the latest live window as new messages arrive.
  useEffect(() => {
    // Retain the external subscription window so incoming rows cannot evict history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (live?.messages.length) setArchive(previous => [...new Map([...previous, ...live.messages].map(message => [message._id, message])).values()]);
  }, [live]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (anchor.current && !loadingHistory) {
      el.scrollTop = anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current && !anchor.current) el.scrollTop = el.scrollHeight;
  }, [rows, loadingHistory]);
  async function send() {
    if (!authenticated) {
      login();
      return;
    }
    if (!input.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/market/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ characterId, message: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInput("");
      follow.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111315]">
      <div
        ref={viewport}
        onScroll={() => {
          const el = viewport.current;
          if (!el) return;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40 && !follow.current) loadOlder();
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3"
        role="log"
        aria-label="Public community chat"
      >
        {!!rows?.length && hasOlder && <button type="button" onClick={loadOlder} disabled={loadingHistory} className="w-full py-1 text-[10px] text-zinc-500 hover:text-zinc-200">{loadingHistory ? "Loading history…" : "Load earlier messages"}</button>}
        {rows === undefined ? (
          <Loader2 className="size-4 animate-spin text-zinc-500" />
        ) : !rows.length ? (
          <p className="text-xs leading-5 text-zinc-500">
            Start the conversation. Share questions and ideas for the next
            video. The agent reviews community messages at the top of each hour.
          </p>
        ) : (
          rows.map((m) => (
            <div
              key={m._id}
              className={`rounded-lg p-2.5 ${m.role === "agent" ? "border border-[#d7ff00]/20 bg-[#d7ff00]/5" : "bg-white/[.025]"}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                <span
                  className={
                    m.role === "agent"
                      ? "font-medium text-[#d7ff00]"
                      : "text-zinc-500"
                  }
                >
                  {m.role === "agent" ? "Agent · hourly reply" : m.author}
                </span>
                <time className="text-zinc-600">
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words text-xs leading-5 text-zinc-300">
                {m.body}
              </p>
            </div>
          ))
        )}

      </div>
      {live?.plot && (
        <details className="border-t border-white/10 px-3 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-xs text-[#d7ff00]">
            <Clapperboard className="size-3.5" />
            Next video plot
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">
            {live.plot}
          </p>
          <p className="mt-2 text-[10px] text-zinc-600">
            Community-inspired proposal · not yet generated
          </p>
        </details>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="border-t border-white/10 p-3"
      >
        {error && (
          <p role="alert" className="mb-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <Textarea
          aria-label="Community message"
          value={input}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Share an idea…"
          className="min-h-12 max-h-24 resize-none border-white/10 text-xs"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-600">Visible to everyone</span>
          <Button
            type={authenticated ? "submit" : "button"}
            size="sm"
            disabled={busy || (authenticated && !input.trim())}
            onClick={authenticated ? undefined : login}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Send className="size-3" />
            )}
            {authenticated ? "Send" : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
