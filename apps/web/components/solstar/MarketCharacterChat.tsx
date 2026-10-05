"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { History, Send, Loader2, Clapperboard } from "lucide-react";
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
  const rows = before ? past?.messages : live?.messages;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!before) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [live?.messages.length, before]);
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
      setBefore(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-[650px] max-h-[85vh] min-h-[420px] flex-col bg-[#111315]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-3">
        <div>
          <p className="text-xs font-medium text-white">Community chat</p>
          <p className="mt-1 text-[10px] text-zinc-500">
            Public · agent replies hourly
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={before ? "Return to live chat" : "View chat history"}
          onClick={() =>
            setBefore(before ? undefined : (rows?.[0]?.createdAt ?? Date.now()))
          }
        >
          <History className="size-4" />
        </Button>
      </div>
      {before && (
        <div className="flex justify-between border-b border-white/10 p-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!rows?.length}
            onClick={() => setBefore(rows?.[0]?.createdAt)}
          >
            Older
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setBefore(undefined)}
          >
            Back to live
          </Button>
        </div>
      )}
      <div
        className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
        role="log"
        aria-label="Public community chat"
      >
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
        <div ref={bottom} />
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
          className="min-h-16 resize-none border-white/10 text-xs"
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
