"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { normalizeClipConfig } from "@/lib/builder/clipConfig";
import { computeScheduleTimes } from "@/lib/builder/dripStagger";
import { browserTimeZone, COMMON_TIMEZONES, zoneOffsetLabel } from "@/lib/builder/timezone";
import { Briefcase, RefreshCw, Loader2, Wallet, ExternalLink, Check, X, Sparkles, ArrowDownToLine, ArrowUpFromLine, Clock, ShieldCheck, Pencil, CalendarClock, Minus, Plus } from "lucide-react";

/* ── Work tab (clipping agents) ─────────────────────────────────────────────
   One surface for the agent's paid work on Stage campaigns:
   - Wallet: live USDC, unsettled tab, safe withdrawable (numbers come from the
     workspace header so both agree), Top up / Withdraw.
   - Cadence: Auto-work on/off, clips per day, daily spend cap.
   - Campaigns: every open campaign the agent evaluated (lib/server/campaignFit)
     with its verdict + reasons; the operator can Join / Leave / hand back.
     ACTIVE rows are the only ones the autonomous loop clips from.
   - Earnings: per-post views → payout → paid, straight from `submissions`
     (the oracle attests views on-chain and the claim keeper pays USDC), plus
     the cost ledger, so the operator sees net. */

export type WorkWallet = {
  onChainBalance: number;
  liveBalance: number;
  unsettledTab: number;
  safeWithdrawable: number;
  spent: number;
  revenue: number;
};

type Membership = {
  _id: string; key: string; campaignId?: string; contentRewardId?: string; rail: string; title: string;
  status: string; decidedBy: string; score?: number; reasons?: string[]; expectedViews?: number; expectedPayoutUsdc?: number;
  netUsdc?: number; ratePerThousandViews?: number; budgetRemainingUsdc?: number; deadlineAt?: number; lastEvaluatedAt: number; joinedAt?: number;
};

type CampaignSummary = {
  _id: string;
  category?: string;
  brandName?: string;
  brief?: string;
  requirements?: string[];
  requiredTag?: string;
  campaignImageUrl?: string;
  contentFileUrls?: string[];
  platforms?: string[];
};

/** Large animated on/off switch with a spinner inside the knob while saving. */
function Switch({ on, busy, onClick, label }: { on: boolean; busy?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} role="switch" aria-checked={on} aria-label={label}
      className={`group relative inline-flex h-8 w-[68px] shrink-0 items-center rounded-full border transition-all duration-300 disabled:cursor-wait ${on ? "border-lime-300/60 bg-lime-400 shadow-[0_0_18px_-4px_rgba(163,230,53,0.7)]" : "border-white/15 bg-white/[0.08] hover:bg-white/[0.12]"}`}>
      <span className={`absolute text-[10px] font-bold uppercase tracking-wide transition-all duration-300 ${on ? "left-2.5 text-black/70" : "right-2.5 text-zinc-400"}`}>{on ? "On" : "Off"}</span>
      <span className={`absolute top-[3px] flex size-6 items-center justify-center rounded-full shadow-md transition-all duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-active:w-7 ${on ? "left-[38px] bg-black" : "left-[3px] bg-white"}`}>
        {busy && <Loader2 className={`size-3.5 animate-spin ${on ? "text-lime-400" : "text-zinc-500"}`} />}
      </span>
    </button>
  );
}

const INTERVAL_PRESETS: { ms: number; label: string }[] = [
  { ms: 30 * 60_000, label: "30m" }, { ms: 60 * 60_000, label: "1h" }, { ms: 2 * 3_600_000, label: "2h" },
  { ms: 3 * 3_600_000, label: "3h" }, { ms: 4 * 3_600_000, label: "4h" }, { ms: 6 * 3_600_000, label: "6h" }, { ms: 12 * 3_600_000, label: "12h" },
];
const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", x: "X", twitter: "X", facebook: "Facebook", linkedin: "LinkedIn", threads: "Threads" };
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtInterval = (ms: number) => ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${+(ms / 3_600_000).toFixed(2)} h`;

type CampaignPosting = { maxPerDay: number; postIntervalMs: number; dailyStartHour?: number; dailyStartMinute: number };
type Schedule = { campaignPosting: CampaignPosting; autoPost: boolean; maxPerDay: number; postIntervalMs: number; startHour: number | null; startMinute: number; timezone: string; platforms: string[] };

const usd = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`;
const ago = (ts?: number) => {
  if (!ts) return "";
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const until = (ts?: number) => {
  if (!ts) return "no deadline";
  const h = Math.round((ts - Date.now()) / 3_600_000);
  return h <= 0 ? "ended" : h < 48 ? `${h}h left` : `${Math.round(h / 24)}d left`;
};

export function WorkTab({ mintAddress, agentType, wallet, onDeposit, onWithdraw }: {
  mintAddress: string;
  agentType: "clipping" | "influencer";
  wallet: WorkWallet;
  onDeposit: () => void;
  onWithdraw: () => void;
}) {
  const { accessToken } = useSupabaseAuth();
  const headers = useMemo(() => ({ "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }), [accessToken]);

  const agent = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { autoClipEnabled?: boolean; clipConfig?: Record<string, unknown>; niche?: string; connectedPlatforms?: string[]; campaignWorkConsent?: { autoJoin: boolean; allowThirdPartySources: boolean; allowProfileCtaCampaigns: boolean; consentedAt: number } } | null | undefined;
  const isClipper = agentType === "clipping";
  const membershipRowsQuery = useQuery(api.campaignMemberships.listByMint, mintAddress ? { mintAddress } : "skip") as Membership[] | undefined;
  const membershipsRaw = useMemo(() => membershipRowsQuery ?? [], [membershipRowsQuery]);
  const campaignRows = useQuery(api.campaigns.list, {}) as CampaignSummary[] | undefined;
  const campaignById = useMemo(() => new Map((campaignRows ?? []).map((campaign) => [String(campaign._id), campaign])), [campaignRows]);
  // Keep each agent's work board distinct even if it has legacy membership
  // rows from before campaign types were separated.
  const memberships = useMemo(() => {
    if (isClipper) return membershipsRaw;
    if (!campaignRows) return [];
    const ugcIds = new Set(campaignRows.filter((campaign) => campaign.category === "ugc").map((campaign) => String(campaign._id)));
    return membershipsRaw.filter((membership) => !!membership.campaignId && ugcIds.has(String(membership.campaignId)));
  }, [isClipper, campaignRows, membershipsRaw]);
  const submissionsRaw = useQuery(api.submissions.listByInfluencer, mintAddress ? { influencerMint: mintAddress } : "skip") as
    { _id: string; status: string; platform?: string; postUrl?: string; viewCount?: number; payoutAmountUsdc?: number; paidUsdc?: number; claimDone?: boolean; attestationTx?: string; payoutTxSignature?: string; postedAt?: number; _creationTime: number; campaign?: { title?: string; ratePerThousandViews?: number } | null }[];
  const submissions = useMemo(() => submissionsRaw ?? [], [submissionsRaw]);
  const payoutEvents = useQuery(api.oracle.payoutEventsByMint, mintAddress ? { mintAddress } : "skip") ?? [];
  const today = useQuery(api.usage.todaysSpendQuery, mintAddress ? { mintAddress } : "skip") as { spentTodayUsdc: number; capUsdc: number } | undefined;

  // ── Cadence ──
  const clipConfigRaw = agent?.clipConfig;
  const clipCfg = useMemo(() => normalizeClipConfig(clipConfigRaw), [clipConfigRaw]);
  const [clipsPerDay, setClipsPerDay] = useState<number | null>(null);
  const [savingCadence, setSavingCadence] = useState(false);
  const [cadenceMsg, setCadenceMsg] = useState<string | null>(null);
  const effectiveClipsPerDay = clipsPerDay ?? clipCfg.clipsPerDay ?? 3;
  const [autoBusy, setAutoBusy] = useState(false);
  // Optimistic toggle keyed to the server value it was made against.
  const [autoOptimistic, setAutoOptimistic] = useState<{ value: boolean; against: boolean } | null>(null);
  const serverAuto = !!agent?.autoClipEnabled;
  const autoOn = autoOptimistic && autoOptimistic.against === serverAuto ? autoOptimistic.value : serverAuto;
  const [consentDraft, setConsentDraft] = useState<{ autoJoin: boolean; allowThirdPartySources: boolean; allowProfileCtaCampaigns: boolean } | null>(null);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  // Terms form is open only when nothing is authorized yet or the operator clicks Edit;
  // it collapses into a summary as soon as a save succeeds.
  const [editingConsent, setEditingConsent] = useState(false);
  const [savedConsent, setSavedConsent] = useState<{ autoJoin: boolean; allowThirdPartySources: boolean; allowProfileCtaCampaigns: boolean; consentedAt: number } | null>(null);
  const [enableAfterConsent, setEnableAfterConsent] = useState(false);
  const consentRef = useRef<HTMLElement | null>(null);
  const authorized = agent?.campaignWorkConsent ?? savedConsent;
  const showConsentForm = !authorized || editingConsent;
  const consent = useMemo(() => consentDraft ?? agent?.campaignWorkConsent ?? { autoJoin: false, allowThirdPartySources: false, allowProfileCtaCampaigns: false }, [consentDraft, agent?.campaignWorkConsent]);
  const saveConsent = useCallback(async () => {
    if (!consentAcknowledged || consentSaving) return;
    setConsentSaving(true); setCadenceMsg(null);
    try {
      // If the operator flipped Auto-work on before agreeing, agreeing turns it on.
      const enabled = autoOn || enableAfterConsent;
      const terms = { autoJoin: consent.autoJoin, allowThirdPartySources: consent.allowThirdPartySources, allowProfileCtaCampaigns: consent.allowProfileCtaCampaigns };
      const res = await fetch("/api/agents/config", { method: "POST", headers, body: JSON.stringify({ mintAddress, kind: "autoclip", payload: { enabled, consent: terms } }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Save failed");
      if (enabled !== serverAuto) setAutoOptimistic({ value: enabled, against: serverAuto });
      setSavedConsent({ ...terms, consentedAt: Date.now() });
      setConsentDraft(null); setConsentAcknowledged(false); setEditingConsent(false); setEnableAfterConsent(false);
      setCadenceMsg(enableAfterConsent ? "Terms agreed — Auto-work is on" : "Terms agreed");
    } catch (e) { setCadenceMsg(e instanceof Error ? e.message : "Save failed"); }
    finally { setConsentSaving(false); }
  }, [consentAcknowledged, consentSaving, headers, mintAddress, autoOn, consent, enableAfterConsent, serverAuto]);
  const toggleAuto = useCallback(async () => {
    if (autoBusy) return;
    if (!autoOn && !authorized) {
      // No terms yet: open them and turn Auto-work on once agreed.
      setEnableAfterConsent(true); setEditingConsent(true); setCadenceMsg("Agree to the campaign terms below to turn Auto-work on.");
      requestAnimationFrame(() => consentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    const next = !autoOn;
    setAutoOptimistic({ value: next, against: serverAuto }); setAutoBusy(true);
    try {
      const res = await fetch("/api/agents/config", { method: "POST", headers, body: JSON.stringify({ mintAddress, kind: "autoclip", payload: { enabled: next } }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Save failed");
    } catch (e) { setAutoOptimistic(null); setCadenceMsg(e instanceof Error ? e.message : "Save failed"); }
    finally { setAutoBusy(false); }
  }, [autoBusy, autoOn, serverAuto, headers, mintAddress, authorized]);

  const saveClipsPerDay = useCallback(async (n: number) => {
    setSavingCadence(true); setCadenceMsg(null);
    try {
      const payload = normalizeClipConfig({ ...(clipConfigRaw ?? {}), clipsPerDay: n });
      const res = await fetch("/api/agents/config", { method: "POST", headers, body: JSON.stringify({ mintAddress, kind: "clip", payload }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Save failed");
      setCadenceMsg("Saved");
    } catch (e) { setCadenceMsg(e instanceof Error ? e.message : "Save failed"); }
    finally { setSavingCadence(false); }
  }, [clipConfigRaw, headers, mintAddress]);

  // ── Posting schedule ──
  // Draft over the saved clipConfig; Save merges ONLY these fields into the raw
  // config, so every other clip setting (captions, aspect, hooks...) is kept.
  const serverSched = useMemo<Schedule>(() => ({
    campaignPosting: clipCfg.campaignPosting ?? { maxPerDay: clipCfg.maxPerDay ?? 0, postIntervalMs: clipCfg.postIntervalMs ?? 2 * 3_600_000, dailyStartHour: clipCfg.dailyStartHour, dailyStartMinute: clipCfg.dailyStartMinute ?? 0 },
    autoPost: !!clipCfg.autoPost,
    maxPerDay: clipCfg.maxPerDay ?? 0,
    postIntervalMs: clipCfg.postIntervalMs ?? 2 * 3_600_000,
    startHour: typeof clipCfg.dailyStartHour === "number" ? clipCfg.dailyStartHour : null,
    startMinute: clipCfg.dailyStartMinute ?? 0,
    timezone: clipCfg.timezone || browserTimeZone(),
    platforms: clipCfg.platforms ?? [],
  }), [clipCfg]);
  const [schedDraft, setSchedDraft] = useState<Schedule | null>(null);
  const sched = schedDraft ?? serverSched;
  const queue = useQuery(api.scheduledContent.listByMint, mintAddress ? { mintAddress, limit: 400 } : "skip");
  const campaignQueue = (queue ?? []).filter((row) => row.campaignId && row.status === "scheduled").sort((a, b) => a.scheduledFor - b.scheduledFor);
  const schedDirty = !!schedDraft && JSON.stringify(schedDraft) !== JSON.stringify(serverSched);
  const patchSched = (p: Partial<Schedule>) => { setSchedDraft({ ...sched, ...p }); setSchedMsg(null); };
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);
  const connected = useMemo(() => Array.from(new Set([...(agent?.connectedPlatforms ?? []), ...sched.platforms])), [agent?.connectedPlatforms, sched.platforms]);
  const saveSchedule = useCallback(async () => {
    if (schedSaving || !schedDraft) return;
    setSchedSaving(true); setSchedMsg(null);
    try {
      const payload = normalizeClipConfig({
        ...(clipConfigRaw ?? {}),
        campaignPosting: schedDraft.campaignPosting,
        autoPost: schedDraft.autoPost,
        maxPerDay: schedDraft.maxPerDay,
        postIntervalMs: schedDraft.postIntervalMs,
        dailyStartHour: schedDraft.startHour ?? undefined,
        dailyStartMinute: schedDraft.startHour === null ? undefined : schedDraft.startMinute,
        timezone: schedDraft.timezone,
        platforms: schedDraft.platforms,
      });
      const res = await fetch("/api/agents/config", { method: "POST", headers, body: JSON.stringify({ mintAddress, kind: "clip", payload }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Save failed");
      setSchedDraft(null); setSchedMsg("Schedule saved");
    } catch (e) { setSchedMsg(e instanceof Error ? e.message : "Save failed"); }
    finally { setSchedSaving(false); }
  }, [schedSaving, schedDraft, clipConfigRaw, headers, mintAddress]);
  // Clock for the slot preview, refreshed each minute (render stays pure).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const nextSlots = useMemo(() => computeScheduleTimes(4, {
    intervalMs: sched.postIntervalMs, maxPerDay: sched.maxPerDay, now: nowTick,
    dailyStartHour: sched.startHour ?? undefined, dailyStartMinute: sched.startMinute, timeZone: sched.timezone,
  }), [sched, nowTick]);
  const slotFmt = useMemo(() => {
    try { return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: sched.timezone }); }
    catch { return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }); }
  }, [sched.timezone]);
  const tzOptions = useMemo(() => Array.from(new Set([sched.timezone, browserTimeZone(), ...COMMON_TIMEZONES.map((z) => z.tz)])), [sched.timezone]);

  // ── Campaign decisions ──
  const [evaluating, setEvaluating] = useState(false);
  const [evalMsg, setEvalMsg] = useState<string | null>(null);
  const [evalAgent, setEvalAgent] = useState<{ medianViews?: number; sampleCount?: number; estCostUsdc: number } | null>(null);
  const evaluate = useCallback(async () => {
    setEvaluating(true); setEvalMsg(null);
    try {
      const res = await fetch("/api/agents/work/evaluate", { method: "POST", headers, body: JSON.stringify({ mintAddress }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; results?: { membership: string }[]; agent?: { medianViews?: number; sampleCount?: number; estCostUsdc: number } };
      if (!res.ok || !j.ok) throw new Error(j.error || `Evaluate failed (HTTP ${res.status})`);
      if (j.agent) setEvalAgent(j.agent);
      const active = (j.results ?? []).filter((r) => r.membership === "active").length;
      setEvalMsg(`Evaluated ${j.results?.length ?? 0} campaigns, working ${active}.`);
    } catch (e) { setEvalMsg(e instanceof Error ? e.message : "Evaluate failed"); }
    finally { setEvaluating(false); }
  }, [headers, mintAddress]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const decide = useCallback(async (m: Membership, action: "join" | "leave" | "auto" | "work") => {
    setBusyKey(m.key);
    try {
      const res = await fetch("/api/agents/work/membership", { method: "POST", headers, body: JSON.stringify({ mintAddress, campaignId: m.campaignId, contentRewardId: m.contentRewardId, rail: m.rail, title: m.title, action }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; clipping?: { started: boolean; reason?: string }; video?: { started: boolean; taskId?: string } };
      if (!res.ok) throw new Error(j.error || "Update failed");
      // A clipper that joins starts clipping the campaign's source right away.
      if ((action === "join" || action === "work") && j.clipping) {
        setEvalMsg(j.clipping.started
          ? `Joined "${m.title}" — clipping its source video now. Clips post and submit per your clip settings.`
          : `Joined "${m.title}". ${j.clipping.reason ?? ""}`.trim());
      }
      if ((action === "join" || action === "work") && j.video) {
        setEvalMsg(j.video.started
          ? `Working on "${m.title}" now — creating an original video in this agent's persona, then posting and submitting it to the campaign.`
          : `Joined "${m.title}", but the video could not be started. Please try Work now again.`);
      }
    } catch (e) { setEvalMsg(e instanceof Error ? e.message : "Update failed"); }
    finally { setBusyKey(null); }
  }, [headers, mintAddress]);

  // ── Earnings ──
  const posted = useMemo(() => [...submissions].sort((a, b) => (b.postedAt ?? b._creationTime) - (a.postedAt ?? a._creationTime)), [submissions]);
  const earned = posted.reduce((n, s) => n + (s.payoutAmountUsdc ?? 0), 0);
  const paid = posted.reduce((n, s) => n + (s.paidUsdc ?? 0), 0);
  const views = posted.reduce((n, s) => n + (s.viewCount ?? 0), 0);
  const active = memberships.filter((m) => m.status === "active");
  const others = memberships.filter((m) => m.status !== "active");

  const stage = (s: (typeof posted)[number]): { label: string; tone: string } => {
    if (s.status === "pending") return { label: "Awaiting review", tone: "text-zinc-300 border-white/15" };
    if (s.status === "rejected") return { label: "Rejected", tone: "text-red-400 border-red-500/30" };
    if (s.claimDone || (s.paidUsdc ?? 0) > 0) return { label: "Paid", tone: "text-lime-400 border-lime-400/30" };
    if (s.attestationTx) return { label: "Attested", tone: "text-sky-300 border-sky-400/30" };
    if ((s.viewCount ?? 0) > 0) return { label: "Measuring", tone: "text-amber-300 border-amber-400/30" };
    return { label: "Posted", tone: "text-zinc-300 border-white/15" };
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#0a0a0b] text-white">
      <div className="mx-auto max-w-[1100px] px-6 py-6 space-y-5">
        <div className="flex items-center gap-2">
          <Briefcase className="size-4 text-lime-400" />
          <h2 className="text-[15px] font-semibold">Work</h2>
          <span className="text-[11.5px] text-zinc-500">{isClipper ? "Clipping campaigns this agent turns into posts." : "UGC campaigns this agent creates original persona videos for."}</span>
        </div>

        {/* Wallet + Cadence */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><Wallet className="size-3.5" /> Wallet</div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums leading-none">{usd(wallet.liveBalance)} <span className="text-[12px] font-normal text-zinc-500">USDC available</span></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">On-chain</div><div className="tabular-nums">{usd(wallet.onChainBalance)}</div></div>
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">Unsettled tab</div><div className="tabular-nums text-amber-300">{usd(wallet.unsettledTab)}</div></div>
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">Withdrawable</div><div className="tabular-nums">{usd(wallet.safeWithdrawable)}</div></div>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={onDeposit} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-lime-400 px-3 py-2 text-[12px] font-bold text-black hover:bg-lime-300"><ArrowDownToLine className="size-3.5" /> Top up</button>
              <button type="button" onClick={onWithdraw} disabled={wallet.safeWithdrawable <= 0} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-bold hover:bg-white/5 disabled:opacity-40"><ArrowUpFromLine className="size-3.5" /> Withdraw</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <div><div className="text-zinc-500">Earned</div><div className="tabular-nums text-lime-400">{usd(earned)}</div></div>
              <div><div className="text-zinc-500">Paid out</div><div className="tabular-nums">{usd(paid)}</div></div>
              <div><div className="text-zinc-500">Spent on runs</div><div className="tabular-nums text-zinc-300">{usd(wallet.spent)}</div></div>
            </div>
          </section>

          {isClipper ? <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><Clock className="size-3.5" /> Cadence</div>
            <div className={`mt-3 flex items-center justify-between gap-3 rounded-lg p-3 transition-colors duration-300 ${autoOn ? "bg-lime-400/[0.07] ring-1 ring-lime-400/25" : "bg-black/30"}`}>
              <div>
                <div className="text-[12.5px] font-semibold">Auto-work {autoOn && <span className="ml-1 text-[10.5px] font-normal text-lime-400">running</span>}</div>
                <div className="text-[10.5px] text-zinc-500">Heartbeat picks a joined campaign, clips, posts, submits. Off = manual only.</div>
              </div>
              <Switch on={autoOn} busy={autoBusy} onClick={() => void toggleAuto()} label="Auto-work" />
            </div>
            <div className="mt-3 rounded-lg bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[12.5px] font-semibold">Clips per day</div>
                <span className="text-[12px] tabular-nums text-zinc-300">{effectiveClipsPerDay === 0 ? "unlimited" : `${effectiveClipsPerDay} run${effectiveClipsPerDay === 1 ? "" : "s"}`}</span>
              </div>
              <input type="range" min={0} max={20} step={1} value={effectiveClipsPerDay}
                onChange={(e) => setClipsPerDay(Number(e.target.value))}
                onMouseUp={() => void saveClipsPerDay(effectiveClipsPerDay)} onTouchEnd={() => void saveClipsPerDay(effectiveClipsPerDay)} onKeyUp={() => void saveClipsPerDay(effectiveClipsPerDay)}
                className="mt-2 w-full accent-lime-400" />
              <div className="mt-1 flex items-center justify-between text-[10.5px] text-zinc-500">
                <span>Each run yields up to {clipCfg.maxClipsPerSource} clips. 0 = unlimited.</span>
                <span className="inline-flex items-center gap-1">{savingCadence && <Loader2 className="size-3 animate-spin" />}{cadenceMsg}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">Spent today</div><div className="tabular-nums">{usd(today?.spentTodayUsdc)}{today && today.capUsdc > 0 ? <span className="text-zinc-500"> / {usd(today.capUsdc)} cap</span> : null}</div></div>
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">Posts to</div><div>{(clipCfg.platforms ?? []).map((p) => PLATFORM_LABEL[p] ?? p).join(", ") || "all connected"}{clipCfg.autoPost ? "" : " (auto-post off)"}</div></div>
            </div>
            {(!clipCfg.autoPost || !(agent?.connectedPlatforms?.length)) && (
              <p className="mt-2 text-[11px] text-amber-300">{!(agent?.connectedPlatforms?.length) ? "Connect a social account first. " : ""}{!clipCfg.autoPost ? "Turn Auto-post on in Posting schedule below. " : ""}Auto-work waits until then, and no clip fee is charged.</p>
            )}
          </section> : <section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet-300"><Sparkles className="size-3.5" /> Influencer campaign mode</div>
            <h3 className="mt-3 text-[15px] font-semibold">Original UGC, created in character</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">Work now reads the campaign brief and mandatory requirements, studies its brand and product references, combines them with this agent&apos;s persona and Director settings, generates a unique video, posts it to an eligible connected account, and submits the live post.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">Persona</div><div className="text-white">Identity and voice preserved</div></div>
              <div className="rounded-lg bg-black/30 p-2"><div className="text-zinc-500">Connected socials</div><div className={agent?.connectedPlatforms?.length ? "text-lime-300" : "text-amber-300"}>{agent?.connectedPlatforms?.length ? agent.connectedPlatforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ") : "Connect one before working"}</div></div>
            </div>
          </section>}
        </div>

        {/* Posting schedule */}
        {isClipper && <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><CalendarClock className="size-3.5" /> Posting schedule</div>
              <p className="mt-1 text-[11px] text-zinc-500">When finished clips go live. Campaign and own-content clips use separate daily limits and times. Saving campaign times also reschedules queued campaign clips. Own-content clips keep their separate schedule.</p>
            </div>
            <Switch on={sched.autoPost} onClick={() => patchSched({ autoPost: !sched.autoPost })} label="Auto-post" />
          </div>
          <div className={`mt-3 grid gap-3 md:grid-cols-2 transition-opacity duration-300 ${sched.autoPost ? "" : "opacity-60"}`}>
            <div className="rounded-lg bg-black/30 p-3">
              <div className="text-[12px] font-semibold">Own-content posts per day</div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" aria-label="Fewer" onClick={() => patchSched({ maxPerDay: Math.max(0, sched.maxPerDay - 1) })} className="grid size-8 place-items-center rounded-lg border border-white/15 hover:bg-white/5"><Minus className="size-3.5" /></button>
                <div className="min-w-[88px] text-center text-[18px] font-semibold tabular-nums">{sched.maxPerDay === 0 ? "No cap" : sched.maxPerDay}</div>
                <button type="button" aria-label="More" onClick={() => patchSched({ maxPerDay: Math.min(48, sched.maxPerDay + 1) })} className="grid size-8 place-items-center rounded-lg border border-white/15 hover:bg-white/5"><Plus className="size-3.5" /></button>
              </div>
              <div className="mt-3 text-[12px] font-semibold">Time between posts</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {INTERVAL_PRESETS.map((p) => (
                  <button key={p.ms} type="button" onClick={() => patchSched({ postIntervalMs: p.ms })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${sched.postIntervalMs === p.ms ? "border-lime-400 bg-lime-400 text-black" : "border-white/15 text-zinc-300 hover:bg-white/5"}`}>{p.label}</button>
                ))}
                {!INTERVAL_PRESETS.some((p) => p.ms === sched.postIntervalMs) && <span className="rounded-full border border-lime-400/40 px-2.5 py-1 text-[11px] text-lime-300">{fmtInterval(sched.postIntervalMs)}</span>}
              </div>
            </div>
            <div className="rounded-lg bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold">First post of the day</div>
                <button type="button" onClick={() => patchSched(sched.startHour === null ? { startHour: 9, startMinute: 0 } : { startHour: null })} className="text-[10.5px] text-zinc-400 hover:text-white">{sched.startHour === null ? "Set a time" : "Any time"}</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {sched.startHour === null ? (
                  <span className="rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-[12px] text-zinc-400">As soon as clips are ready</span>
                ) : (
                  <input type="time" value={`${pad2(sched.startHour)}:${pad2(sched.startMinute)}`} step={900}
                    onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); if (Number.isFinite(h)) patchSched({ startHour: h, startMinute: Number.isFinite(m) ? m : 0 }); }}
                    className="rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[13px] tabular-nums [color-scheme:dark]" />
                )}
                <select value={sched.timezone} onChange={(e) => patchSched({ timezone: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-[11.5px]">
                  {tzOptions.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")} ({zoneOffsetLabel(tz, nowTick)})</option>)}
                </select>
              </div>
              <div className="mt-3 text-[12px] font-semibold">Post to</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {connected.length === 0 ? <span className="text-[11px] text-amber-300">No social account connected yet.</span> : connected.map((p) => {
                  const onP = sched.platforms.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => patchSched({ platforms: onP ? sched.platforms.filter((x) => x !== p) : [...sched.platforms, p] })}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${onP ? "border-lime-400/60 bg-lime-400/15 text-lime-300" : "border-white/15 text-zinc-400 hover:bg-white/5"}`}>
                      {onP && <Check className="size-3" />}{PLATFORM_LABEL[p] ?? p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-lime-400/20 bg-lime-400/[0.03] p-3">
            <div className="flex items-center justify-between gap-2"><h3 className="text-[12px] font-semibold text-lime-300">Campaign content</h3><span className="text-[11px] text-zinc-400">{campaignQueue.length} queued · {submissions.length} entries</span></div>
            <p className="mt-1 text-[11px] text-zinc-400">Every published clip gets its own campaign entry. Your own content keeps its separate schedule above.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-[11px] text-zinc-400">Campaign posts per day
                <input type="number" min={0} max={48} value={sched.campaignPosting.maxPerDay} onChange={(e) => patchSched({ campaignPosting: { ...sched.campaignPosting, maxPerDay: Math.max(0, Math.min(48, Number(e.target.value))) } })} className="mt-1 block w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-white" />
                <span className="mt-1 block text-[10px]">0 = no cap, across all campaigns</span>
              </label>
              <label className="text-[11px] text-zinc-400">Time between campaign posts
                <select value={sched.campaignPosting.postIntervalMs} onChange={(e) => patchSched({ campaignPosting: { ...sched.campaignPosting, postIntervalMs: Number(e.target.value) } })} className="mt-1 block w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-white">
                  {!INTERVAL_PRESETS.some((p) => p.ms === sched.campaignPosting.postIntervalMs) && <option value={sched.campaignPosting.postIntervalMs}>{fmtInterval(sched.campaignPosting.postIntervalMs)}</option>}
                  {INTERVAL_PRESETS.map((p) => <option key={p.ms} value={p.ms}>{p.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-zinc-400">Campaign daily start ({sched.timezone.replace(/_/g, " ")})
                <input type="time" value={sched.campaignPosting.dailyStartHour === undefined ? "" : `${pad2(sched.campaignPosting.dailyStartHour)}:${pad2(sched.campaignPosting.dailyStartMinute)}`} onChange={(e) => { const [hour, minute] = e.target.value.split(":").map(Number); patchSched({ campaignPosting: { ...sched.campaignPosting, dailyStartHour: e.target.value ? hour : undefined, dailyStartMinute: minute || 0 } }); }} className="mt-1 block w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-white" />
                <button type="button" onClick={() => patchSched({ campaignPosting: { ...sched.campaignPosting, dailyStartHour: undefined, dailyStartMinute: 0 } })} className="mt-1 text-[10px] underline">Use interval only</button>
              </label>
            </div>
            <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
              {!campaignQueue.length && <p className="text-[11px] text-zinc-500">Campaign clips appear here after rendering. Auto-post must be on.</p>}
              {campaignQueue.slice(0, 8).map((row) => <div key={row._id} className="flex items-center justify-between gap-3 text-[11px]"><span className="truncate text-zinc-300">{row.topic}</span><span className="shrink-0 text-zinc-400">{slotFmt.format(row.scheduledFor)}</span></div>)}
              {campaignQueue.length > 8 && <p className="text-[10px] text-zinc-500">+{campaignQueue.length - 8} more in the posting calendar</p>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
              <span className="text-zinc-500">{sched.autoPost ? "Next slots:" : "Auto-post off, clips wait for you. Slots would be:"}</span>
              {nextSlots.map((t) => <span key={t} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 tabular-nums text-zinc-300">{slotFmt.format(t)}</span>)}
            </div>
            <div className="flex items-center gap-2">
              {schedMsg && <span className={`inline-flex items-center gap-1 text-[11px] ${schedMsg === "Schedule saved" ? "text-lime-400" : "text-red-400"}`}>{schedMsg === "Schedule saved" && <Check className="size-3" />}{schedMsg}</span>}
              {schedDirty && <button type="button" onClick={() => { setSchedDraft(null); setSchedMsg(null); }} className="rounded-md px-2.5 py-1.5 text-[11.5px] text-zinc-400 hover:text-white">Reset</button>}
              <button type="button" onClick={() => void saveSchedule()} disabled={!schedDirty || schedSaving}
                className="inline-flex items-center gap-1.5 rounded-md bg-lime-400 px-3 py-1.5 text-[11.5px] font-semibold text-black transition-opacity disabled:opacity-40">
                {schedSaving && <Loader2 className="size-3 animate-spin" />} Save schedule
              </button>
            </div>
          </div>
        </section>}

        {/* Campaign terms */}
        {isClipper && <section ref={consentRef} className={`rounded-2xl border p-4 transition-colors duration-300 ${showConsentForm && enableAfterConsent ? "border-lime-400/40 bg-lime-400/[0.03]" : "border-white/10 bg-white/[0.03]"}`}>
          {!showConsentForm && authorized ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-full bg-lime-400/15"><ShieldCheck className="size-4 text-lime-400" /></div>
                <div>
                  <div className="text-[12.5px] font-semibold">Campaign terms agreed <span className="font-normal text-zinc-500">· {new Date(authorized.consentedAt).toLocaleDateString()}</span></div>
                  <div className="text-[11px] text-zinc-400">
                    {authorized.autoJoin ? "Joins eligible clipping campaigns automatically" : "Joins only campaigns you pick"}
                    {authorized.allowThirdPartySources ? " · may post other creators' footage" : ""}
                    {authorized.allowProfileCtaCampaigns ? " · shows bio-link campaigns for approval" : ""}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setEditingConsent(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] font-semibold hover:bg-white/5"><Pencil className="size-3" /> Edit terms</button>
            </div>
          ) : (
            <>
              <h3 className="flex items-center gap-2 text-[12.5px] font-semibold"><ShieldCheck className="size-4 text-lime-400" /> Campaign terms</h3>
              <p className="mt-1 text-[11px] text-zinc-400">AI Clippers only work clipping campaigns. Only funded on-chain ones run automatically. The agent may spend its clip budget, post on your connected accounts, and earn USDC for verified views. You can pause Auto-work or leave a campaign at any time.</p>
              <div className="mt-3 space-y-2 text-[12px]">
                <label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-0.5 accent-lime-400" checked={consent.autoJoin} onChange={(e) => setConsentDraft({ ...consent, autoJoin: e.target.checked })} /><span>Let this agent join eligible campaigns without my approval. Off means only campaigns I join manually.</span></label>
                <label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-0.5 accent-lime-400" checked={consent.allowThirdPartySources} onChange={(e) => setConsentDraft({ ...consent, allowThirdPartySources: e.target.checked })} /><span>Allow clips featuring other creators on my connected accounts, when the campaign supplies the source.</span></label>
                <label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className="mt-0.5 accent-lime-400" checked={consent.allowProfileCtaCampaigns} onChange={(e) => setConsentDraft({ ...consent, allowProfileCtaCampaigns: e.target.checked })} /><span>Show campaigns requesting a bio/profile link CTA for my manual approval. The agent never changes my profile link.</span></label>
                <label className="flex cursor-pointer items-start gap-2 border-t border-white/10 pt-2"><input type="checkbox" className="mt-0.5 accent-lime-400" checked={consentAcknowledged} onChange={(e) => setConsentAcknowledged(e.target.checked)} /><span>I authorize this agent to evaluate, clip and post under these limits. Campaign payouts depend on verified views, available escrow and oracle settlement.</span></label>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                {authorized && <button type="button" onClick={() => { setEditingConsent(false); setConsentDraft(null); setConsentAcknowledged(false); setEnableAfterConsent(false); }} className="rounded-md px-3 py-1.5 text-[11.5px] text-zinc-400 hover:text-white">Cancel</button>}
                <button type="button" onClick={() => void saveConsent()} disabled={!consentAcknowledged || consentSaving} className="inline-flex items-center gap-1.5 rounded-md bg-lime-400 px-3 py-1.5 text-[11.5px] font-semibold text-black disabled:opacity-40">{consentSaving && <Loader2 className="size-3 animate-spin" />}{enableAfterConsent ? "Agree & turn on Auto-work" : "I agree"}</button>
              </div>
            </>
          )}
        </section>}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><Sparkles className="size-3.5" /> Campaigns</div>
              <p className="mt-1 text-[11px] text-zinc-500">
                The agent scores every open {isClipper ? "clipping" : "UGC"} campaign: niche fit, platforms it can post to, deadline, treasury left, and expected net per {isClipper ? "clip" : "video"}
                {evalAgent ? <> (from {evalAgent.sampleCount && evalAgent.sampleCount >= 3 ? `its median ${Math.round(evalAgent.medianViews ?? 0)} views` : "an 800-view prior"}, run cost {usd(evalAgent.estCostUsdc)})</> : null}. It joins what pays. You can override any row.
              </p>
            </div>
            <button type="button" onClick={() => void evaluate()} disabled={evaluating}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/5 disabled:opacity-50">
              {evaluating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Evaluate now
            </button>
          </div>
          {evalMsg && <p className="mt-2 text-[11px] text-zinc-400">{evalMsg}</p>}

          {memberships.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-[12px] text-zinc-500">
              Nothing evaluated yet. {isClipper ? "Turn Auto-work on or " : ""}Press Evaluate now to find matching {isClipper ? "clipping" : "UGC"} campaigns.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {[{ label: `Working (${active.length})`, rows: active }, { label: `Not working (${others.length})`, rows: others }].map((g) => g.rows.length === 0 ? null : (
                <div key={g.label}>
                  <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">{g.label}</div>
                  <div className="space-y-2">
                    {g.rows.map((m) => {
                      const isActive = m.status === "active";
                      const href = m.campaignId ? `/stage/${m.campaignId}` : `/stage/reward/${m.contentRewardId}`;
                      const campaign = m.campaignId ? campaignById.get(String(m.campaignId)) : undefined;
                      const references = (campaign?.contentFileUrls?.length ?? 0) + (campaign?.campaignImageUrl ? 1 : 0);
                      return (
                        <div key={m._id} className={`rounded-xl border p-3 ${isActive ? "border-lime-400/30 bg-lime-400/[0.04]" : "border-white/10 bg-black/20"}`}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <a href={href} target="_blank" rel="noreferrer" className="truncate text-[13px] font-semibold hover:underline">{m.title || m.key}</a>
                                <ExternalLink className="size-3 text-zinc-500" />
                                <span className={`rounded-full border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide ${m.rail === "onchain" ? "border-sky-400/30 text-sky-300" : "border-white/15 text-zinc-400"}`}>{m.rail === "onchain" ? "on-chain" : "off-chain"}</span>
                                <span className={`rounded-full border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide ${m.decidedBy === "operator" ? "border-amber-400/30 text-amber-300" : "border-white/15 text-zinc-400"}`}>{m.decidedBy === "operator" ? "you decided" : "agent decided"}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 tabular-nums">
                                <span>${m.ratePerThousandViews ?? 0}/1k views</span>
                                <span>{usd(m.budgetRemainingUsdc)} left</span>
                                <span>{until(m.deadlineAt)}</span>
                                {m.expectedPayoutUsdc !== undefined && <span className={(m.netUsdc ?? 0) > 0 ? "text-lime-400" : "text-zinc-400"}>≈ {usd(m.expectedPayoutUsdc)} / {isClipper ? "clip" : "video"}, net {usd(m.netUsdc)}</span>}
                                <span className="text-zinc-600">evaluated {ago(m.lastEvaluatedAt)}</span>
                              </div>
                              {!isClipper && campaign && (
                                <div className="mt-2 rounded-lg border border-violet-400/15 bg-violet-400/[0.04] p-2 text-[11px] text-zinc-400">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    {campaign.brandName && <span className="font-semibold text-violet-200">{campaign.brandName}</span>}
                                    {campaign.platforms?.length ? <span>{campaign.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")}</span> : null}
                                    <span>{references} visual reference{references === 1 ? "" : "s"}</span>
                                  </div>
                                  {campaign.brief && <p className="mt-1 line-clamp-2 leading-relaxed">{campaign.brief}</p>}
                                  {(campaign.requirements?.length || campaign.requiredTag) ? (
                                    <p className="mt-1 text-zinc-500">Agent instructions: {[...(campaign.requirements ?? []).slice(0, 2), ...(campaign.requiredTag ? [`Include ${campaign.requiredTag}`] : [])].join(" · ")}</p>
                                  ) : null}
                                </div>
                              )}
                              {m.reasons && m.reasons.length > 0 && (
                                <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                                  {m.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-zinc-600">·</span><span>{r}</span></li>)}
                                </ul>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {busyKey === m.key ? <Loader2 className="size-3.5 animate-spin text-zinc-400" /> : isActive ? (
                                <>
                                  <button type="button" onClick={() => void decide(m, "work")} disabled={!isClipper && !(agent?.connectedPlatforms?.length)} title={!isClipper && !(agent?.connectedPlatforms?.length) ? "Connect a social account before starting campaign work" : undefined} className="inline-flex items-center gap-1 rounded-lg bg-lime-400 px-2.5 py-1.5 text-[11.5px] font-bold text-black hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="size-3" /> Work now</button>
                                  <button type="button" onClick={() => void decide(m, "leave")} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11.5px] font-semibold hover:bg-white/5"><X className="size-3" /> Leave</button>
                                </>
                              ) : (
                                <button type="button" onClick={() => void decide(m, "join")} disabled={!isClipper && !(agent?.connectedPlatforms?.length)} title={!isClipper && !(agent?.connectedPlatforms?.length) ? "Connect a social account before starting campaign work" : undefined} className="inline-flex items-center gap-1 rounded-lg bg-lime-400 px-2.5 py-1.5 text-[11.5px] font-bold text-black hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-40"><Check className="size-3" /> {isClipper ? "Join & clip" : "Join & create"}</button>
                              )}
                              {m.decidedBy === "operator" && busyKey !== m.key && (
                                <button type="button" onClick={() => void decide(m, "auto")} title="Let the agent decide again" className="rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5">Auto</button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Earnings */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Earnings</div>
            <div className="flex gap-3 text-[11px] tabular-nums text-zinc-400"><span>{posted.length} posts</span><span>{views.toLocaleString()} views</span><span className="text-lime-400">{usd(earned)} earned</span><span>{usd(paid)} paid</span></div>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">Posted {isClipper ? "clips" : "campaign videos"} are measured and reviewed by the oracle. Approved views are attested on-chain, then the claim keeper pays from the campaign escrow after the dispute window. Proof and payout transactions appear below.</p>
          {posted.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-[12px] text-zinc-500">No campaign posts yet. Once a {isClipper ? "clip" : "video"} posts, it shows up here with its views and payout.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                  <tr><th className="py-1.5 pr-3 font-semibold">Campaign</th><th className="py-1.5 pr-3 font-semibold">Post</th><th className="py-1.5 pr-3 text-right font-semibold">Views</th><th className="py-1.5 pr-3 text-right font-semibold">Earned</th><th className="py-1.5 pr-3 text-right font-semibold">Paid</th><th className="py-1.5 pr-3 font-semibold">Status</th><th className="py-1.5 font-semibold">When</th></tr>
                </thead>
                <tbody>
                  {posted.slice(0, 60).map((s) => {
                    const st = stage(s);
                    const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ? "" : "?cluster=devnet";
                    return (
                      <tr key={s._id} className="border-t border-white/5">
                        <td className="py-2 pr-3 max-w-[220px] truncate">{s.campaign?.title ?? "—"}</td>
                        <td className="py-2 pr-3">{s.postUrl ? <a href={s.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">{s.platform ?? "post"} <ExternalLink className="size-3" /></a> : <span className="text-zinc-500">{s.platform ?? "—"}</span>}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{(s.viewCount ?? 0).toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-lime-400">{usd(s.payoutAmountUsdc)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{usd(s.paidUsdc)}</td>
                        <td className="py-2 pr-3"><span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${st.tone}`}>{st.label}</span>{s.attestationTx && <a href={`https://solscan.io/tx/${s.attestationTx}${cluster}`} target="_blank" rel="noreferrer" className="ml-1.5 text-[10px] text-zinc-400 hover:text-white">Proof ↗</a>}{s.payoutTxSignature && <a href={`https://solscan.io/tx/${s.payoutTxSignature}${cluster}`} target="_blank" rel="noreferrer" className="ml-1.5 text-[10px] text-lime-400 hover:text-lime-300">Payout ↗</a>}</td>
                        <td className="py-2 text-zinc-500">{ago(s.postedAt ?? s._creationTime)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="border-t border-white/10 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">On-chain payout transactions</div>
          {payoutEvents.length === 0 ? (
            <p className="mt-2 text-[11px] text-zinc-500">No payout transactions yet. Confirmed claims will appear here.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {payoutEvents.map((event) => (
                <div key={event._id} className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-[11px]">
                  <span className="text-zinc-400">{new Date(event.recordedAt).toLocaleString()}</span>
                  <span className="font-medium tabular-nums text-lime-400">+{usd(event.grossDeltaUsdc)}</span>
                  <a href={`https://solscan.io/tx/${event.txSignature}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ? "" : "?cluster=devnet"}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-300 hover:text-white">View transaction <ExternalLink className="size-3" /></a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
