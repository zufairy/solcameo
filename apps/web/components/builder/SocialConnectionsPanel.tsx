"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, ExternalLink, AlertCircle, Link2, RefreshCw, Sparkles } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { motion } from "framer-motion";
import { CONNECT_BUTTON_CLASS } from "./connectButton";
import { PlatformBadge } from "@/components/social/platform-icons";

/** Authorization header for the auth-gated /api/social/* routes. */
function authHeaders(token: string | null, json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface PlatformMeta {
  id: string;
  label: string;
}
interface StatusResponse {
  ok: boolean;
  configured?: boolean;
  connected?: Record<string, { displayName?: string; image?: string } | null>;
  platforms?: PlatformMeta[];
  limitReached?: boolean;
  error?: string;
}

const CONNECT_URL_CACHE_MS = 47 * 60 * 60_000;

function connectCacheKey(username: string) {
  return `vello:upload-post-connect:${username}`;
}

function readCachedConnectUrl(username: string): string | null {
  if (typeof window === "undefined" || !username) return null;
  try {
    const raw = window.localStorage.getItem(connectCacheKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: unknown; savedAt?: unknown };
    if (typeof parsed.url !== "string" || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > CONNECT_URL_CACHE_MS) return null;
    return parsed.url;
  } catch {
    return null;
  }
}

function writeCachedConnectUrl(username: string, url: string) {
  if (typeof window === "undefined" || !username || !url) return;
  try {
    window.localStorage.setItem(connectCacheKey(username), JSON.stringify({ url, savedAt: Date.now() }));
  } catch {
    // Best-effort cache only.
  }
}

// Platform brand badges (tints, Simple Icons slugs, inline TikTok/Threads logos)
// live in the shared module so the /agents card overlay and this panel stay in
// sync — see components/social/platform-icons.tsx.

interface Props {
  /** upload-post profile id — the agent's mintAddress, or sessionId pre-mint. */
  username: string;
  variant?: "paper" | "dark" | "glass";
  /** glass variant: show exactly these platforms as connect cards (no Add, no Reset). */
  only?: string[];
  /** Optional section title rendered on the same row as the Refresh button. */
  title?: string;
  /** When true, drop the card box + subtitle and flow as bare section elements. */
  bare?: boolean;
  /** When true, hide the header entirely (title + Refresh button + divider line). */
  hideHeader?: boolean;
}

export default function SocialConnectionsPanel({ username, variant = "paper", title, bare = false, hideHeader = false, only }: Props) {
  const isPaper = variant === "paper";
  const isGlass = variant === "glass";
  const { accessToken } = useSupabaseAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activating, setActivating] = useState(false);
  const tiktokAddon = useQuery(api.agentAddons.status, username ? { mintAddress: username, addon: "tiktok" } : "skip");
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashError = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!username) return;
    if (!accessToken) { setError("Sign in to manage connections."); setLoading(false); return; }
    try {
      const res = await fetch(`/api/social/status?username=${encodeURIComponent(username)}`, { headers: authHeaders(accessToken) });
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setError(data.ok ? flashError.current : data.error ?? "Failed to load status");
    } catch {
      setError("Couldn't reach the social status endpoint.");
    } finally {
      setLoading(false);
    }
  }, [username, accessToken]);

  useEffect(() => {
    // Outcome of the X redirect flow (see /api/social/x/callback).
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("x_connect");
    if (outcome) {
      if (outcome === "error") { flashError.current = params.get("x_message") || "X connection failed."; setError(flashError.current); }
      params.delete("x_connect");
      params.delete("x_message");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  useEffect(() => {
    if (!retryAt) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRetrySeconds(seconds);
      if (seconds === 0) setRetryAt(null);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  // After a connect popup opens, poll for ~2 min so the chip flips automatically.
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = setInterval(() => {
      ticks += 1;
      void refresh();
      if (ticks >= 30 && pollRef.current) clearInterval(pollRef.current); // 30 × 4s = 2 min
    }, 4000);
  }, [refresh]);

  const handleConnect = useCallback(async (platformId: string) => {
    if (platformId === "x" && !window.confirm("Allow this agent to publish posts to your X account, including automatic posts on schedules you enable? Disconnect the account in agent settings to stop access.")) return;
    setConnecting(platformId);
    setError(null);
    const openUrl = (url: string) => {
      if (platformId !== "x") writeCachedConnectUrl(username, url);
      if (popup && !popup.closed) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      startPolling();
    };
    // Open the popup SYNCHRONOUSLY inside the click handler so the browser keeps
    // it as a user-gesture window (opening after `await fetch` gets popup-blocked,
    // which is why Connect appeared to "do nothing"). We point it at a loading
    // page first, then redirect it to the upload-post URL once we have it.
    let popup: Window | null = null;
    // X consent is a full-page redirect: its "I trust this app" step does not work
    // reliably inside a small popup, and the callback returns the user here.
    if (typeof window !== "undefined" && platformId !== "x") {
      popup = window.open("", `uploadpost-connect-${platformId}`, "width=560,height=780");
      if (popup) {
        popup.document.write(
          '<!doctype html><meta charset="utf-8"><title>Connecting…</title>' +
          '<body style="font-family:system-ui;margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0c0f14;color:#9aa4b2">Opening secure connect…</body>',
        );
      }
    }
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await fetch(platformId === "x" ? "/api/social/x/connect" : "/api/social/connect", {
          method: "POST",
          headers: authHeaders(accessToken, true),
          body: JSON.stringify({
            username,
            platforms: [platformId],
            ...(platformId === "x" ? { allowAutomatedPosting: true } : {}),
            // Per the upload-post guide: send a redirect target for the "Return" button.
            redirectUrl: typeof window !== "undefined" ? window.location.href : undefined,
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          url?: string;
          configured?: boolean;
          rateLimited?: boolean;
          retryAfterSeconds?: number;
          error?: string;
        };
        if (data.configured === false) { setError(data.error ?? "Not configured."); popup?.close(); return; }
        if (data.ok && data.url) {
          if (platformId === "x") { window.location.assign(data.url); return; }
          openUrl(data.url);
          return;
        }
        if (data.rateLimited) {
          const cached = readCachedConnectUrl(username);
          if (cached) { openUrl(cached); return; }
          const wait = Math.max(1, data.retryAfterSeconds ?? (Number(res.headers.get("retry-after")) || 30));
          setRetryAt(Date.now() + wait * 1000);
          setRetrySeconds(wait);
          setError(`Preparing the secure connect link. Retrying automatically in ${wait}s.`);
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, wait * 1000 + 350));
            continue;
          }
          setError("Upload-Post is still rate limiting connect links. This usually clears in a minute; try Connect again.");
          popup?.close();
          return;
        }
        setError(data.error ?? "Could not start the connect flow.");
        popup?.close();
        return;
      }
    } catch {
      setError("Connect request failed.");
      popup?.close();
    } finally {
      setConnecting(null);
    }
  }, [username, startPolling, accessToken]);

  // TikTok posting is a $10 USD per month add-on, paid through Stripe checkout.
  const activateTiktok = useCallback(async () => {
    if (!accessToken) { setError("Sign in to activate TikTok."); return; }
    setActivating(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: authHeaders(accessToken, true),
        body: JSON.stringify({ addon: "tiktok", mintAddress: username, returnPath: `${window.location.pathname}${window.location.search}` }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(res.status === 401 ? "Sign in with your wallet to pay for TikTok." : data.error ?? "Could not start checkout.");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setActivating(false);
    }
  }, [accessToken, username]);

  // Re-read connection status, e.g. after finishing the connect flow in another tab.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);

  const theme = isPaper
    ? { card: "duo-card", title: "text-zinc-900", muted: "text-zinc-500", row: "border-zinc-200/70" }
    : { card: "duo-card duo-card-dark", title: "text-white", muted: "text-zinc-400", row: "border-white/[0.06]" };

  // LinkedIn / Pinterest / Bluesky intentionally hidden from the connect list
  // (not clip targets — keeps the list to the platforms that matter).
  // Only X and TikTok are offered for now; upload-post is not used.
  const platforms: PlatformMeta[] = [{ id: "x", label: "X" }, { id: "tiktok", label: "TikTok" }];
  const connected = status?.connected ?? {};
  const notConfigured = status?.configured === false;
  const limitReached = status?.limitReached === true;

  if (isGlass) {
    const ids = only && only.length ? only : ["tiktok", "youtube"];
    const labelOf = (id: string) => platforms.find((p) => p.id === id)?.label ?? (id === "tiktok" ? "TikTok" : id === "youtube" ? "YouTube" : id);
    return (
      <div className="flex flex-col gap-2" style={{ fontFamily: "var(--font-inter)" }}>
        {ids.map((id, i) => {
          const acct = connected[id];
          const isConnected = Boolean(acct);
          const busy = connecting === id;
          return (
            <motion.div
              key={id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.05 * i }}
              className={`relative flex items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-colors duration-300 ${
                isConnected ? "border-white/25 bg-white/[0.10]" : "border-white/[0.10] bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]"
              }`}
            >
              <PlatformBadge id={id} label={labelOf(id)} className="size-9 text-[12px] ring-1 ring-white/20 shadow-[0_4px_14px_rgba(0,0,0,0.35)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold leading-tight text-white">{labelOf(id)}</span>
                <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-white/45">
                  {isConnected && <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />}
                  <span className="truncate">{isConnected ? (acct?.displayName ? `@${acct.displayName.replace(/^@/, "")}` : "Connected") : "Not connected"}</span>
                </span>
              </span>
              {loading && !status ? (
                <span className="h-8 w-20 animate-pulse rounded-full bg-white/[0.06]" />
              ) : isConnected ? (
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  aria-label="Refresh connection status"
                  title="Refresh connection status"
                  className="grid size-8 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-white/70 transition-all hover:border-white/30 hover:bg-white/[0.14] hover:text-white active:scale-95 disabled:opacity-60"
                >
                  <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={notConfigured || busy}
                  onClick={() => handleConnect(id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/25 bg-gradient-to-b from-white/[0.22] to-white/[0.08] px-3.5 text-[12px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl transition-all hover:from-white/[0.3] hover:to-white/[0.12] active:scale-[0.96] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : null}
                  {busy && retrySeconds > 0 ? `Retry ${retrySeconds}s` : busy ? "Opening…" : "Connect"}
                </button>
              )}
            </motion.div>
          );
        })}
        {notConfigured && <p className="px-1 text-[11.5px] leading-snug text-amber-300/90">Social posting isn&apos;t configured on this server yet.</p>}
        {limitReached && !notConfigured && <p className="px-1 text-[11.5px] leading-snug text-amber-300/90">Your upload-post plan&apos;s profile limit is reached. Upgrade it to connect this agent.</p>}
        {error && <p role="alert" className="px-1 text-[11.5px] text-rose-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className={bare ? "" : `overflow-hidden ${theme.card}`} style={{ fontFamily: "var(--font-inter)" }}>
      {/* Header, title (left) + refresh (right) on one row. Skipped entirely
          when hideHeader (no title, no Refresh button, no divider line). */}
      {hideHeader ? null : bare ? (
        <div className="mb-1">
          <div className="flex items-center justify-between gap-3">
            {title
              ? <h2 className="font-sans text-[20px] font-bold text-white leading-none tracking-tight">{title}</h2>
              : <span />}
          </div>

        </div>
      ) : (
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${theme.row}`}>
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-700">
              <Link2 className="size-3.5" strokeWidth={2.4} />
            </div>
            <div>
              <h2 className={`text-[14px] font-bold tracking-tight ${theme.title}`}>Connections</h2>
              <p className={`text-[10.5px] ${theme.muted}`}>Link socials so your agent can post</p>
            </div>
          </div>
        </div>
      )}

      {/* Not configured notice */}
      {notConfigured && (
        <div className={`mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 ${bare ? "" : "mx-5"}`}>
          <AlertCircle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-amber-800 leading-snug">
            Social connections are not configured yet. Ask the app administrator to enable X OAuth, then refresh.
          </p>
        </div>
      )}

      {/* Profile limit notice, per-agent profiles need a plan that allows them */}
      {limitReached && !notConfigured && (
        <div className={`mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 ${bare ? "" : "mx-5"}`}>
          <AlertCircle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-amber-800 leading-snug">
            Your upload-post plan&apos;s profile limit is reached. Each agent gets its own connected accounts -{" "}
            <a href="https://app.upload-post.com/billing" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
              upgrade your plan <ExternalLink className="size-2.5" />
            </a>{" "}
            to connect this agent.
          </p>
        </div>
      )}

      {/* X and TikTok only. TikTok needs the $10/month add-on before it can connect. */}
      <div className={`py-3 flex flex-col gap-1.5 ${bare ? "" : "px-5"}`}>
        {platforms.map((p) => {
          const acct = connected[p.id];
          const isConnected = Boolean(acct);
          const needsPayment = p.id === "tiktok" && !isConnected && tiktokAddon !== undefined && !tiktokAddon.active;
          const btn = CONNECT_BUTTON_CLASS;
          return (
            <div key={p.id} className={`flex items-center justify-between py-1.5 ${theme.title}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <PlatformBadge id={p.id} label={p.label} />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold leading-tight truncate">{p.label}</p>
                  {isConnected && acct?.displayName ? (
                    <p className={`text-[10px] ${theme.muted} truncate`}>{acct.displayName}</p>
                  ) : p.id === "tiktok" && tiktokAddon?.active ? (
                    <p className={`text-[10px] ${theme.muted} truncate`}>Active until {new Date(tiktokAddon.activeUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                  ) : needsPayment ? (
                    <p className={`text-[10px] ${theme.muted} truncate`}>$10 USD per month</p>
                  ) : null}
                </div>
              </div>
              {isConnected ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-[3px] bg-gradient-to-b from-white to-zinc-300 px-2.5 py-1 text-[11px] font-semibold text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
                    <Check className="size-3" strokeWidth={3} /> Connected
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={refreshing}
                    aria-label="Refresh connection status"
                    title="Refresh connection status"
                    className="inline-flex size-[26px] items-center justify-center rounded-[3px] bg-gradient-to-b from-white to-zinc-300 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] transition-transform hover:brightness-95 active:scale-95 disabled:opacity-60"
                  >
                    <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} strokeWidth={2.5} />
                  </button>
                </span>
              ) : needsPayment ? (
                <button type="button" disabled={activating} onClick={() => void activateTiktok()} className={btn}>
                  {activating ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {activating ? "Opening…" : "Activate $10/mo"}
                </button>
              ) : (
                <button type="button" disabled={notConfigured || connecting === p.id} onClick={() => handleConnect(p.id)} className={btn}>
                  {connecting === p.id ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
                  {connecting === p.id && retrySeconds > 0 ? `Retrying ${retrySeconds}s` : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className={`pb-3 text-[11px] text-rose-600 ${bare ? "" : "px-5"}`}>{error}</p>
      )}

    </div>
  );
}
