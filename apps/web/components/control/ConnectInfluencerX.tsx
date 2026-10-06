"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

type XAccount = { handle?: string; displayName?: string; image?: string };

function connectionError(mint: string): string {
  if (typeof window === "undefined") return "";
  const returned = new URL(window.location.href);
  return returned.searchParams.get("agent") === mint && returned.searchParams.get("x_connect") === "error"
    ? returned.searchParams.get("x_message") || "X connection failed. Try again."
    : "";
}

/** Live, owner-scoped status: cached marketplace badges can lag an OAuth return. */
export function ConnectInfluencerX({ mint, name, compact = false }: { mint: string; name: string; compact?: boolean }) {
  const { getFreshToken } = useSupabaseAuth();
  const [account, setAccount] = useState<XAccount | null>(null);
  const [open, setOpen] = useState(() => Boolean(connectionError(mint)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => connectionError(mint));
  const check = useCallback(async (signal?: AbortSignal) => {
    try {
      const token = await getFreshToken();
      if (!token || signal?.aborted) return;
      const res = await fetch(`/api/social/status?username=${encodeURIComponent(mint)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not verify the bound X account.");
      const connected = data.connected?.x || data.connected?.twitter;
      setAccount(connected && typeof connected === "object" ? connected : connected ? {} : null);
    } catch { /* Keep the connection action available when status is unavailable. */ }
  }, [mint, getFreshToken]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { if (document.visibilityState === "visible") void check(controller.signal); };
    // State is updated only after the authenticated status request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check(controller.signal);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [check]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, busy]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const token = await getFreshToken();
      if (!token) throw new Error("Sign in before connecting your influencer's X account.");
      const redirect = new URL(window.location.href);
      redirect.searchParams.set("agent", mint);
      redirect.searchParams.delete("x_connect");
      redirect.searchParams.delete("x_message");
      const res = await fetch("/api/social/x/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: mint, redirectUrl: redirect.href, allowAutomatedPosting: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.url) throw new Error(data.error || "Could not connect X. Try again.");
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect X.");
      setBusy(false);
    }
  }

  return <>
    <button type="button" onClick={() => { setError(""); setOpen(true); }} title={account?.handle ? `@${account.handle.replace(/^@/, "")}` : "Bind an X account for automatic posting"} aria-label={account ? `X binded: ${account.displayName || account.handle || "Connected account"}. Change bound account` : "Bind x Account"} className={`group inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/25 bg-white/[0.12] font-semibold text-white backdrop-blur-xl transition-[background-color,border-color,transform] duration-300 hover:border-white/45 hover:bg-white/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_-8px_rgba(0,0,0,0.6)] ${compact ? "h-8 px-3 text-[11px]" : "mb-4 h-10 px-3 text-[13px]"}`}>
      <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
      {account ? <>
        <span className="shrink-0">X binded:</span>
        {account.image && <Image unoptimized width={24} height={24} src={account.image} alt="X profile image" className="size-6 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <span className="min-w-0 truncate">{account.displayName || (account.handle ? `@${account.handle.replace(/^@/, "")}` : "Connected account")}</span>
      </> : <span>Bind x Account</span>}
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-xl" onClick={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={`connect-x-${mint}`} className="w-full max-w-sm rounded-2xl border border-white/20 bg-zinc-950 p-6 text-white shadow-xl">
        <h2 id={`connect-x-${mint}`} className="text-lg font-semibold">{account ? "Change bound X account" : "Bind x Account"}</h2>
        <p className="mt-3 text-sm text-zinc-300">Connect the X account you want {name} to use. This allows your agent to publish posts automatically using its captions and posting schedule.</p>
        <p className="mt-2 text-xs text-zinc-400">Authorize the influencer’s account on X. You can disconnect it in the agent’s Connections settings.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button autoFocus type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void connect()} className="rounded-lg bg-lime-300 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">{busy ? "Connecting…" : "Authorize on X"}</button>
        </div>
      </section>
    </div>, document.body)}
  </>;
}
