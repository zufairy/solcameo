"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PRIVY_ENABLED } from "@/lib/privy";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { CHAT_MAX, chatErrorMessage } from "@/lib/solstar/feedView";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";

type ViewProps = { signedIn: boolean; onConnect?: () => void };

const isComposing = (e: KeyboardEvent<HTMLTextAreaElement>) => e.nativeEvent.isComposing || e.keyCode === 229;

function ComposerView({ signedIn, onConnect }: ViewProps) {
  const id = useId();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const disabled = !signedIn;

  async function send() {
    if (!signedIn || sending) return;
    if (!trimmed) return;
    setSending(true);
    setError(null);
    setExpired(false);
    try {
      // Authenticated users may not have a SIWS proof yet; mint one via the existing registered flow.
      if (!getCurrentSiwsToken()) await ensureSiwsViaRegistered();
      const res = await fetch("/api/solstar/feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (res.ok) {
        setText("");
      } else {
        let code: string | undefined;
        try {
          const j = (await res.json()) as { error?: string };
          code = j.error;
        } catch {
          /* non-JSON error body */
        }
        setError(chatErrorMessage(res.status, code));
        setExpired(res.status === 401);
      }
    } catch {
      setError(chatErrorMessage(0));
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !isComposing(e)) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-border p-3">
      <label htmlFor={id} className="sr-only">
        Message to the live feed
      </label>
      <Textarea
        id={id}
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        maxLength={CHAT_MAX}
        rows={2}
        disabled={disabled}
        readOnly={sending}
        aria-busy={sending}
        aria-describedby={`${id}-hint`}
        placeholder={signedIn ? "Say what's happening… (Enter to send, Shift+Enter for a new line)" : "Connect wallet to chat"}
        className="min-h-[56px] resize-none"
      />
      <div className="flex items-center justify-between gap-3">
        <p id={`${id}-hint`} className="min-w-0 text-xs text-muted-foreground">
          {error ? (
            <span role="alert" className="text-red-400">
              {error}
            </span>
          ) : signedIn ? (
            <span className="tabular-nums">
              {text.length}/{CHAT_MAX}
            </span>
          ) : (
            "Connect wallet to chat."
          )}
        </p>
        {signedIn && expired ? (
          <Button type="button" size="sm" onClick={onConnect} className="h-9">
            Reconnect
          </Button>
        ) : signedIn ? (
          <Button type="submit" size="sm" disabled={sending || !trimmed} className="h-9 gap-1.5">
            <Send className="size-3.5" aria-hidden />
            {sending ? "Sending…" : "Send"}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onConnect} disabled={!onConnect} className="h-9">
            Connect wallet to chat
          </Button>
        )}
      </div>
    </form>
  );
}

function PrivyComposer() {
  const { authenticated } = usePrivy();
  const { signInWithGoogle } = useSupabaseAuth();
  return <ComposerView signedIn={authenticated} onConnect={() => void signInWithGoogle()} />;
}

export function FeedComposer() {
  return PRIVY_ENABLED ? <PrivyComposer /> : <ComposerView signedIn={false} />;
}
