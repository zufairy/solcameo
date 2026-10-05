"use client";

/* Join-with-agent sheet for a Stage campaign. Lists the operator's agents that
   can work THIS campaign (AI Clippers for clipping campaigns, AI Influencers for
   UGC ones), lets them pick one or more, and joins each for real through the
   owner-gated /api/agents/work/membership route — a clipper starts clipping the
   campaign's sources immediately, an influencer queues its first campaign video. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, CheckCircle2, Loader2, Plus, Scissors, Sparkles, X, AlertCircle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { unionWalletAddresses } from "@/lib/solana/activeWallet";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { ConnectedPlatformStack } from "@/components/social/platform-icons";
import type { Campaign } from "@/lib/types";

type AgentRow = { mintAddress: string; name: string; handle?: string; avatarUrl?: string; agentType?: string; connectedPlatforms?: string[] };
type Result = { ok: boolean; text: string };

const SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;

export function JoinCampaignDialog({ campaign, campaignId, open, onClose }: {
  campaign: Campaign;
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const isClipping = (campaign as { category?: string }).category === "clipping";
  const kind = isClipping ? "AI Clipper" : "AI Influencer";
  const { authenticated, login, profile } = useSupabaseAuth();
  const wallets = useMemo(() => unionWalletAddresses(profile?.walletAddresses, null), [profile?.walletAddresses]);
  const mine = useQuery(api.influencers.listByCreators, wallets.length ? { creatorWallets: wallets } : "skip") as AgentRow[] | undefined;
  const agents = useMemo(
    () => (mine ?? []).filter((a) => (a.agentType === "clipping") === isClipping),
    [mine, isClipping],
  );

  // Which of these agents already work this campaign.
  const membershipQueries = useMemo(() => Object.fromEntries(
    agents.map((a) => [a.mintAddress, { query: api.campaignMemberships.listByMint, args: { mintAddress: a.mintAddress } }]),
  ), [agents]);
  const memberships = useQueries(membershipQueries) as Record<string, Array<{ key: string; status: string }> | undefined | Error>;
  const joinedSet = useMemo(() => {
    const s = new Set<string>();
    for (const [mint, rows] of Object.entries(memberships)) {
      if (Array.isArray(rows) && rows.some((r) => r.key === campaignId && r.status === "active")) s.add(mint);
    }
    return s;
  }, [memberships, campaignId]);

  const accepted = campaign.platforms?.length ? campaign.platforms : ["tiktok", "instagram", "youtube"];
  const canPost = (a: AgentRow) => (a.connectedPlatforms ?? []).some((p) => accepted.includes(p));

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const toggle = (mint: string) => setPicked((p) => { const n = new Set(p); if (n.has(mint)) n.delete(mint); else n.add(mint); return n; });

  const join = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    for (const mint of picked) {
      const a = agents.find((x) => x.mintAddress === mint);
      let res: Result;
      try {
        const r = await fetch("/api/agents/work/membership", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mintAddress: mint, campaignId, rail: "onchain", title: campaign.title, action: "join" }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; clipping?: { started: boolean; reason?: string }; video?: { started: boolean } };
        if (!r.ok || j.ok === false) res = { ok: false, text: j.error || `Couldn't join (HTTP ${r.status})` };
        else if (j.clipping) res = { ok: true, text: j.clipping.started ? "Joined · clipping started" : `Joined · ${j.clipping.reason ?? "clips on the next cycle"}` };
        else if (j.video?.started) res = { ok: true, text: "Joined · first video queued" };
        else res = { ok: true, text: "Joined" };
      } catch (e) {
        res = { ok: false, text: e instanceof Error ? e.message : `${a?.name ?? "Agent"} failed to join` };
      }
      setResults((prev) => ({ ...prev, [mint]: res }));
    }
    setPicked(new Set());
    setBusy(false);
  };

  const createHref = isClipping
    ? `/builder?type=clipping&q=${encodeURIComponent(`Clip the "${campaign.title}" campaign`)}`
    : `/builder?type=influencer&q=${encodeURIComponent(campaign.title)}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-0 backdrop-blur-md sm:items-center sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
          role="dialog" aria-modal="true" aria-label={`Join ${campaign.title}`}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 24, scale: 0.97, filter: "blur(6px)" }}
            transition={SPRING}
            className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-white/10 bg-[#0d0d11]/95 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl sm:rounded-[1.75rem]"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/50 to-transparent" />
            <div className="flex items-start gap-3 px-6 pb-4 pt-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                {isClipping ? <Scissors className="size-5" /> : <Sparkles className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold tracking-tight text-white">Join with your agents</h2>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-400">
                  {isClipping
                    ? "Pick the AI Clippers that should clip this campaign's videos, post them and earn on every verified view."
                    : "Pick the AI Influencers that should create original videos for this campaign and earn on every verified post."}
                </p>
              </div>
              <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40">
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              {!authenticated ? (
                <div className="px-2 py-10 text-center">
                  <Bot className="mx-auto mb-3 size-9 text-zinc-600" />
                  <p className="text-sm text-zinc-300">Sign in to join with your agents.</p>
                  <button type="button" onClick={login} className="mt-4 rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black">Sign in</button>
                </div>
              ) : mine === undefined ? (
                <div className="space-y-2 px-2 py-2">
                  {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />)}
                </div>
              ) : agents.length === 0 ? (
                <div className="px-2 py-10 text-center">
                  <Bot className="mx-auto mb-3 size-9 text-zinc-600" />
                  <p className="text-sm text-zinc-300">You don&apos;t have an {kind} yet.</p>
                  <p className="mt-1 text-[12px] text-zinc-500">{isClipping ? "Clipping campaigns are worked by AI Clippers." : "UGC campaigns are worked by AI Influencers."}</p>
                  <Link href={createHref} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-400">
                    <Plus className="size-3.5" /> Create an {kind}
                  </Link>
                </div>
              ) : (
                <motion.ul className="space-y-2 px-2 py-2" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
                  {agents.map((a) => {
                    const joined = joinedSet.has(a.mintAddress);
                    const selected = picked.has(a.mintAddress);
                    const res = results[a.mintAddress];
                    const posting = canPost(a);
                    return (
                      <motion.li key={a.mintAddress} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: SPRING } }}>
                        <button
                          type="button"
                          disabled={joined || busy}
                          onClick={() => toggle(a.mintAddress)}
                          aria-pressed={selected}
                          className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all ${
                            selected ? "border-emerald-400/50 bg-emerald-400/[0.08] shadow-[0_0_0_1px_rgba(52,211,153,0.2)]"
                              : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]"
                          } disabled:cursor-default`}
                        >
                          <AgentAvatar url={a.avatarUrl} name={a.name} seed={a.mintAddress} className="size-10 shrink-0 rounded-full ring-1 ring-white/10" initialClassName="text-sm" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-white">{a.name}</span>
                              {!!a.connectedPlatforms?.length && <ConnectedPlatformStack platforms={a.connectedPlatforms} badgeClassName="size-4" ringClassName="ring-[#0d0d11]" />}
                            </span>
                            <span className="mt-0.5 block truncate text-[11.5px]">
                              {res ? (
                                <span className={res.ok ? "text-emerald-300" : "text-red-300"}>{res.text}</span>
                              ) : joined ? (
                                <span className="text-emerald-300/80">Already working this campaign</span>
                              ) : posting ? (
                                <span className="text-zinc-500">{a.handle ? `@${a.handle} · ` : ""}ready to post</span>
                              ) : (
                                <span className="text-amber-300/80">No accepted social account connected yet</span>
                              )}
                            </span>
                          </span>
                          {joined ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-300"><CheckCircle2 className="size-3" /> Joined</span>
                          ) : (
                            <span className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${selected ? "border-emerald-400 bg-emerald-400 text-black" : "border-white/20"}`}>
                              {selected && <Check className="size-3.5" strokeWidth={3} />}
                            </span>
                          )}
                        </button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              )}
            </div>

            {authenticated && agents.length > 0 && (
              <div className="flex items-center gap-3 border-t border-white/[0.06] px-6 py-4">
                {Object.values(results).some((r) => !r.ok) && (
                  <span className="flex items-center gap-1 text-[11.5px] text-red-300"><AlertCircle className="size-3.5" /> Some agents couldn&apos;t join</span>
                )}
                <Link href={createHref} className="text-[12px] text-zinc-500 hover:text-zinc-300">+ New {kind}</Link>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={join}
                  disabled={!picked.size || busy}
                  className="ml-auto inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-emerald-400 disabled:opacity-40"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  {busy ? "Joining…" : picked.size ? `Join with ${picked.size} agent${picked.size === 1 ? "" : "s"}` : "Select agents"}
                </motion.button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
