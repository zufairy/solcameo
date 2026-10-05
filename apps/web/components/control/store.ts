"use client";

import { useSyncExternalStore } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

/* ════════ /control state ════════
   Chat threads and teams live OUTSIDE React so a reply that's still in flight
   keeps going when you switch chats (or the component remounts) and lands in the
   right thread. The account's copy lives in Convex (convex/controlPanel.ts) so
   it follows you across devices; localStorage is only a fast local cache. */

export type Agent = FunctionReturnType<typeof api.influencers.listByCreators>[number];
export type FeedItem = FunctionReturnType<typeof api.clipJobs.videoFeedByMints>["items"][number];
export type VideoFilter = "all" | "posted" | "ready";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  /** Team chats: which agent (mint) said this. Absent in 1:1 chats. */
  speaker?: string;
  showVideos?: { count: number; filter: VideoFilter; sort?: "recent" | "views" | "viral" };
  openBuilder?: { tab: string; href: string };
  /** System confirmations (joined a campaign, scheduled posts, plan updated). */
  notes?: string[];
  error?: boolean;
  /** Just arrived — play the typing reveal once. Never persisted. */
  fresh?: boolean;
  /** A mission the agent(s) proposed — approved, run and reviewed in place. */
  plan?: Plan;
  /** Existing videos the agent offered to post — each needs the owner's OK. */
  postProposal?: PostProposal;
}

/* ── Missions ────────────────────────────────────────────────────────────────
   Approval-first agentic work: an agent proposes a PLAN (who makes what), the
   owner approves it, steps run through the real pipelines (run-task create_video
   / clip_source, both with holdForApproval so nothing auto-posts), hand-offs
   wait for their source step, and every finished video comes back as a review
   card. Only an approved video is scheduled to post. */
export type StepStatus =
  | "proposed" | "skipped" | "queued" | "starting" | "running"
  | "review" | "posting" | "posted" | "rejected" | "failed";
export interface ReviewItem {
  videoUrl: string;
  title: string;
  caption: string;
  status: "review" | "posting" | "posted" | "rejected";
  platforms?: string[];
  error?: string;
}
export interface PlanStep {
  id: string;
  agentMint: string;
  agentName: string;
  kind: "create_video" | "clip_video";
  topic?: string;
  sourceUrl?: string;
  campaignId?: string;
  /** Hand-off: clip the finished video of this earlier step (0-based index). */
  sourceStep?: number;
  why?: string;
  status: StepStatus;
  taskId?: string;
  clipJobIds?: string[];
  /** Finished output awaiting / after review (one for a video, N for clips). */
  results?: ReviewItem[];
  error?: string;
  startedAt?: number;
}
export interface Plan {
  id: string;
  title: string;
  status: "proposed" | "running" | "done" | "cancelled";
  steps: PlanStep[];
}
export interface PostProposal {
  mint: string;
  platforms: string[];
  items: ReviewItem[];
}

export interface Team {
  id: string;
  name: string;
  memberMints: string[];
  createdAt: number;
  /** Pinned brief / goal — sent to every member on every reply. */
  brief?: string;
}

export type Thread = {
  messages: ChatMessage[];
  sending: boolean;
  /** Mint of the agent currently composing a reply. */
  typing?: string;
};

const STORAGE_PREFIX = "vello_control_chat_";
const TEAMS_KEY = "vello_control_teams";
const HISTORY_CAP = 80;
/** Turns sent to the model — the route keeps the last 30 on this surface. */
const CONTEXT_TURNS = 30;
/** Most agents that answer one team message (keeps a turn snappy). */
const MAX_TEAM_RESPONDERS = 4;

export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", threads: "Threads", x: "X", twitter: "X", facebook: "Facebook",
};
export const TAB_LABEL: Record<string, string> = {
  home: "Home", director: "Director", ideas: "Ideas", editor: "Editor", videos: "Videos", schedule: "Schedule",
  posting: "Schedule", generations: "Generations", learn: "Learn", carousel: "Carousel",
};

export const teamKey = (id: string) => `team:${id}`;

export function agentKind(a: Pick<Agent, "agentType">): string {
  const t = (a.agentType ?? "influencer").toLowerCase();
  return t === "clipping" ? "Clipper" : t === "trader" ? "Trader" : t === "worker" ? "Worker" : "Influencer";
}

/* ── Store plumbing ─────────────────────────────────────────────────────── */
const EMPTY_THREAD: Thread = { messages: [], sending: false };
const threads = new Map<string, Thread>();
const listeners = new Set<() => void>();
let version = 0;
let teamsCache: Team[] | null = null;
const NO_TEAMS: Team[] = [];

function emit() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function loadHistory(key: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function getThread(key: string): Thread {
  let t = threads.get(key);
  if (!t) {
    t = { messages: typeof window === "undefined" ? [] : loadHistory(key), sending: false };
    threads.set(key, t);
  }
  return t;
}

export function updateThread(key: string, fn: (t: Thread) => Thread, opts: { fromServer?: boolean } = {}) {
  const prev = getThread(key);
  const next = fn(prev);
  threads.set(key, next);
  try {
    const persist = persistable(next.messages);
    if (persist.length) localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(persist));
    else localStorage.removeItem(STORAGE_PREFIX + key);
  } catch { /* quota / private mode */ }
  if (!opts.fromServer && next.messages !== prev.messages) scheduleSave(key);
  emit();
}

export function markSeen(key: string, id: string) {
  if (!getThread(key).messages.some((m) => m.id === id && m.fresh)) return;
  updateThread(key, (t) => ({ ...t, messages: t.messages.map((m) => (m.id === id ? { ...m, fresh: false } : m)) }));
}

export function useThread(key: string): Thread {
  return useSyncExternalStore(subscribe, () => getThread(key), () => EMPTY_THREAD);
}
/** Re-render on ANY store change (sidebar previews, "typing…"). */
export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/* ── Account sync (Convex) ──────────────────────────────────────────────────
   Server is the source of truth. A thread with unsaved local edits ("dirty")
   is never overwritten; everything else follows the server. Clock-free: we
   compare against the last content we know the server holds. */
type ServerTeam = { teamId: string; name: string; memberMints: string[]; createdAt: number; brief?: string };
type ServerThread = { key: string; messages: Array<Omit<ChatMessage, "fresh">>; updatedAt: number };
export type SyncApi = {
  getToken: () => Promise<string | null>;
  bootstrap: (a: { accessToken: string }) => Promise<{ teams: ServerTeam[]; threads: ServerThread[] }>;
  saveThread: (a: { accessToken: string; key: string; messages: Array<Omit<ChatMessage, "fresh">> }) => Promise<unknown>;
  saveTeam: (a: { accessToken: string } & ServerTeam) => Promise<unknown>;
  deleteTeam: (a: { accessToken: string; teamId: string }) => Promise<unknown>;
};
const MIGRATED_KEY = "vello_control_migrated_v1";
let sync: SyncApi | null = null;
const serverCopy = new Map<string, string>(); // key → serialized messages the server holds
const dirty = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingTeams = new Set<string>(); // created locally, not yet confirmed
let hydrating: Promise<void> | null = null;
let syncState: "idle" | "syncing" | "synced" | "offline" = "idle";

export function configureSync(api: SyncApi | null) { sync = api; }
export function useSyncState() {
  return useSyncExternalStore(subscribe, () => syncState, () => "idle" as const);
}
function setSyncState(s: typeof syncState) { if (syncState !== s) { syncState = s; emit(); } }

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip the transient flag
const persistable = (msgs: ChatMessage[]) => msgs.slice(-HISTORY_CAP).map(({ fresh: _fresh, ...m }) => m);

function scheduleSave(key: string) {
  if (!sync) return;
  dirty.add(key);
  const prev = saveTimers.get(key);
  if (prev) clearTimeout(prev);
  saveTimers.set(key, setTimeout(() => { void flushSave(key); }, 700));
}
async function flushSave(key: string) {
  saveTimers.delete(key);
  if (!sync) return;
  const msgs = persistable(getThread(key).messages);
  const serial = JSON.stringify(msgs);
  if (serverCopy.get(key) === serial) { dirty.delete(key); return; }
  try {
    const accessToken = await sync.getToken();
    if (!accessToken) return;
    await sync.saveThread({ accessToken, key, messages: msgs });
    serverCopy.set(key, serial);
    // Only clean if nothing changed while the save was in flight.
    if (JSON.stringify(persistable(getThread(key).messages)) === serial) dirty.delete(key);
    setSyncState("synced");
  } catch {
    setSyncState("offline");
    // Retry once a bit later; the next edit or hydrate retries too.
    saveTimers.set(key, setTimeout(() => { void flushSave(key); }, 5000));
  }
}

/** Pull the account's teams + threads and reconcile with the local cache.
 *  Safe to call often (focus, interval) — concurrent calls share one run. */
export function hydrate(): Promise<void> {
  if (!sync) return Promise.resolve();
  if (hydrating) return hydrating;
  const api = sync;
  hydrating = (async () => {
    try {
      setSyncState(syncState === "synced" ? "synced" : "syncing");
      const accessToken = await api.getToken();
      if (!accessToken) return;
      const data = await api.bootstrap({ accessToken });
      let firstRun = false;
      try { firstRun = localStorage.getItem(MIGRATED_KEY) !== "1"; } catch { /* noop */ }

      // Threads
      const onServer = new Set<string>();
      for (const t of data.threads) {
        onServer.add(t.key);
        const serial = JSON.stringify(t.messages);
        const local = getThread(t.key);
        if (local.sending || dirty.has(t.key)) continue;
        if (JSON.stringify(persistable(local.messages)) !== serial) {
          updateThread(t.key, (th) => ({ ...th, messages: t.messages }), { fromServer: true });
        }
        serverCopy.set(t.key, serial);
      }
      for (const [key, local] of threads) {
        if (onServer.has(key) || local.sending || dirty.has(key) || local.messages.length === 0) continue;
        // Local-only: first sync uploads it (moving old browser-only chats to the
        // account); afterwards it was cleared on another device → follow that.
        if (firstRun) scheduleSave(key);
        else if (serverCopy.has(key)) { serverCopy.delete(key); updateThread(key, (th) => ({ ...th, messages: [] }), { fromServer: true }); }
      }
      if (firstRun) {
        // Chats cached in this browser but never loaded into memory yet.
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith(STORAGE_PREFIX)) continue;
            const key = k.slice(STORAGE_PREFIX.length);
            if (!onServer.has(key) && getThread(key).messages.length) scheduleSave(key);
          }
        } catch { /* noop */ }
      }

      // Teams
      const local = getTeams();
      const serverIds = new Set(data.teams.map((t) => t.teamId));
      const keepLocal = local.filter((t) => !serverIds.has(t.id) && (pendingTeams.has(t.id) || firstRun));
      if (firstRun) {
        for (const t of keepLocal) {
          pendingTeams.add(t.id);
          void api.saveTeam({ accessToken, teamId: t.id, name: t.name, memberMints: t.memberMints, createdAt: t.createdAt, ...(t.brief ? { brief: t.brief } : {}) })
            .then(() => pendingTeams.delete(t.id)).catch(() => {});
        }
      }
      const merged: Team[] = [
        ...keepLocal,
        ...data.teams.map((t) => ({ id: t.teamId, name: t.name, memberMints: t.memberMints, createdAt: t.createdAt, ...(t.brief ? { brief: t.brief } : {}) })),
      ].sort((a, b) => b.createdAt - a.createdAt);
      if (JSON.stringify(merged) !== JSON.stringify(local)) saveTeams(merged);

      try { localStorage.setItem(MIGRATED_KEY, "1"); } catch { /* noop */ }
      setSyncState("synced");
    } catch {
      setSyncState("offline");
    } finally {
      hydrating = null;
    }
  })();
  return hydrating;
}

/* ── Teams ──────────────────────────────────────────────────────────────── */
export function getTeams(): Team[] {
  if (teamsCache) return teamsCache;
  if (typeof window === "undefined") return NO_TEAMS;
  try {
    const parsed = JSON.parse(localStorage.getItem(TEAMS_KEY) ?? "[]") as Team[];
    teamsCache = Array.isArray(parsed) ? parsed : [];
  } catch { teamsCache = []; }
  return teamsCache;
}
function saveTeams(next: Team[]) {
  teamsCache = next;
  try { localStorage.setItem(TEAMS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  emit();
}
export function useTeams(): Team[] {
  return useSyncExternalStore(subscribe, getTeams, () => NO_TEAMS);
}
export function createTeam(name: string, memberMints: string[]): Team {
  const team: Team = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, memberMints, createdAt: Date.now() };
  saveTeams([team, ...getTeams()]);
  const api = sync;
  if (api) {
    pendingTeams.add(team.id);
    void (async () => {
      try {
        const accessToken = await api.getToken();
        if (!accessToken) return;
        await api.saveTeam({ accessToken, teamId: team.id, name: team.name, memberMints: team.memberMints, createdAt: team.createdAt });
        pendingTeams.delete(team.id);
        setSyncState("synced");
      } catch { setSyncState("offline"); }
    })();
  }
  return team;
}
export function deleteTeam(id: string) {
  saveTeams(getTeams().filter((t) => t.id !== id));
  pendingTeams.delete(id);
  const key = teamKey(id);
  // The server delete removes the thread too — don't also queue a save.
  updateThread(key, () => ({ messages: [], sending: false }), { fromServer: true });
  serverCopy.delete(key);
  const api = sync;
  if (api) {
    void (async () => {
      try {
        const accessToken = await api.getToken();
        if (accessToken) await api.deleteTeam({ accessToken, teamId: id });
      } catch { setSyncState("offline"); }
    })();
  }
}

/** Set (or clear) a team's pinned brief. */
export function setTeamBrief(id: string, brief: string) {
  const next = getTeams().map((t) => (t.id === id ? { ...t, brief: brief.trim().slice(0, 1200) || undefined } : t));
  saveTeams(next);
  const team = next.find((t) => t.id === id);
  const api = sync;
  if (!api || !team) return;
  void (async () => {
    try {
      const accessToken = await api.getToken();
      if (!accessToken) return;
      await api.saveTeam({ accessToken, teamId: team.id, name: team.name, memberMints: team.memberMints, createdAt: team.createdAt, ...(team.brief ? { brief: team.brief } : {}) });
      setSyncState("synced");
    } catch { setSyncState("offline"); }
  })();
}

/* ── Talking to agents ──────────────────────────────────────────────────── */
type ChatResponse = {
  message?: string; error?: string;
  join?: { title: string } | null;
  posted?: { count: number; platforms: string[] } | null;
  savedIdea?: unknown;
  savedIdeas?: string[];
  generated?: { taskId: string; topic: string } | null;
  bibleUpdated?: unknown;
  biblePatches?: string[];
  showVideos?: { count: number; filter: VideoFilter; sort?: "recent" | "views" | "viral" };
  openBuilder?: { tab: string; href: string };
  plan?: { title: string; steps: Array<Omit<PlanStep, "status">> };
  postProposal?: { platforms: string[]; items: Array<{ title: string; caption: string; videoUrl: string }> };
};

/** Card/action-only turns carry a short note so the agent remembers what it did. */
function withExtras(m: ChatMessage): string {
  const extras: string[] = [];
  if (m.showVideos) extras.push(`(showed the operator ${m.showVideos.count} ${m.showVideos.filter === "all" ? "latest" : m.showVideos.filter} videos as cards)`);
  if (m.openBuilder) extras.push(`(opened the ${TAB_LABEL[m.openBuilder.tab] ?? m.openBuilder.tab} tab in the Builder)`);
  if (m.notes?.length) extras.push(`(${m.notes.join(" ")})`);
  if (m.plan) {
    const steps = m.plan.steps.map((s, i) => `${i + 1}. ${s.agentName}: ${s.kind === "clip_video" ? "clip" : "video"} ${s.topic ? `"${s.topic}"` : ""} [${s.status}]`).join("; ");
    extras.push(`(proposed a plan "${m.plan.title}", ${m.plan.status}: ${steps})`);
  }
  if (m.postProposal) extras.push(`(offered ${m.postProposal.items.length} video(s) for the operator to approve before posting)`);
  return [m.content, ...extras].filter(Boolean).join("\n");
}

/** The conversation from ONE agent's point of view: its own lines are
 *  "assistant", everything else (operator + teammates) is "user", with
 *  teammates prefixed "[Name]:". Consecutive same-role turns are merged. */
export function historyFor(messages: ChatMessage[], selfMint: string, names: Map<string, string>) {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages.filter((x) => !x.error).slice(-CONTEXT_TURNS)) {
    const mine = m.role === "assistant" && (!m.speaker || m.speaker === selfMint);
    const role: "user" | "assistant" = mine ? "assistant" : "user";
    const content = m.role === "assistant" && !mine ? `[${names.get(m.speaker ?? "") ?? "Teammate"}]: ${withExtras(m)}` : withExtras(m);
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function askAgent(
  agent: Agent,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  extra: {
    team?: { name: string; members: Array<{ name: string; kind: string }>; brief?: string };
    operatorMessage?: string;
    roster?: Array<{ mint: string; name: string; kind: string }>;
  } = {},
): Promise<ChatMessage> {
  try {
    const res = await fetch("/api/agents/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mintAddress: agent.mintAddress,
        surface: "control",
        messages: history,
        personaSnapshot: {
          name: agent.name, handle: agent.handle, niche: agent.niche, language: agent.language,
          voiceArchetype: agent.archetype, mintAddress: agent.mintAddress,
        },
        ...extra,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok || data.error) throw new Error(data.error ?? `Reply failed (${res.status})`);
    const notes: string[] = [];
    if (data.join) notes.push(`Joined "${data.join.title}". Generating the clip now, track it in Tasks.`);
    if (data.posted && data.posted.count > 0) {
      notes.push(`Scheduled ${data.posted.count} video${data.posted.count === 1 ? "" : "s"} to ${data.posted.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")}.`);
    }
    if (data.savedIdeas?.length) {
      notes.push(data.savedIdeas.length === 1
        ? `Idea saved to the queue: "${data.savedIdeas[0]}".`
        : `${data.savedIdeas.length} ideas saved to the queue: ${data.savedIdeas.map((h) => `"${h}"`).join(", ")}.`);
    } else if (data.savedIdea) notes.push("Idea saved to the queue.");
    if (data.generated) notes.push(`Generating "${data.generated.topic}" now. It lands in your videos when it's rendered.`);
    if (data.biblePatches?.length || data.bibleUpdated) notes.push("Show plan updated.");
    // Models in a group chat sometimes echo their own name tag — drop it.
    const content = (data.message ?? "").replace(new RegExp(`^\\s*\\[?${escapeRe(agent.name)}\\]?:\\s*`, "i"), "");
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "assistant", content, at: Date.now(), fresh: true,
      ...(data.showVideos ? { showVideos: data.showVideos } : {}),
      ...(data.openBuilder ? { openBuilder: data.openBuilder } : {}),
      ...(notes.length ? { notes } : {}),
      ...(data.plan?.steps?.length ? {
        plan: {
          id: `p${Date.now().toString(36)}`,
          title: data.plan.title,
          status: "proposed" as const,
          steps: data.plan.steps.map((st) => ({ ...st, status: "proposed" as const })),
        },
      } : {}),
      ...(data.postProposal?.items?.length ? {
        postProposal: {
          mint: agent.mintAddress,
          platforms: data.postProposal.platforms,
          items: data.postProposal.items.map((it) => ({ ...it, status: "review" as const })),
        },
      } : {}),
    };
  } catch (e) {
    return {
      id: `${Date.now()}-e`, role: "assistant", at: Date.now(), error: true, fresh: true,
      content: e instanceof Error ? e.message : "Something went wrong. Try again.",
    };
  }
}

export async function sendToAgent(agent: Agent, text: string) {
  const key = agent.mintAddress;
  if (getThread(key).sending) return;
  const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: "user", content: text, at: Date.now() };
  updateThread(key, (t) => ({ messages: [...t.messages, userMsg], sending: true, typing: key }));
  const names = new Map([[agent.mintAddress, agent.name]]);
  const reply = await askAgent(agent, historyFor(getThread(key).messages, agent.mintAddress, names), {
    roster: [{ mint: agent.mintAddress, name: agent.name, kind: agentKind(agent) }],
  });
  updateThread(key, (t) => ({ messages: [...t.messages, reply], sending: false, typing: undefined }));
}

/** Team turn: the addressed members (or everyone, capped) answer one after the
 *  other, each seeing what the teammates before it just said. */
export async function sendToTeam(team: Team, members: Agent[], text: string) {
  const key = teamKey(team.id);
  if (getThread(key).sending || members.length === 0) return;
  const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: "user", content: text, at: Date.now() };
  updateThread(key, (t) => ({ messages: [...t.messages, userMsg], sending: true }));

  const lower = text.toLowerCase();
  const addressed = members.filter((m) =>
    lower.includes(m.name.toLowerCase()) || (!!m.handle && lower.includes(`@${m.handle.replace(/^@/, "").toLowerCase()}`)));
  const responders = (addressed.length ? addressed : members).slice(0, MAX_TEAM_RESPONDERS);
  const names = new Map(members.map((m) => [m.mintAddress, m.name]));
  const roster = { name: team.name, members: members.map((m) => ({ name: m.name, kind: agentKind(m) })), ...(team.brief ? { brief: team.brief } : {}) };
  const planRoster = members.map((m) => ({ mint: m.mintAddress, name: m.name, kind: agentKind(m) }));

  for (const agent of responders) {
    updateThread(key, (t) => ({ ...t, typing: agent.mintAddress }));
    const reply = await askAgent(agent, historyFor(getThread(key).messages, agent.mintAddress, names), { team: roster, operatorMessage: text, roster: planRoster });
    updateThread(key, (t) => ({ ...t, messages: [...t.messages, { ...reply, speaker: agent.mintAddress }] }));
  }
  updateThread(key, (t) => ({ ...t, sending: false, typing: undefined }));
}

/** A completed render speaks up in its owner's chat, once per video. The
 * deterministic message id also de-duplicates across account refreshes. */
export function announceReadyVideos(items: FeedItem[], agents: Agent[]) {
  if (typeof window === "undefined") return;
  const byMint = new Map(agents.map((agent) => [agent.mintAddress, agent]));
  for (const item of items) {
    if (item.state !== "generated" || !byMint.has(item.mint)) continue;
    const key = `vello_control_seen_video_${item.mint}`;
    const seenAt = Number(window.localStorage.getItem(key) ?? 0);
    // On first visit, announce only fresh work, never the entire old library.
    const cutoff = seenAt || Date.now() - 24 * 60 * 60 * 1000;
    if (item.createdAt <= cutoff) continue;
    const id = `video-ready:${item.id}`;
    if (!getThread(item.mint).messages.some((message) => message.id === id)) {
      updateThread(item.mint, (thread) => ({
        ...thread,
        messages: [...thread.messages, {
          id, role: "assistant", at: item.createdAt, fresh: true,
          content: `My video **${item.title || "Untitled"}** is ready. Take a look and tell me what to refine or where to schedule it.`,
          showVideos: { count: 1, filter: "ready", sort: "recent" },
        }],
      }));
    }
    window.localStorage.setItem(key, String(Math.max(cutoff, item.createdAt)));
  }
}

/* ════════ Mission runner ════════ */

const TERMINAL: StepStatus[] = ["skipped", "posted", "rejected", "failed"];

function findPlanMessage(key: string, msgId: string): ChatMessage | undefined {
  return getThread(key).messages.find((m) => m.id === msgId && m.plan);
}

export function updatePlan(key: string, msgId: string, fn: (p: Plan) => Plan) {
  updateThread(key, (t) => ({
    ...t,
    messages: t.messages.map((m) => (m.id === msgId && m.plan ? { ...m, plan: fn(m.plan) } : m)),
  }));
}
function patchStep(key: string, msgId: string, stepId: string, patch: Partial<PlanStep>) {
  updatePlan(key, msgId, (p) => ({ ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }));
}

/** The agent speaks up in the thread (team chats tag the speaker). */
function narrate(key: string, agentMint: string, content: string) {
  const isTeam = key.startsWith("team:");
  updateThread(key, (t) => ({
    ...t,
    messages: [...t.messages, {
      id: `${Date.now()}-n${Math.random().toString(36).slice(2, 5)}`,
      role: "assistant",
      content,
      at: Date.now(),
      fresh: true,
      ...(isTeam ? { speaker: agentMint } : {}),
    }],
  }));
}

/** Toggle a step in or out of a plan that hasn't been approved yet. */
export function toggleStep(key: string, msgId: string, stepId: string) {
  updatePlan(key, msgId, (p) => p.status !== "proposed" ? p : ({
    ...p,
    steps: p.steps.map((s) => (s.id === stepId ? { ...s, status: s.status === "skipped" ? "proposed" : "skipped" } : s)),
  }));
}

export function cancelPlan(key: string, msgId: string) {
  updatePlan(key, msgId, (p) => (p.status === "proposed" ? { ...p, status: "cancelled" } : p));
}

/** Owner approved: queue every kept step and start whatever can run now. */
export function approvePlan(key: string, msgId: string) {
  updatePlan(key, msgId, (p) => p.status !== "proposed" ? p : ({
    ...p,
    status: "running",
    steps: p.steps.map((s) => (s.status === "proposed" ? { ...s, status: "queued" } : s)),
  }));
  void advancePlan(key, msgId);
}

/** Redo a failed / rejected step from scratch. */
export function retryStep(key: string, msgId: string, stepId: string) {
  updatePlan(key, msgId, (p) => ({
    ...p,
    status: "running",
    steps: p.steps.map((s) => (s.id === stepId
      ? { ...s, status: "queued", taskId: undefined, clipJobIds: undefined, results: undefined, error: undefined }
      : s)),
  }));
  void advancePlan(key, msgId);
}

const starting = new Set<string>(); // `${msgId}:${stepId}` — no double starts

/** Start every queued step whose inputs are ready; fail hand-offs whose source
 *  will never exist; close the plan when everything is resolved. */
export async function advancePlan(key: string, msgId: string) {
  const msg = findPlanMessage(key, msgId);
  if (!msg?.plan || msg.plan.status !== "running") return;
  const steps = msg.plan.steps;

  for (const st of steps) {
    if (st.status !== "queued") continue;
    const tag = `${msgId}:${st.id}`;
    if (starting.has(tag)) continue;
    const sourceUrl = st.sourceUrl;
    if (st.kind === "clip_video" && st.sourceStep !== undefined) {
      patchStep(key, msgId, st.id, { status: "failed", error: "This hand-off uses an Influencer short. Choose a long-form campaign source or supply a video URL instead." });
      continue;
    }
    starting.add(tag);
    void startStep(key, msgId, st, sourceUrl).finally(() => starting.delete(tag));
  }

  const latest = findPlanMessage(key, msgId)?.plan;
  if (latest && latest.status === "running" && latest.steps.every((s) => TERMINAL.includes(s.status))) {
    updatePlan(key, msgId, (p) => ({ ...p, status: "done" }));
    const posted = latest.steps.reduce((n, s) => n + (s.results?.filter((r) => r.status === "posted").length ?? 0), 0);
    const failed = latest.steps.filter((s) => s.status === "failed").length;
    const lead = latest.steps[0]?.agentMint;
    if (lead) {
      narrate(key, lead, posted
        ? `Mission **${latest.title}** is wrapped: ${posted} video${posted === 1 ? "" : "s"} scheduled to post${failed ? `, ${failed} step${failed === 1 ? "" : "s"} couldn't finish` : ""}. Want me to plan the next one?`
        : `Mission **${latest.title}** is closed, nothing was posted this time. Tell me what to change and I'll plan it again.`);
    }
  }
}

async function startStep(key: string, msgId: string, st: PlanStep, sourceUrl?: string) {
  patchStep(key, msgId, st.id, { status: "starting", startedAt: Date.now(), error: undefined, ...(sourceUrl ? { sourceUrl } : {}) });
  try {
    const isClip = st.kind === "clip_video";
    const res = await fetch("/api/agents/run-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mintAddress: st.agentMint,
        taskType: isClip ? "clip_source" : "create_video",
        title: isClip ? `Clip for mission` : `Create video: ${st.topic ?? "mission"}`,
        triggeredBy: "user",
        input: isClip
          ? { sourceUrl, ...(st.campaignId ? { campaignId: st.campaignId } : {}), holdForApproval: true }
          : { topic: st.topic, ...(st.campaignId ? { campaignId: st.campaignId } : {}), ...(st.why ? { brief: st.why } : {}), holdForApproval: true },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.ok === false || data?.error) {
      const reason = String(data?.error ?? data?.message ?? `HTTP ${res.status}`);
      throw new Error(res.status === 402 ? `Not enough balance in ${st.agentName}'s wallet to run this. Top it up and hit Retry.` : reason);
    }
    if (isClip) {
      const jobIds = Array.isArray(data?.output?.jobIds) ? data.output.jobIds.map(String) : [];
      if (!jobIds.length) throw new Error(String(data?.output?.note ?? "Clipping didn't start."));
      patchStep(key, msgId, st.id, { status: "running", clipJobIds: jobIds, ...(data.taskId ? { taskId: String(data.taskId) } : {}) });
    } else {
      if (!data?.taskId) throw new Error("The video task didn't start.");
      patchStep(key, msgId, st.id, { status: "running", taskId: String(data.taskId) });
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Couldn't start.";
    patchStep(key, msgId, st.id, { status: "failed", error: reason });
    narrate(key, st.agentMint, `I couldn't start ${st.kind === "clip_video" ? "the clips" : `"${st.topic ?? "the video"}"`}: ${reason}`);
    void advancePlan(key, msgId);
  }
}

/** Live status from the watchers (Convex subscriptions in the card). */
export function reportVideoTask(key: string, msgId: string, stepId: string, s: { status: string; videoUrl?: string; posterUrl?: string; error?: string }) {
  const st = findPlanMessage(key, msgId)?.plan?.steps.find((x) => x.id === stepId);
  if (!st || st.status !== "running") return;
  if (s.status === "succeeded" && s.videoUrl) {
    patchStep(key, msgId, stepId, {
      status: "review",
      results: [{ videoUrl: s.videoUrl, title: st.topic ?? "Video", caption: st.topic ?? "", status: "review" }],
    });
    narrate(key, st.agentMint, `My video for **${st.topic ?? "the mission"}** is ready. Check it below. Tweak the caption, pick where it goes, and approve it when you're happy. Nothing posts until you do.`);
    void advancePlan(key, msgId);
  } else if (s.status === "failed" || s.status === "cancelled" || (s.status === "succeeded" && !s.videoUrl)) {
    const reason = s.error || (s.status === "succeeded" ? "The render finished without a video." : "The render failed.");
    patchStep(key, msgId, stepId, { status: "failed", error: reason });
    narrate(key, st.agentMint, `The video for **${st.topic ?? "the mission"}** didn't come out: ${reason} Hit Retry and I'll run it again.`);
    void advancePlan(key, msgId);
  }
}

export function reportClipJobs(
  key: string, msgId: string, stepId: string,
  jobs: Array<{ status: string; error?: string }>,
  clips: Array<{ clipUrl?: string; title?: string; captionText?: string; status: string }>,
) {
  const st = findPlanMessage(key, msgId)?.plan?.steps.find((x) => x.id === stepId);
  if (!st || st.status !== "running" || !jobs.length) return;
  const settled = jobs.every((j) => j.status === "completed" || j.status === "error");
  if (!settled) return;
  const ready = clips.filter((c) => c.status === "ready" && c.clipUrl);
  if (ready.length) {
    patchStep(key, msgId, stepId, {
      status: "review",
      results: ready.slice(0, 8).map((c) => ({
        videoUrl: c.clipUrl!, title: (c.title || "Clip").slice(0, 120), caption: c.captionText || c.title || "", status: "review" as const,
      })),
    });
    narrate(key, st.agentMint, `Clipped it: **${ready.length} clip${ready.length === 1 ? "" : "s"}** ready for you below. Approve the ones you like and I'll post them. Skip the rest.`);
  } else {
    const reason = jobs.find((j) => j.error)?.error ?? "No clips came out of that video.";
    patchStep(key, msgId, stepId, { status: "failed", error: reason });
    narrate(key, st.agentMint, `No usable clips this time: ${reason}`);
  }
  void advancePlan(key, msgId);
}

/* ── Approve → post ─────────────────────────────────────────────────────── */

async function schedulePost(mint: string, item: ReviewItem, platforms: string[]): Promise<void> {
  const res = await fetch("/api/schedule/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mintAddress: mint,
      sessionId: mint,
      // The drip cron (every 5 min) publishes it — first slot ~2 minutes out.
      scheduledFor: Date.now() + 120_000,
      topic: item.title.slice(0, 200),
      caption: item.caption,
      platforms,
      videoUrl: item.videoUrl,
    }),
  });
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (await res.json().catch(() => ({}))) as any;
    throw new Error(String(d?.error ?? `Scheduling failed (${res.status})`));
  }
}

function setResult(key: string, msgId: string, stepId: string, idx: number, patch: Partial<ReviewItem>) {
  updatePlan(key, msgId, (p) => ({
    ...p,
    steps: p.steps.map((s) => {
      if (s.id !== stepId || !s.results) return s;
      const results = s.results.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      // The step resolves once every result is decided.
      const open = results.some((r) => r.status === "review" || r.status === "posting");
      const status: StepStatus = open ? (results.some((r) => r.status === "posting") ? "posting" : "review")
        : results.some((r) => r.status === "posted") ? "posted" : "rejected";
      return { ...s, results, status };
    }),
  }));
}

export async function approveResult(key: string, msgId: string, stepId: string, idx: number, edit: { caption: string; platforms: string[] }) {
  const st = findPlanMessage(key, msgId)?.plan?.steps.find((x) => x.id === stepId);
  const item = st?.results?.[idx];
  if (!st || !item || item.status !== "review") return;
  setResult(key, msgId, stepId, idx, { status: "posting", caption: edit.caption, platforms: edit.platforms, error: undefined });
  try {
    await schedulePost(st.agentMint, { ...item, caption: edit.caption }, edit.platforms);
    setResult(key, msgId, stepId, idx, { status: "posted" });
  } catch (e) {
    setResult(key, msgId, stepId, idx, { status: "review", error: e instanceof Error ? e.message : "Couldn't schedule it." });
  }
  void advancePlan(key, msgId);
}

export function rejectResult(key: string, msgId: string, stepId: string, idx: number) {
  setResult(key, msgId, stepId, idx, { status: "rejected" });
  void advancePlan(key, msgId);
}

/* Post proposals (existing videos the agent offered to publish). */
function setProposalItem(key: string, msgId: string, idx: number, patch: Partial<ReviewItem>) {
  updateThread(key, (t) => ({
    ...t,
    messages: t.messages.map((m) => (m.id === msgId && m.postProposal
      ? { ...m, postProposal: { ...m.postProposal, items: m.postProposal.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } }
      : m)),
  }));
}
export async function approveProposal(key: string, msgId: string, idx: number, edit: { caption: string; platforms: string[] }) {
  const m = getThread(key).messages.find((x) => x.id === msgId);
  const item = m?.postProposal?.items[idx];
  if (!m?.postProposal || !item || item.status !== "review") return;
  setProposalItem(key, msgId, idx, { status: "posting", caption: edit.caption, platforms: edit.platforms, error: undefined });
  try {
    await schedulePost(m.postProposal.mint, { ...item, caption: edit.caption }, edit.platforms);
    setProposalItem(key, msgId, idx, { status: "posted" });
  } catch (e) {
    setProposalItem(key, msgId, idx, { status: "review", error: e instanceof Error ? e.message : "Couldn't schedule it." });
  }
}
export function rejectProposal(key: string, msgId: string, idx: number) {
  setProposalItem(key, msgId, idx, { status: "rejected" });
}
