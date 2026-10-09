"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Megaphone, RefreshCw, Send, Link2, CheckCircle2, AlertCircle, Radio, Coins } from "lucide-react";
import { motion } from "framer-motion";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { compatiblePlatforms } from "@/lib/contentPlatforms";
import { ContentTemplates, type TemplateUse } from "@/components/admin/content-templates";

type Agent = { mintAddress: string; name: string; avatarUrl: string; handle: string; niche?: string; language?: string };
type Post = { _id: string; source: string; agentName?: string; caption: string; mediaUrl?: string; kind: string; platforms: string[]; status: string; error?: string; requestId?: string; createdAt: number; targetMint?: string; result?: string; notBefore?: number; milestoneViews?: number };
type State = { profileError?: string; agents: Agent[]; settings: { targetMint?: string; autoAnnounce?: boolean; autoMilestones?: boolean } | null; posts: Post[]; configured: boolean; connected: Record<string, { handle?: string; displayName?: string; id?: string } | null> };
const field = "w-full rounded-xl border border-white/10 bg-[#121216] px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#d7ff00]/40";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium transition hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed";
export default function ContentControlPage() {
  const { getFreshToken } = useSupabaseAuth();
  const [data, setData] = useState<State | null>(null);
  const [targetMint, setTargetMint] = useState("");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<{ url: string; kind: "photo" | "video" } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search), result = q.get("x_connect");
    if (!result) return;
    const note = result === "ok" ? "X connected. New coins and videos will post from this account." : "", failure = result === "ok" ? "" : q.get("x_message") || "X connection failed";
    q.delete("x_connect"); q.delete("x_message");
    const timer = setTimeout(() => { if (note) setMessage(note); if (failure) setError(failure); }, 0);
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
    return () => clearTimeout(timer);
  }, []);
  const initialized = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const token = await getFreshToken();
    if (!token) throw new Error("Sign in as an admin to continue");
    const res = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Request failed");
    return payload;
  }, [getFreshToken]);
  const refresh = useCallback(async () => {
    const seq = ++request.current;
    try {
      const state: State = await authFetch(`/api/admin/content-control${targetMint ? `?targetMint=${encodeURIComponent(targetMint)}` : ""}`);
      if (seq !== request.current) return;
      if (!initialized.current) {
        initialized.current = true;
        const initialTarget = new URLSearchParams(window.location.search).get("targetMint") || state.settings?.targetMint || "";
        if (initialTarget !== targetMint) { setTargetMint(initialTarget); return; }
      }
      setData(state);
      if (state.profileError) setError(state.profileError);
    } catch (e) { if (seq === request.current) setError(e instanceof Error ? e.message : "Unable to load Content Control"); }
  }, [authFetch, targetMint]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const invalidate = () => { request.current++; };
    return () => { clearTimeout(initial); clearInterval(timer); window.removeEventListener("focus", focus); invalidate(); };
  }, [refresh]);
  async function action(name: string, payload: object) {
    setBusy(name); setError(""); setMessage("");
    try {
      const result = await authFetch("/api/admin/content-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (result.url) { window.location.assign(result.url); return; }
      if (name === "publish") {
        key.current = null; setCaption(""); setMedia(null);
        setMessage(`Queued for ${result.platforms.join(", ")}.${result.skipped.length ? ` ${result.skipped.join(", ")} cannot publish this content type.` : ""}`);
      } else if (name === "digest" || name === "stat") setMessage(result.queued ? (name === "stat" ? "Network stats post queued. It posts within a minute or two." : "New coins roundup queued. It posts within a minute or two.") : result.reason || "Nothing to post.");
      else if (name === "x-disconnect") setMessage("X disconnected.");
      else setMessage(name === "settings" ? "Auto-post destination saved." : "Post queued for another attempt.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(""); }
  }
  const useTemplate = useCallback((t: TemplateUse) => {
    key.current = null; setMedia({ url: t.url, kind: t.kind }); setCaption((c) => c.trim() ? c : t.caption);
    setError(""); setMessage("Template attached as a looping video. Review the caption, then publish.");
    document.getElementById("caption")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  async function upload(selected: File) {
    setBusy("upload"); setError("");
    try {
      const form = new FormData(); form.append("file", selected);
      const result = await authFetch("/api/admin/content-control/upload", { method: "POST", body: form });
      setMedia({ url: result.url, kind: result.kind }); key.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(""); if (file.current) file.current.value = ""; }
  }
  const connected = Object.entries(data?.connected || {}).filter(([, account]) => account);
  const kind = media?.kind || "text";
  const platforms = compatiblePlatforms(connected.map(([id]) => id), kind);
  const savedTarget = data?.settings?.targetMint || "";
  const targetMatches = savedTarget === targetMint;
  const saved = !!data?.settings && targetMatches;
  const selectedAgent = data?.agents.find(a => a.mintAddress === targetMint);
  return (
    <div className="space-y-6">
      <motion.header initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(215,255,0,0.07),rgba(13,13,16,0.92)_45%)] p-6 sm:p-8">
        <motion.div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[#d7ff00]/15 blur-3xl" animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.15, 1] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div aria-hidden className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" initial={{ x: "-150%" }} animate={{ x: "420%" }} transition={{ duration: 3.4, repeat: Infinity, repeatDelay: 2.6, ease: "easeInOut" }} />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div>
            <motion.img src="/brand/solcameo-dark.png" alt="Solcameo" className="h-9 w-auto sm:h-11" initial={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }} />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Content Control</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">Connect X once. Every new coin and every new coin video is posted for you, with an animated card, the $TICKER and a caption written for that influencer.</p>
          </div>
          <button className={button} onClick={() => void refresh()} disabled={!!busy}><RefreshCw className="size-4" /> Refresh</button>
        </div>
      </motion.header>
      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300"><AlertCircle className="size-4 shrink-0" />{error}</div>}
      {message && <div role="status" className="flex items-center gap-2 rounded-xl border border-[#d7ff00]/20 bg-[#d7ff00]/10 p-4 text-sm text-lime-200"><CheckCircle2 className="size-4 shrink-0" />{message}</div>}
      {!data ? <div className="p-12 text-center text-zinc-400"><Loader2 className="mx-auto mb-3 size-5 animate-spin" />Loading Content Control</div> : <>
        {!data.configured && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">Configure X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI and X_TOKEN_ENCRYPTION_KEY on the app server to enable direct X posting.</div>}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-white/10 bg-[#0d0d10] p-6 space-y-5">
            <div className="flex items-center gap-3"><div className="rounded-xl bg-[#d7ff00]/10 p-2.5 text-[#d7ff00]"><Send className="size-5" /></div><div><h2 className="font-semibold">Create a post</h2><p className="text-xs text-zinc-500 mt-1">One post, all compatible connected socials.</p></div></div>
            <div><label htmlFor="posting-account" className="mb-2 block text-xs text-zinc-400">Posting account</label><select id="posting-account" className={field} value={targetMint} disabled={!!busy} onChange={e => { setData(null); setTargetMint(e.target.value); key.current = null; }}><option value="">Solcameo marketing account</option>{data.agents.map(a => <option key={a.mintAddress} value={a.mintAddress}>{a.name} ({a.handle})</option>)}</select></div>
            <div className="flex flex-wrap items-center gap-2">{connected.length ? connected.map(([id, account]) => <span key={id} className="rounded-full border border-[#d7ff00]/20 bg-[#d7ff00]/5 px-3 py-1 text-xs text-lime-200">{id} {account?.handle || account?.displayName || account?.id || "connected"}</span>) : <p className="text-sm text-zinc-500">No socials connected to this account yet.</p>}<button className={`${button} ${data.connected.x ? "" : "bg-white text-black hover:bg-zinc-200"}`} disabled={!!busy} onClick={() => void action("x-connect", { action: "x-connect", targetMint: targetMint || undefined })}>{busy === "x-connect" ? <Loader2 className="size-4 animate-spin" /> : <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>}{data.connected.x ? "Reconnect X" : "Connect X"}</button>{data.connected.x && <button className={button} disabled={!!busy} onClick={() => void action("x-disconnect", { action: "x-disconnect", targetMint: targetMint || undefined })}>Disconnect X</button>}<button className={button} disabled={!!busy || !data.configured} onClick={() => void action("connect", { action: "connect", targetMint: targetMint || undefined })}><Link2 className="size-4" />Other accounts</button></div>
            <div><label htmlFor="caption" className="mb-2 block text-xs text-zinc-400">Caption</label><textarea id="caption" className={`${field} min-h-40 resize-y`} maxLength={5000} value={caption} disabled={!!busy} onChange={e => { setCaption(e.target.value); key.current = null; }} placeholder="something worth sharing. keep it human." /><p className="mt-2 text-xs text-zinc-500">Em dashes are removed. X captions are shortened to fit a single post.</p></div>
            {media && <div className="rounded-xl border border-white/10 p-3">{media.kind === "photo" ? <img src={media.url} alt="Post preview" className="max-h-64 rounded-lg object-contain" /> : <video src={media.url} controls autoPlay loop muted playsInline className="max-h-64 rounded-lg" />}<button className="mt-2 text-xs text-zinc-400 hover:text-white" disabled={!!busy} onClick={() => { setMedia(null); key.current = null; }}>Remove media</button></div>}
            <input ref={file} type="file" accept="image/*,video/mp4" className="hidden" onChange={e => { const selected = e.target.files?.[0]; if (selected) void upload(selected); }} />
            <div className="flex flex-wrap items-center justify-between gap-3"><button className={button} disabled={!!busy} onClick={() => file.current?.click()}><ImagePlus className="size-4" />{busy === "upload" ? "Uploading..." : "Upload image or video"}</button><button className={`${button} bg-[#d7ff00] text-black hover:bg-[#e4ff59]`} disabled={!!busy || !data.configured || !caption.trim() || !platforms.length} onClick={() => { key.current ||= crypto.randomUUID(); void action("publish", { action: "publish", targetMint: targetMint || undefined, caption, mediaUrl: media?.url, kind, key: key.current }); }}>{busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}Publish to {platforms.length} socials</button></div>
            <p className="text-xs text-zinc-500">{platforms.length ? `Will publish to ${platforms.join(", ")}.` : "Connect an account that supports this content type to publish."} {connected.some(([id]) => !platforms.includes(id)) && "Some connected platforms need an image or video and will be skipped."}</p>
          </section>
          <aside className="rounded-2xl border border-white/10 bg-[#0d0d10] p-6 space-y-5 h-fit">
            <div className="flex items-center gap-2"><Radio className="size-5 text-[#d7ff00]" /><h2 className="font-semibold">Automatic posting</h2></div>
            <p className="text-sm leading-relaxed text-zinc-400">Always on. Whenever a coin is minted or one of its influencers makes a new video, it is posted to the destination&apos;s X account through the X API. Nothing to switch on.</p>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm">
              <span className="inline-flex items-center gap-2 text-[#d7ff00]"><span className="size-2 animate-pulse rounded-full bg-[#d7ff00]" />Always on</span>
              <p className="mt-2 text-xs text-zinc-500">Posting to: {data.agents.find(a => a.mintAddress === savedTarget)?.name || "Solcameo marketing account"}</p>
            </div>
            <p className="text-xs text-zinc-500">Selected account: {selectedAgent?.name || "Solcameo marketing account"} · {data.connected.x ? "X connected" : "X not connected yet"}. {data.connected.x ? "" : "Connect X below, posts wait in the queue and publish on their own once it is."}</p>
            <button className={`${button} w-full ${saved ? "" : "bg-[#d7ff00] text-black hover:bg-[#e4ff59]"}`} disabled={!!busy || !data.configured || !data.connected.x || saved} onClick={() => void action("settings", { action: "settings", targetMint: targetMint || undefined, autoAnnounce: true, autoMilestones: true })}>{busy === "settings" && <Loader2 className="size-4 animate-spin" />}{saved ? "Auto-posting to this account" : "Use this account for auto-posts"}</button>
            <div className="border-t border-white/10 pt-5 space-y-3">
              <h3 className="font-semibold text-sm">What gets posted</h3>
              <p className="text-xs leading-relaxed text-zinc-400"><span className="text-zinc-200">New coin minted:</span> a caption built around the $TICKER and what the agent does, with an animated 3D card of its image, ticker and coin number.</p>
              <p className="text-xs leading-relaxed text-zinc-400"><span className="text-zinc-200">Network stats, twice a day:</span> at a different time each day, a live card (views, leaderboard, platforms, clip engine or new agents) with a caption built from the real numbers.</p>
              <p className="text-xs leading-relaxed text-zinc-400"><span className="text-zinc-200">Coins roundup:</span> every 6 hours when there were mints, a 3D carousel of the newest coins and the 24 hour count.</p>
              <button className={`${button} w-full`} disabled={!!busy || !data.connected.x} onClick={() => void action("digest", { action: "digest" })}>{busy === "digest" ? <Loader2 className="size-4 animate-spin" /> : <Coins className="size-4" />}Queue a coins roundup now</button>
              <button className={`${button} w-full`} disabled={!!busy || !data.connected.x} onClick={() => void action("stat", { action: "stat" })}>{busy === "stat" ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}Post a network stats card now</button>
              <p className="text-xs leading-relaxed text-zinc-400"><span className="text-zinc-200">New agent minted:</span> the Agent Launch card with the pixel profile image and a short introduction.</p>
              <p className="text-xs leading-relaxed text-zinc-400"><span className="text-zinc-200">New coin video:</span> the video itself, with a caption that names the influencer and the $TICKER and links to its market.</p>
              <p className="text-xs leading-relaxed text-zinc-400"><span className="text-zinc-200">Video over 100,000 views:</span> a milestone card from live view analytics. One post per video.</p>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">Applies to future coins and videos. Editing an existing agent does not trigger another post.</p>
          </aside>
        </div>
        <ContentTemplates agents={data.agents} targetMint={targetMint} xConnected={!!data.connected.x} getToken={getFreshToken} onUse={useTemplate} onPosted={(m) => { setError(""); setMessage(m); void refresh(); }} />
        <section className="rounded-2xl border border-white/10 bg-[#0d0d10] overflow-hidden"><div className="border-b border-white/5 p-5"><h2 className="font-semibold">Publishing activity</h2><p className="mt-1 text-xs text-zinc-500">Latest 100 posts. Accepted uploads are confirmed in the background.</p></div>{!data.posts.length ? <p className="p-10 text-center text-sm text-zinc-500">Your published posts and agent announcements will appear here.</p> : <div className="divide-y divide-white/5">{data.posts.map(post => <div key={post._id} className="flex gap-4 p-5">{post.mediaUrl && post.kind === "photo" && <img src={post.mediaUrl} alt="" className="size-14 shrink-0 rounded-xl object-cover" />}{post.mediaUrl && post.kind === "video" && <video src={post.mediaUrl} muted loop autoPlay playsInline className="size-14 shrink-0 rounded-xl object-cover" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 ${post.status === "posted" ? "bg-[#d7ff00]/10 text-[#d7ff00]" : post.status === "failed" ? "bg-red-500/10 text-red-300" : "bg-white/5 text-zinc-400"}`}>{post.status}</span><span className="text-zinc-500">{post.source === "video" ? `New coin video${post.agentName ? `: ${post.agentName}` : ""}` : post.source === "milestone" ? `100k video milestone: ${post.agentName || "agent"}` : post.source === "mint" ? `Agent launch${post.agentName ? `: ${post.agentName}` : ""}` : post.source === "token" ? `New coin${post.agentName ? `: ${post.agentName}` : ""}` : post.source === "digest" ? "New coins roundup" : post.source === "stat" ? "Network stats" : "Manual post"} · {post.platforms.join(", ")} · {new Date(post.createdAt).toLocaleString()}</span></div><p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{post.caption}</p>{post.notBefore && post.notBefore > Date.now() && post.status === "queued" ? <p className="mt-2 text-xs text-amber-300">Scheduled: next slot {new Date(post.notBefore).toLocaleString()}</p> : post.error && <p className="mt-2 text-xs text-red-300">{post.error}</p>}{post.requestId && <p className="mt-2 break-all text-xs text-zinc-500">Upload: {post.requestId}</p>}{post.result && <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Provider details</summary><pre className="mt-2 whitespace-pre-wrap break-all">{post.result}</pre></details>}{["failed", "cancelled"].includes(post.status) && <button className={`${button} mt-3`} disabled={!!busy} onClick={() => void action("retry", { action: "retry", id: post._id })}>Retry safely</button>}</div></div>)}</div>}</section>
      </>}
    </div>
  );
}
