"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, ExternalLink, Plus, AlertCircle, Link2, RotateCcw } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { motion } from "framer-motion";
import { PlatformBadge } from "@/components/social/platform-icons";
import { PixelIcon, hasPixelIcon } from "@/components/builder/onboarding/pixel-icons";

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
  const [resetting, setResetting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!username) return;
    if (!accessToken) { setError("Sign in to manage connections."); setLoading(false); return; }
    try {
      const res = await fetch(`/api/social/status?username=${encodeURIComponent(username)}`, { headers: authHeaders(accessToken) });
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setError(data.ok ? null : data.error ?? "Failed to load status");
    } catch {
      setError("Couldn't reach the social status endpoint.");
    } finally {
      setLoading(false);
    }
  }, [username, accessToken]);

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
    if (typeof window !== "undefined") {
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
        if (data.ok && data.url) { openUrl(data.url); return; }
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

  // Disconnect EVERY connected account in one shot. upload-post has no per-account
  // disconnect API, so this deletes the agent's profile (clearing all links); the
  // profile is re-provisioned automatically on the next status load.
  const handleResetAll = useCallback(async () => {
    if (!accessToken) { setError("Sign in to manage connections."); return; }
    if (typeof window !== "undefined" &&
        !window.confirm("Disconnect ALL connected social accounts for this agent? You'll need to reconnect each one.")) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/social/disconnect-all", {
        method: "POST",
        headers: authHeaders(accessToken, true),
        body: JSON.stringify({ username }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? "Reset failed."); return; }
      await refresh();
    } catch {
      setError("Reset request failed.");
    } finally {
      setResetting(false);
    }
  }, [accessToken, username, refresh]);

  const theme = isPaper
    ? { card: "duo-card", title: "text-zinc-900", muted: "text-zinc-500", row: "border-zinc-200/70" }
    : { card: "duo-card duo-card-dark", title: "text-white", muted: "text-zinc-400", row: "border-white/[0.06]" };

  // LinkedIn / Pinterest / Bluesky intentionally hidden from the connect list
  // (not clip targets — keeps the list to the platforms that matter).
  const HIDDEN_PLATFORMS = new Set(["linkedin", "pinterest", "bluesky"]);
  const platforms = (status?.platforms ?? []).filter((p) => !HIDDEN_PLATFORMS.has(p.id));
  const connected = status?.connected ?? {};
  const notConfigured = status?.configured === false;
  const limitReached = status?.limitReached === true;
  const anyConnected = Object.values(connected).some(Boolean);

  // "+ Add" reveals the not-yet-connected platforms (the list itself shows only
  // connected accounts by default). Status still auto-refreshes on mount/focus.
  const addBtn = (
    <button
      type="button"
      onClick={() => setShowAdd((v) => !v)}
      className="duo-btn duo-btn-white duo-btn-xs"
      title="Connect another account"
    >
      {loading ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add
    </button>
  );

  if (isGlass) {
    const ids = only && only.length ? only : ["tiktok", "youtube"];
    const labelOf = (id: string) => platforms.find((p) => p.id === id)?.label ?? (id === "tiktok" ? "TikTok" : id === "youtube" ? "YouTube" : id);
    return (
      <div className="flex flex-col gap-2.5" style={{ fontFamily: "var(--font-inter)" }}>
        {ids.map((id, i) => {
          const acct = connected[id];
          const isConnected = Boolean(acct);
          const busy = connecting === id;
          return (
            <motion.div
              key={id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.06 * i }}
              className={`relative flex items-center gap-3.5 overflow-hidden rounded-2xl border px-4 py-3.5 backdrop-blur-xl transition-colors duration-300 ${
                isConnected ? "border-lime-300/35 bg-lime-300/[0.07]" : "border-white/[0.09] bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]"
              }`}
            >
              <span className={`relative grid size-12 shrink-0 place-items-center rounded-xl border backdrop-blur transition-colors duration-300 ${isConnected ? "border-lime-300/40 bg-lime-300/15 text-lime-200" : "border-white/10 bg-white/[0.05] text-white/85"}`}>
                {hasPixelIcon(id) ? <PixelIcon id={id} className="size-7" twinkle={isConnected} /> : <PlatformBadge id={id} label={labelOf(id)} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold leading-tight text-white">{labelOf(id)}</span>
                <span className={`mt-0.5 block truncate text-[12px] ${isConnected ? "text-lime-200/80" : "text-white/40"}`}>
                  {isConnected ? (acct?.displayName ? `@${acct.displayName.replace(/^@/, "")}` : "Connected") : "Not connected"}
                </span>
              </span>
              {loading && !status ? (
                <span className="h-9 w-24 animate-pulse rounded-full bg-white/[0.06]" />
              ) : isConnected ? (
                <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 18 }} className="grid size-9 place-items-center rounded-full bg-lime-300 text-[#11180d]">
                  <Check className="size-4" strokeWidth={3} />
                </motion.span>
              ) : (
                <button
                  type="button"
                  disabled={notConfigured || busy}
                  onClick={() => handleConnect(id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[12.5px] font-semibold text-[#0b0d0a] transition-all hover:bg-lime-200 active:scale-[0.96] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {busy && retrySeconds > 0 ? `Retry ${retrySeconds}s` : busy ? "Opening…" : "Connect"}
                </button>
              )}
            </motion.div>
          );
        })}
        {notConfigured && <p className="px-1 text-[12px] leading-snug text-amber-300/90">Social posting isn&apos;t configured on this server yet.</p>}
        {limitReached && !notConfigured && <p className="px-1 text-[12px] leading-snug text-amber-300/90">Your upload-post plan&apos;s profile limit is reached. Upgrade it to connect this agent.</p>}
        {error && <p role="alert" className="px-1 text-[12px] text-rose-300">{error}</p>}
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
            {addBtn}
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
          {addBtn}
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

      {/* Platform list, connected accounts only; "+ Add" reveals the rest so a
          new one can be connected. */}
      <div className={`py-3 flex flex-col gap-1.5 ${bare ? "" : "px-5"}`}>
        {!anyConnected && !showAdd && !loading && (
          <p className={`text-[11.5px] ${theme.muted} py-2`}>Nothing connected yet.</p>
        )}
        {platforms.filter((p) => p.id === "x" || Boolean(connected[p.id]) || showAdd).map((p) => {
          const acct = connected[p.id];
          const isConnected = Boolean(acct);
          return (
            <div key={p.id} className={`flex items-center justify-between py-1.5 ${theme.title}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <PlatformBadge id={p.id} label={p.label} />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold leading-tight truncate">{p.label}</p>
                  {isConnected && acct?.displayName && (
                    <p className={`text-[10px] ${theme.muted} truncate`}>{acct.displayName}</p>
                  )}
                </div>
              </div>
              {isConnected ? (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold ${isPaper ? "text-emerald-600" : "text-emerald-300"}`}>
                  <Check className="size-3" /> Connected
                </span>
              ) : (
                <button
                  type="button"
                  disabled={notConfigured || connecting === p.id}
                  onClick={() => handleConnect(p.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/[0.12] px-2.5 py-1 text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-colors hover:bg-white/[0.2] disabled:opacity-50"
                >
                  {connecting === p.id ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
                  {connecting === p.id && retrySeconds > 0 ? `Retrying ${retrySeconds}s` : "Connect"}
                </button>
              )}
            </div>
          );
        })}
        {platforms.length === 0 && !loading && showAdd && (
          <p className={`text-[11.5px] ${theme.muted} py-2`}>No platforms available.</p>
        )}

        {/* Inline "Add account", ALWAYS present at the bottom of the list (the
            header's Add button disappears under hideHeader, which left the
            Schedule tab with no way to connect anything). Dashed affordance
            toggles the reveal of the not-yet-connected platforms above. */}
        {!loading && platforms.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/25 bg-white/[0.12] py-2.5 text-[12px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-all hover:bg-white/[0.2] active:scale-[0.98]"
          >
            <Plus className={`size-3.5 transition-transform ${showAdd ? "rotate-45" : ""}`} />
            {showAdd ? "Done" : "Add account"}
          </button>
        )}

        {/* Reset all, disconnects every connected account at once */}
        {anyConnected && !notConfigured && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleResetAll}
              disabled={resetting}
              title="Disconnect all connected accounts for this agent"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-0 bg-red-600 text-white text-[11px] font-semibold outline-none transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {resetting ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
              Reset all connections
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className={`pb-3 text-[11px] text-rose-600 ${bare ? "" : "px-5"}`}>{error}</p>
      )}

    </div>
  );
}
