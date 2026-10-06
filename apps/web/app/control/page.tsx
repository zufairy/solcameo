"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { AppHeaderShell } from "@/components/home/app-shell";
import {
  ArrowDown, ArrowLeft, ArrowUp, CalendarClock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Cloud, CloudOff, ExternalLink, LayoutGrid,
  LayoutDashboard, Loader2, Maximize2, MessagesSquare, Monitor, PanelLeftClose, PanelLeftOpen, Play, Search, Sparkles, SquarePen, Trash2, Users, Wand2, X,
} from "lucide-react";
import {
  type Agent, type ChatMessage, type FeedItem, type Team, type VideoFilter,
  TAB_LABEL, agentKind, announceReadyVideos, configureSync, setTeamBrief, deleteTeam, getThread, hydrate, markSeen, sendToAgent, sendToTeam,
  teamKey, updateThread, useStoreVersion, useSyncState, useTeams, useThread,
} from "@/components/control/store";
import {
  Avatar, CONTROL_GLASS_ACTION, ITEM, POP, SPRING, STAGGER, Stat, StateBadge, TeamAvatar, ThinkingLabel, TypedMarkdown, TypingDots,
  formatWhen, previewOf, usd,
} from "@/components/control/ui";
import { VideoLightboxProvider, useVideoLightbox } from "@/components/control/VideoLightbox";
import { AgentTaskActivity } from "@/components/control/AgentTaskActivity";
import { CreateMenu } from "@/components/control/CreateMenu";
import { Button } from "@/components/ui/button";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { DeleteAgentButton } from "@/components/agents/delete-agent-button";
import { MyAgentsDashboard } from "@/components/studio/MyAgentsDashboard";
import { PlanCard, ProposalCard } from "@/components/control/MissionCard";
import { ShareOnX } from "@/components/control/ShareOnX";
import { ConnectInfluencerX } from "@/components/control/ConnectInfluencerX";
import { ConnectedPlatformStack } from "@/components/social/platform-icons";

/* ════════ /control — the master control panel ════════
   Talk to every agent you own — alone or as a team — in its own persona, from
   one screen. Replies come from /api/agents/chat (surface: "control"): agents act
   for real (post, join campaigns, edit their show plan, save ideas), render their
   real videos as cards and hand you to the right Builder tab. In a team chat the
   members answer in turn, each seeing what its teammates just said. */

const AGENT_SUGGESTIONS = [
  "Show me your latest videos",
  "What did you post this week?",
  "What are you making next?",
  "Make a video for this week",
  "Post your latest video",
  "Open my posting schedule",
];
const TEAM_SUGGESTIONS = [
  "Plan a mission for our brief",
  "Stand-up: what did each of you make, and what's next?",
  "Show me everyone's latest videos",
  "Introduce yourselves and what you each do",
];

type Selection = { kind: "agent"; id: string } | { kind: "team"; id: string };

export default function ControlPanelPage() {
  return (
    <VideoLightboxProvider>
      <ControlPanel />
    </VideoLightboxProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-6 text-center">{children}</div>;
}

/** Wires the store to the account's Convex copy: first load, then refresh on
 *  focus / tab return and every 30s while visible, so another device's chats
 *  and teams show up here too. */
function useAccountSync(enabled: boolean) {
  const { getFreshToken } = useSupabaseAuth();
  const bootstrap = useAction(api.controlPanel.bootstrap);
  const saveThread = useAction(api.controlPanel.saveThread);
  const saveTeam = useAction(api.controlPanel.saveTeam);
  const removeTeam = useAction(api.controlPanel.deleteTeam);

  useEffect(() => {
    if (!enabled) return;
    configureSync({ getToken: getFreshToken, bootstrap, saveThread, saveTeam, deleteTeam: removeTeam });
    void hydrate();
    const refresh = () => { if (document.visibilityState === "visible") void hydrate(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      configureSync(null);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [enabled, getFreshToken, bootstrap, saveThread, saveTeam, removeTeam]);
}

function ControlPanel() {
  const { profile, authenticated, loading, login } = useSupabaseAuth();
  const { publicKey } = useUnifiedSolanaWallet();
  const activeWallet = publicKey?.toBase58();
  useAccountSync(authenticated);
  const syncState = useSyncState();
  const reduceMotion = useReducedMotion();
  const wallets = useMemo(
    () => [...new Set([...(profile?.walletAddresses ?? []), profile?.walletAddress, activeWallet].filter((w): w is string => !!w))],
    [profile?.walletAddresses, profile?.walletAddress, activeWallet],
  );
  const agents = useQuery(api.influencers.listByCreators, wallets.length ? { creatorWallets: wallets, liveNetwork: "mainnet" } : "skip") as Agent[] | undefined;
  const agentsList = useMemo(() => agents ?? [], [agents]);
  const changes = useChange24h(agentsList);
  const allFeed = useQuery(api.clipJobs.videoFeedByMints, agents?.length ? { mintAddresses: agents.map((agent) => agent.mintAddress).slice(0, 25) } : "skip");
  const allTeams = useTeams();
  useStoreVersion(); // re-render the sidebar as threads change (previews, "typing…")

  useEffect(() => {
    if (syncState === "synced" && agents && allFeed) announceReadyVideos(allFeed.items, agents);
  }, [syncState, agents, allFeed]);

  const byMint = useMemo(() => new Map((agents ?? []).map((a) => [a.mintAddress, a])), [agents]);
  // Only teams whose members you still own (and at least two of them).
  const teams = useMemo(
    () => allTeams.filter((t) => t.memberMints.filter((m) => byMint.has(m)).length >= 2),
    [allTeams, byMint],
  );

  const [selected, setSelected] = useState<Selection | null>(null);
  const [search, setSearch] = useState("");
  const [screenOpen, setScreenOpen] = useState(true);
  // Phone: the main pane (dashboard or a chat) is always what's showing; the
  // chat list is a slide-in drawer on top of it.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  // Hide the agent list (collapses to a slim avatar rail). Remembered per browser.
  const [listHidden, setListHidden] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setListHidden(localStorage.getItem(LIST_HIDDEN_KEY) === "1"); } catch { /* private mode */ }
  }, []);
  const toggleList = useCallback(() => {
    setListHidden((h) => {
      try { localStorage.setItem(LIST_HIDDEN_KEY, h ? "0" : "1"); } catch { /* private mode */ }
      return !h;
    });
  }, []);

  // Opens on the DASHBOARD (no chat selected). Only a deep link
  // (?agent=<mint> / ?team=<id>) opens straight into a chat.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!agents?.length || deepLinked.current) return;
    const params = new URLSearchParams(window.location.search);
    const wantedTeam = params.get("team");
    const wanted = params.get("agent");
    if (wantedTeam && teams.some((t) => t.id === wantedTeam)) {
      deepLinked.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected({ kind: "team", id: wantedTeam });
    } else if (wanted && agents.some((a) => a.mintAddress === wanted)) {
      deepLinked.current = true;
      setSelected({ kind: "agent", id: wanted });
    }
  }, [agents, teams]);

  const select = useCallback((s: Selection) => { setSelected(s); setDrawerOpen(false); }, []);
  const openDashboard = useCallback(() => { setSelected(null); setDrawerOpen(false); }, []);

  const q = search.trim().toLowerCase();
  const visibleAgents = (agents ?? []).filter((a) =>
    !q || a.name.toLowerCase().includes(q) || (a.handle ?? "").toLowerCase().includes(q) || (a.niche ?? "").toLowerCase().includes(q));
  const visibleTeams = teams.filter((t) => !q || t.name.toLowerCase().includes(q));
  const recentChats = [
    ...visibleTeams.map((team) => ({ key: teamKey(team.id), kind: "team" as const, team })),
    ...visibleAgents.map((agent) => ({ key: agent.mintAddress, kind: "agent" as const, agent })),
  ].sort((a, b) => {
    const lastAt = (key: string) => getThread(key).messages.at(-1)?.at ?? 0;
    return lastAt(b.key) - lastAt(a.key);
  });

  // Resolve the open chat → its members.
  const current = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === "team") {
      const team = teams.find((t) => t.id === selected.id);
      if (!team) return null;
      return { key: teamKey(team.id), team, members: team.memberMints.map((m) => byMint.get(m)).filter((a): a is Agent => !!a) };
    }
    const agent = byMint.get(selected.id);
    return agent ? { key: agent.mintAddress, team: undefined, members: [agent] } : null;
  }, [selected, teams, byMint]);

  let body: React.ReactNode;
  if (loading || (authenticated && wallets.length > 0 && agents === undefined)) {
    body = <Centered><Loader2 className="size-5 animate-spin text-zinc-600" /></Centered>;
  } else if (!authenticated) {
    body = (
      <Centered>
        <p className="text-[15px] font-semibold text-white">Connect your wallet to talk to your agents</p>
        <button onClick={login} className="mt-3 rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black hover:bg-zinc-200">Connect wallet</button>
      </Centered>
    );
  } else {
    // No agents yet still gets the full control panel — sidebar + dashboard —
    // with an onboarding card in place of the chat list, so it reads as the
    // product waiting for its first agent instead of a blank screen.
    const agents = agentsList;
    body = (
      <div className="flex h-full min-h-0">
        {/* Phone: dimmed backdrop behind the chat drawer — tap to close. */}
        <AnimatePresence>
          {drawerOpen && (
            <motion.div
              key="drawer-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-[65] bg-black/60 backdrop-blur-sm md:hidden"
              aria-hidden
            />
          )}
        </AnimatePresence>
        {/* ── Left: teams + agents (desktop column · phone slide-in drawer) ── */}
        <motion.aside
          animate={{ width: listHidden ? 76 : 300 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Chats"
          className={`flex flex-col overflow-hidden border-r border-white/[0.06] bg-[#181a1c] md:shrink-0
            max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[70] max-md:!w-[86vw] max-md:max-w-[340px] max-md:shadow-2xl max-md:shadow-black/70
            max-md:transition-transform max-md:duration-300 max-md:ease-[cubic-bezier(0.22,1,0.36,1)]
            ${drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"}`}
        >
          {listHidden ? (
            <div className="hidden flex-col items-center gap-2 p-3 md:flex">
              <IconRailButton label="Show agents" onClick={toggleList}><PanelLeftOpen className="size-4" /></IconRailButton>
              <CreateMenu agents={agents} onTeamCreated={(t) => select({ kind: "team", id: t.id })} />
            </div>
          ) : null}
          <div className={`${listHidden ? "md:hidden" : ""} flex items-center gap-2 p-3`}>
            <IconRailButton label="Hide agents" onClick={toggleList} className="hidden md:grid"><PanelLeftClose className="size-4" /></IconRailButton>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="h-10 w-full rounded-xl border border-white/[0.07] bg-white/[0.04] pl-9 pr-3 text-[14px] text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-white/20"
              />
            </div>
            <CreateMenu agents={agents} onTeamCreated={(t) => select({ kind: "team", id: t.id })} />
          </div>
          <motion.div layout className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            <DashboardRow active={!selected} compact={listHidden} onClick={openDashboard} count={agents.length} />
            {recentChats.map((chat) => {
              if (chat.kind === "team") {
                const t = chat.team;
                const members = t.memberMints.map((m) => byMint.get(m)).filter((a): a is Agent => !!a);
                return <SidebarRow key={chat.key} compact={listHidden} active={selected?.kind === "team" && selected.id === t.id} threadKey={chat.key}
                  avatar={<TeamAvatar members={members} />} title={t.name} badge={`${members.length} agents`}
                  fallback={members.map((m) => m.name).join(", ")} typingName={(mint) => byMint.get(mint)?.name}
                  onClick={() => select({ kind: "team", id: t.id })} />;
              }
              const a = chat.agent;
              return <SidebarRow key={chat.key} compact={listHidden} active={selected?.kind === "agent" && selected.id === a.mintAddress}
                threadKey={chat.key} avatar={<Avatar agent={a} />} title={a.name} change={<Change24h pct={changes[String(a.solstarCharacterId)]} />}
                fallback={a.niche || `@${a.handle}`} onClick={() => select({ kind: "agent", id: a.mintAddress })} />;
            })}
            {agents.length === 0 ? (
              <div className={`${listHidden ? "md:hidden" : ""} px-2 py-4`}>
                <Button nativeButton={false} render={<Link href="/create" />} className="h-8 w-full rounded-lg bg-[#d7ff00] text-xs font-medium text-black shadow-none hover:bg-[#e4ff59]">Create AI influencer</Button>
              </div>
            ) : visibleAgents.length === 0 && visibleTeams.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-zinc-600">No matches.</p>}
          </motion.div>
          <div className={`${listHidden ? "md:hidden" : ""} border-t border-white/[0.06] p-2`}>
            <div className="flex items-center gap-2">
              <Link href="/agents" className="flex flex-1 items-center gap-3 rounded-xl px-2.5 py-2.5 text-[14px] text-zinc-300 transition-colors hover:bg-white/[0.04]">
                <span className="grid size-9 place-items-center rounded-full bg-white/[0.06]"><LayoutGrid className="size-4" /></span>
                Marketplace
              </Link>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={syncState}
                  initial={{ opacity: 0, filter: "blur(3px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(3px)" }}
                  title={syncState === "offline" ? "Can't reach your account, changes are kept here and retried" : "Chats and teams are saved to your account"}
                  className={`flex items-center gap-1 pr-2 text-[11px] ${syncState === "offline" ? "text-amber-400" : "text-zinc-600"}`}
                >
                  {syncState === "offline" ? <CloudOff className="size-3.5" /> : syncState === "syncing" ? <Loader2 className="size-3.5 animate-spin" /> : <Cloud className="size-3.5" />}
                  {syncState === "offline" ? "Offline" : syncState === "syncing" ? "Syncing" : "Synced"}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </motion.aside>

        <div className="flex min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            {!current && (
              <motion.div
                key="dashboard"
                className="min-w-0 flex-1 overflow-y-auto"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, filter: "blur(6px)" }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Phone: open the chat drawer from the dashboard. */}
                <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-white/[0.06] bg-[#181a1c]/90 px-3 py-2.5 backdrop-blur-xl md:hidden">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setDrawerOpen(true)}
                    className="relative inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[13px] font-medium text-white"
                  >
                    <MessagesSquare className="size-4" /> Chats
                    <span className="rounded-full bg-white/10 px-1.5 text-[11px] text-zinc-300">{recentChats.length}</span>
                    {recentChats.some((c) => getThread(c.key).sending) && (
                      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-[#181a1c] bg-emerald-400" />
                    )}
                  </motion.button>
                  <span className="ml-auto text-[12px] text-zinc-500">Dashboard</span>
                </div>
                <MyAgentsDashboard embedded onChat={(mint) => select({ kind: "agent", id: mint })} />
              </motion.div>
            )}
            {current && (
              <motion.div
                key={current.key}
                className="flex min-w-0 flex-1"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 14, filter: "blur(6px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10, filter: "blur(6px)" }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <ChatView
                  threadKey={current.key}
                  team={current.team}
                  members={current.members}
                  screenOpen={screenOpen}
                  onToggleScreen={() => setScreenOpen((o) => !o)}
                  onBack={() => setDrawerOpen(true)}
                  onSelectAgent={(mint) => select({ kind: "agent", id: mint })}
                  onTeamDeleted={() => setSelected(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <AppHeaderShell>
      <div className="h-full min-h-0 flex-1 overflow-hidden bg-[#202326]">{body}</div>
    </AppHeaderShell>
  );
}

const LIST_HIDDEN_KEY = "vello_control_list_hidden";

function IconRailButton({ label, onClick, children, className = "grid" }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick} title={label} aria-label={label}
      className={`${className} size-10 shrink-0 place-items-center rounded-xl text-zinc-400 transition-colors hover:bg-white/5 hover:text-white`}>
      {children}
    </motion.button>
  );
}

/** Top row of the sidebar — the My Agents dashboard (the panel's home). */
function DashboardRow({ active, compact, onClick, count }: { active: boolean; compact: boolean; onClick: () => void; count: number }) {
  return (
    <motion.button
      layout="position"
      transition={SPRING}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      title="Dashboard"
      className={`relative flex w-full items-center rounded-xl py-2.5 text-left transition-colors hover:bg-white/[0.04] ${compact ? "md:justify-center md:px-0" : ""} gap-3 px-2.5`}
    >
      {active && <motion.span layoutId="control-active-row" transition={SPRING} className="absolute inset-0 rounded-xl bg-white/[0.08]" />}
      <span className="relative grid size-11 shrink-0 place-items-center rounded-full border border-white/10 bg-gradient-to-b from-white/[0.12] to-white/[0.03]">
        <LayoutDashboard className="size-5 text-white/80" />
      </span>
      <div className={`relative min-w-0 flex-1 ${compact ? "md:hidden" : ""}`}>
        <span className="block truncate text-[15px] font-medium text-white">Dashboard</span>
        <span className="block truncate text-[13px] text-zinc-500">{count} agent{count === 1 ? "" : "s"}</span>
      </div>
    </motion.button>
  );
}

/** 24h market-cap move of each agent's live token, keyed by Solstar character id. */
function useChange24h(agents: Agent[]) {
  const ids = agents.map((a) => a.solstarCharacterId).filter((id): id is NonNullable<typeof id> => !!id).map(String).join(",");
  const [changes, setChanges] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      const results = await Promise.all(ids.split(",").map(async (id) => {
        try {
          const res = await fetch(`/api/meteora/pool?characterId=${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" });
          const data = await res.json();
          return [id, data.available && typeof data.change24hPct === "number" ? data.change24hPct : null] as const;
        } catch { return null; }
      }));
      if (!controller.signal.aborted) setChanges((prev) => ({ ...prev, ...Object.fromEntries(results.filter((r) => r !== null)) }));
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [ids]);
  return changes;
}

function Change24h({ pct }: { pct?: number | null }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span title="Change in market cap, last 24 hours" className={`flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${up ? "text-[#d7ff00]" : "text-red-400"}`}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{Math.abs(pct).toFixed(2)}%
    </span>
  );
}

function SidebarRow({ active, compact = false, threadKey, avatar, title, badge, change, fallback, typingName, onClick }: {
  active: boolean;
  compact?: boolean;
  threadKey: string;
  avatar: React.ReactNode;
  title: string;
  badge?: string;
  change?: React.ReactNode;
  fallback: string;
  typingName?: (mint: string) => string | undefined;
  onClick: () => void;
}) {
  const t = getThread(threadKey);
  const last = t.messages[t.messages.length - 1];
  const who = t.typing && typingName ? typingName(t.typing) : undefined;
  return (
    <motion.button
      layout="position"
      transition={SPRING}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      title={compact ? title : undefined}
      className={`relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] ${compact ? "md:justify-center md:px-0" : ""}`}
    >
      {active && <motion.span layoutId="control-active-row" transition={SPRING} className="absolute inset-0 rounded-xl bg-white/[0.08]" />}
      <span className="relative">
        {avatar}
        {compact && t.sending && <span className="absolute -right-0.5 -top-0.5 hidden size-3 rounded-full border-2 border-[#181a1c] bg-emerald-400 md:block" />}
      </span>
      <div className={`relative min-w-0 flex-1 ${compact ? "md:hidden" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium text-white">{title}</span>
          {badge && <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-zinc-400">{badge}</span>}
          {change && <span className="ml-auto shrink-0">{change}</span>}
        </div>
        {t.sending ? (
          <p className="flex items-center gap-1.5 truncate text-[13px] text-[#d7ff00]">{who ? `${who} is typing` : "typing"} <TypingDots /></p>
        ) : (
          <p className="truncate text-[13px] text-zinc-500">{last ? previewOf(last.content) || "Sent videos" : fallback}</p>
        )}
      </div>
    </motion.button>
  );
}

/* ════════ One chat (agent or team) + its screen ════════ */
function ChatView({ threadKey, team, members, screenOpen, onToggleScreen, onBack, onSelectAgent, onTeamDeleted }: {
  threadKey: string;
  team?: Team;
  members: Agent[];
  screenOpen: boolean;
  onToggleScreen: () => void;
  onBack: () => void;
  onSelectAgent: (mint: string) => void;
  onTeamDeleted: () => void;
}) {
  const lead = members[0];
  const isTeam = !!team;
  const title = team?.name ?? lead.name;
  const mints = useMemo(() => members.map((m) => m.mintAddress), [members]);
  const feed = useQuery(api.clipJobs.videoFeedByMints, { mintAddresses: mints });
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getTime();
  const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1).getTime() - 1;
  const scheduled = useQuery(api.scheduledContent.listByMintsInRange, { mintAddresses: mints, startMs: monthStart, endMs: monthEnd }) ?? [];
  const videos = useMemo(() => [...(feed?.items ?? [])].sort((a, b) => b.createdAt - a.createdAt), [feed]);
  const byMint = useMemo(() => new Map(members.map((m) => [m.mintAddress, m])), [members]);
  const { messages, sending, typing } = useThread(threadKey);
  const openVideo = useVideoLightbox();

  const [input, setInput] = useState("");
  const [screenIdx, setScreenIdx] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);

  // Follow the conversation while pinned to the bottom — including while a
  // reply types itself out or video cards pop in (any content growth).
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    scroller.scrollTop = scroller.scrollHeight;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const jumpToBottom = useCallback(() => {
    atBottomRef.current = true;
    setAtBottom(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setMenuOpen(false);
    jumpToBottom();
    if (team) void sendToTeam(team, members, text);
    else void sendToAgent(lead, text);
  };

  const newChat = () => updateThread(threadKey, (t) => ({ ...t, messages: [] }));
  const suggestions = isTeam ? TEAM_SUGGESTIONS : AGENT_SUGGESTIONS;
  const typingAgent = typing ? byMint.get(typing) ?? lead : lead;
  const screenVideo = videos[Math.min(screenIdx, Math.max(0, videos.length - 1))] ?? null;

  return (
    <>
      {/* ── Chat ── */}
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-3 md:px-5">
          <button onClick={onBack} className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 md:hidden" aria-label="Back"><ArrowLeft className="size-4" /></button>
          <button onClick={() => setProfileOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left transition-opacity hover:opacity-90" aria-label={`Open ${title} profile`}>
            {isTeam ? <TeamAvatar members={members} size={32} /> : <Avatar agent={lead} size={30} />}
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-tight text-white">{title}</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={sending ? `typing-${typing ?? ""}` : "idle"}
                  initial={{ opacity: 0, y: 3, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -3, filter: "blur(3px)" }}
                  transition={{ duration: 0.16 }}
                  className={`block truncate text-[11.5px] leading-tight ${sending ? "text-[#d7ff00]" : "text-zinc-500"}`}
                >
                  {sending ? (isTeam ? `${typingAgent.name} is typing…` : "typing…") : isTeam ? members.map((m) => m.name).join(", ") : `${agentKind(lead)} · tap for profile`}
                </motion.span>
              </AnimatePresence>
            </span>
          </button>
          {!isTeam && <div className="flex flex-col gap-1 lg:hidden"><ConnectInfluencerX key={lead.mintAddress} mint={lead.mintAddress} name={lead.name} compact /><ShareOnX mint={lead.mintAddress} name={lead.name} compact /></div>}
          <IconButton label="New chat" onClick={newChat}><SquarePen className="size-4" /></IconButton>
          {!isTeam && (<>
            <Link href={`/builder?mint=${encodeURIComponent(lead.mintAddress)}`} title="Open in Builder" aria-label="Open in Builder" className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"><Wand2 className="size-4" /></Link>
          </>)}
          <span className="hidden lg:block">
            <IconButton label={screenOpen ? "Hide screen" : "Show screen"} onClick={onToggleScreen}>
              {screenOpen ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </IconButton>
          </span>
        </header>

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              atBottomRef.current = bottom;
              setAtBottom(bottom);
            }}
            className="h-full overflow-y-auto overflow-x-hidden px-3 py-5 md:px-6"
          >
            <div ref={contentRef} className="mx-auto max-w-3xl space-y-4">
              {messages.length === 0 && !sending && (
                <motion.div variants={STAGGER} initial="hidden" animate="show" className="flex flex-col items-center pt-10 text-center">
                  <motion.button variants={ITEM} onClick={() => setProfileOpen(true)} aria-label="Open profile">
                    {isTeam ? <TeamAvatar members={members} size={72} /> : <Avatar agent={lead} size={64} />}
                  </motion.button>
                  <motion.p variants={ITEM} className="mt-3 text-[18px] font-semibold text-white">{title}</motion.p>
                  <motion.p variants={ITEM} className="mt-1 max-w-md text-[13.5px] text-zinc-500">
                    {isTeam
                      ? `${members.map((m) => m.name).join(", ")} are in this chat. Talk to everyone, or mention a name to ask one of them.`
                      : "Ask me for my videos, what I posted and when, or what I'm making next. Tell me to post, join a campaign, or change my show."}
                  </motion.p>
                  <motion.div variants={ITEM} className="mt-5 flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <motion.button
                        key={s}
                        whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }}
                        onClick={() => send(s)}
                        className="rounded-full border border-white/10 px-3.5 py-1.5 text-[12.5px] text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/5"
                      >{s}</motion.button>
                    ))}
                  </motion.div>
                </motion.div>
              )}
              <AnimatePresence initial={false}>
                {messages.map((m, i) => {
                  const speaker = m.role === "assistant" ? byMint.get(m.speaker ?? lead.mintAddress) ?? lead : lead;
                  const prev = messages[i - 1];
                  const newSpeaker = m.role === "assistant" && (prev?.role !== "assistant" || (prev.speaker ?? "") !== (m.speaker ?? ""));
                  return (
                    <MessageView
                      key={m.id}
                      m={m}
                      speaker={speaker}
                      showAvatar={newSpeaker}
                      showName={isTeam && newSpeaker}
                      videos={isTeam ? videos.filter((v) => v.mint === speaker.mintAddress) : videos}
                      onOpenVideo={openVideo}
                      onAvatar={() => (isTeam ? onSelectAgent(speaker.mintAddress) : setProfileOpen(true))}
                      onSeen={() => markSeen(threadKey, m.id)}
                      threadKey={threadKey}
                      agents={byMint}
                    />
                  );
                })}
                {sending && (
                  <motion.div
                    key={`typing-${typing ?? ""}`}
                    layout
                    initial={{ opacity: 0, y: 10, scale: 0.9, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
                    transition={SPRING}
                    style={{ originX: 0, originY: 1 }}
                    className="flex items-end gap-2"
                  >
                    <Avatar agent={typingAgent} size={28} />
                    <div className="flex items-center gap-2.5 rounded-3xl rounded-bl-md bg-[#1a1a1d] px-4 py-3">
                      <TypingDots />
                      <ThinkingLabel>{typingAgent.name} is thinking…</ThinkingLabel>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <AnimatePresence>
            {!atBottom && (
              <motion.button
                initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.9 }}
                onClick={jumpToBottom}
                className="absolute bottom-3 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-white/10 bg-[#1a1a1d]/90 text-zinc-300 shadow-lg backdrop-blur hover:text-white"
                aria-label="Scroll to latest"
              >
                <ArrowDown className="size-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <div className="shrink-0 px-3 pb-4 md:px-6">
          <div className="mx-auto max-w-3xl rounded-3xl border border-white/[0.08] bg-[#202326] p-2.5 transition-[border-color,box-shadow] duration-200 focus-within:border-white/20 focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder={isTeam ? `Message ${title}…` : `Message ${lead.name}…`}
              className="block max-h-[220px] w-full resize-none bg-transparent px-2 pt-1.5 text-[15px] text-white outline-none placeholder:text-zinc-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="relative">
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setMenuOpen((o) => !o)} className="grid size-9 place-items-center rounded-full border border-white/10 text-zinc-300 transition-colors hover:bg-white/5" aria-label="Quick actions" aria-expanded={menuOpen}>
                  <motion.span animate={{ rotate: menuOpen ? 135 : 0 }} transition={SPRING} className="grid place-items-center"><Sparkles className="size-4" /></motion.span>
                </motion.button>
                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      variants={POP} initial="hidden" animate="show" exit="exit"
                      style={{ originX: 0, originY: 1 }}
                      className="absolute bottom-11 left-0 z-10 w-72 rounded-2xl border border-white/10 bg-[#1c1c20]/95 p-1.5 shadow-xl backdrop-blur-xl"
                    >
                      <motion.div variants={STAGGER} initial="hidden" animate="show">
                        {suggestions.map((s) => (
                          <motion.button key={s} variants={ITEM} onClick={() => send(s)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-white/5">
                            <Sparkles className="size-3.5 text-lime-300" /> {s}
                          </motion.button>
                        ))}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <motion.button
                whileTap={{ scale: 0.88 }}
                animate={{ scale: input.trim() ? 1 : 0.92 }}
                onClick={() => send()}
                disabled={!input.trim() || sending}
                className="grid size-9 place-items-center rounded-full bg-white text-black transition-opacity disabled:opacity-30"
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </motion.button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {profileOpen && (
            team ? (
              <TeamSheet
                key="team-sheet"
                team={team}
                members={members}
                videos={videos}
                feedLoaded={!!feed}
                onClose={() => setProfileOpen(false)}
                onSelectAgent={(mint) => { setProfileOpen(false); onSelectAgent(mint); }}
                onOpenVideo={openVideo}
                onDelete={() => { setProfileOpen(false); deleteTeam(team.id); onTeamDeleted(); }}
              />
            ) : (
              <AgentSheet key="agent-sheet" agent={lead} videos={videos} feedLoaded={!!feed} onClose={() => setProfileOpen(false)} onOpenVideo={openVideo} />
            )
          )}
        </AnimatePresence>
      </section>

      {/* ── Right: the screen ── */}
      <AnimatePresence initial={false}>
        {screenOpen && (
          <motion.aside
            key="screen"
            initial={{ width: 0, opacity: 0 }} animate={{ width: 340, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="hidden shrink-0 overflow-hidden border-l border-white/[0.06] bg-card/50 lg:block"
          >
            <div className="h-full w-[340px] overflow-y-auto p-4">
              {!isTeam && <ConnectInfluencerX key={lead.mintAddress} mint={lead.mintAddress} name={lead.name} />}
              <div className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-background/60">
                <AnimatePresence mode="wait" initial={false}>
                  {screenVideo ? (
                    <motion.button
                      key={screenVideo.id}
                      initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(6px)" }}
                      transition={{ duration: 0.22 }}
                      onClick={() => openVideo(videos, videos.indexOf(screenVideo))}
                      className="relative block w-full"
                      aria-label="Open video player"
                    >
                      <video src={screenVideo.videoUrl} poster={screenVideo.posterUrl ?? undefined} autoPlay muted loop playsInline className="aspect-[9/16] max-h-[440px] w-full bg-black object-cover" />
                      <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/35">
                        <span className="grid size-12 scale-90 place-items-center rounded-full bg-white/20 opacity-0 backdrop-blur-md transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
                          <Maximize2 className="size-5 text-white" />
                        </span>
                      </span>
                    </motion.button>
                  ) : (
                    <div className="grid aspect-video place-items-center text-zinc-600"><Monitor className="size-6" /></div>
                  )}
                </AnimatePresence>
              </div>
              <p className="mt-2 truncate text-center text-[12.5px] text-zinc-500">
                {screenVideo ? `${screenVideo.caption ? screenVideo.caption.slice(0, 60) : "Untitled"} · ${formatWhen(screenVideo.createdAt)}` : `${title}'s screen`}
              </p>

              <VideoStats videos={videos} loaded={!!feed} />
              <div className="mt-4 flex items-center gap-2">
                {!isTeam && <ShareOnX mint={lead.mintAddress} name={lead.name} inline />}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setScheduleOpen((o) => !o)}
                  aria-expanded={scheduleOpen}
                  aria-controls="posting-schedule"
                  className={`group inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border px-3.5 text-[13px] font-semibold text-white backdrop-blur-xl transition-[background-color,border-color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_-8px_rgba(0,0,0,0.6)] ${scheduleOpen ? "border-white/50 bg-white/[0.24]" : "border-white/25 bg-white/[0.12] hover:border-white/45 hover:bg-white/[0.2]"} ${isTeam ? "flex-1" : ""}`}
                >
                  <CalendarClock className="size-3.5 transition-transform duration-300 group-hover:scale-110" />
                  Schedule
                </motion.button>
              </div>
              <AnimatePresence initial={false}>
                {scheduleOpen && (
                  <motion.div
                    id="posting-schedule"
                    key="schedule"
                    initial={{ opacity: 0, x: 44, height: 0, filter: "blur(14px)" }}
                    animate={{ opacity: 1, x: 0, height: "auto", filter: "blur(0px)", transition: { height: { duration: 0.32, ease: [0.22, 1, 0.36, 1] }, x: { type: "spring", stiffness: 260, damping: 28 }, opacity: { duration: 0.3 }, filter: { duration: 0.42 } } }}
                    exit={{ opacity: 0, x: 44, height: 0, filter: "blur(12px)", transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } }}
                    className="overflow-hidden"
                  >
                    <MiniSchedule rows={scheduled} members={members} month={calendarMonth} onMonth={setCalendarMonth} />
                  </motion.div>
                )}
              </AnimatePresence>

              {videos.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Recent videos</p>
                  <motion.div variants={STAGGER} initial="hidden" animate="show" className="grid grid-cols-3 gap-1.5">
                    {videos.slice(0, 9).map((v, i) => (
                      <Thumb key={v.id} v={v} active={screenVideo?.id === v.id} onClick={() => { setScreenIdx(i); openVideo(videos, i); }} onHover={() => setScreenIdx(i)} />
                    ))}
                  </motion.div>
                </div>
              )}

              {isTeam ? (
                <div className="mt-5 rounded-2xl border border-white/[0.07] p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-white"><Users className="size-3.5" /> Members</p>
                  <div className="mt-2 space-y-1">
                    {members.map((m) => (
                      <button key={m.mintAddress} onClick={() => onSelectAgent(m.mintAddress)} className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.05]">
                        <Avatar agent={m} size={30} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-white">{m.name}</span>
                        <span className="text-[11px] text-zinc-500">{agentKind(m)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">Mention a name (&ldquo;{members[0].name}, …&rdquo;) to ask one agent; otherwise the whole team answers in turn.</p>
                </div>
              ) : (
                <AgentTaskActivity key={lead.mintAddress} mintAddress={lead.mintAddress} />
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick} title={label} aria-label={label} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
      {children}
    </motion.button>
  );
}

/** Thumbnail <video> with no server-generated poster shows a blank/black
 *  frame in most browsers — `preload="metadata"` alone doesn't paint frame 0.
 *  Force a tiny seek once metadata loads so the decoder actually paints a
 *  real frame as the thumbnail (the standard poster-less-video trick, no
 *  canvas/dataURL needed). Only attached when there's no real posterUrl. */
function paintFirstFrameIfNoPoster(el: HTMLVideoElement | null) {
  if (!el) return;
  const seek = () => {
    if (el.readyState > 0 && el.currentTime === 0) {
      try { el.currentTime = 0.05; } catch { /* ignore */ }
    }
  };
  if (el.readyState >= 1) seek();
  else el.addEventListener("loadedmetadata", seek, { once: true });
}

function Thumb({ v, active, onClick, onHover }: { v: FeedItem; active?: boolean; onClick: () => void; onHover?: () => void }) {
  return (
    <motion.button
      variants={ITEM}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      onMouseEnter={onHover}
      aria-label={`Play ${v.caption || "video"}`}
      className={`group relative aspect-[9/16] overflow-hidden rounded-lg bg-black ring-1 transition-shadow ${active ? "ring-white/60" : "ring-white/5 hover:ring-white/25"}`}
    >
      <video src={v.videoUrl} poster={v.posterUrl ?? undefined} ref={v.posterUrl ? undefined : paintFirstFrameIfNoPoster} preload="metadata" muted playsInline className="h-full w-full object-cover" />
      <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
        <Play className="size-5 fill-white text-white opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </motion.button>
  );
}

function VideoStats({ videos, loaded }: { videos: FeedItem[]; loaded: boolean }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
      <Stat label="Videos" value={loaded ? String(videos.length) : "…"} />
      <Stat label="Posted" value={loaded ? String(videos.filter((v) => v.state === "posted").length) : "…"} />
      <Stat label="Views" value={loaded ? videos.reduce((s, v) => s + (v.viewCount ?? 0), 0).toLocaleString() : "…"} />
    </div>
  );
}

type ScheduleRow = NonNullable<ReturnType<typeof useQuery<typeof api.scheduledContent.listByMintsInRange>>>[number];

function MiniSchedule({ rows, members, month, onMonth }: {
  rows: ScheduleRow[]; members: Agent[]; month: Date; onMonth: (month: Date) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(now);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7;
  const upcoming = rows.filter((row) => (row.status === "scheduled" || row.status === "posting") && row.scheduledFor >= now - 60_000)
    .sort((a, b) => a.scheduledFor - b.scheduledFor);
  const countByDay = new Map<number, number>();
  for (const row of upcoming) {
    const day = new Date(row.scheduledFor).getDate();
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }
  const names = new Map(members.map((agent) => [agent.mintAddress, agent.name]));
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-emerald-200/15 bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl" aria-label="Posting schedule">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-white"><CalendarClock className="size-4 text-emerald-300" /> Schedule</p>
        <div className="flex items-center gap-1">
          <button title="Previous month" aria-label="Previous month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white"><ChevronLeft className="size-4" /></button>
          <span className="min-w-20 text-center text-[11px] text-zinc-300">{month.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
          <button title="Next month" aria-label="Next month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white"><ChevronRight className="size-4" /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[10px] text-zinc-500">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span key={i}>{day}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-1 text-center">
        {Array.from({ length: startOffset }, (_, i) => <span key={`empty-${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const count = countByDay.get(day) ?? 0;
          const isToday = day === today.getDate() && month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
          return <span key={day} title={count ? `${count} scheduled post${count === 1 ? "" : "s"}` : undefined} className={`mx-auto flex size-8 flex-col items-center justify-center rounded-md text-[11px] ${count ? "bg-emerald-400/15 text-emerald-100" : isToday ? "bg-white/10 text-white" : "text-zinc-500"}`}>
            {day}{count > 0 && <span className="mt-0.5 size-1 rounded-full bg-emerald-300" />}
          </span>;
        })}
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <p className="text-[10px] font-medium uppercase text-zinc-500">Next posts</p>
        {upcoming.length ? <div className="mt-1.5 space-y-2">{upcoming.slice(0, 3).map((row) => <div key={row._id} className="flex gap-2 text-[11px]">
          <span className="w-12 shrink-0 text-emerald-300">{new Date(row.scheduledFor).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <span className="min-w-0 flex-1 truncate text-zinc-300" title={row.topic}>{row.topic || "Scheduled post"}</span>
          <span className="shrink-0 text-zinc-500">{names.get(row.mintAddress) ?? "Agent"}</span>
        </div>)}</div> : <p className="mt-1.5 text-[11px] text-zinc-500">No Posts</p>}
      </div>
    </section>
  );
}

function filterVideos(videos: FeedItem[], f: VideoFilter, sort: "recent" | "views" | "viral" = "recent"): FeedItem[] {
  const list = f === "posted" ? videos.filter((v) => v.state === "posted")
    : f === "ready" ? videos.filter((v) => v.state !== "posted")
    : [...videos];
  if (sort === "views") return list.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  if (sort === "viral") return list.sort((a, b) => (b.viralScore ?? -1) - (a.viralScore ?? -1));
  return list;
}

function VideoCard({ v, onOpen }: { v: FeedItem; onOpen: () => void }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={SPRING}
      className="group grid w-full grid-cols-[minmax(100px,0.75fr)_minmax(0,1.25fr)] overflow-hidden rounded-[4px] border border-white/20 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-xl sm:grid-cols-[160px_minmax(0,1fr)]"
    >
      <button type="button" onClick={onOpen} className="relative block aspect-[9/16] w-full self-start overflow-hidden bg-black" aria-label="Open video player">
        <video src={v.videoUrl} poster={v.posterUrl ?? undefined} ref={v.posterUrl ? undefined : paintFirstFrameIfNoPoster} preload="metadata" muted playsInline className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/50 via-transparent to-transparent">
          <span className="grid size-11 place-items-center rounded-[4px] border border-white/35 bg-white/20 backdrop-blur-xl transition-transform duration-200 group-hover:scale-110">
            <Play className="ml-0.5 size-5 fill-white text-white" />
          </span>
        </span>
      </button>
      <div className="flex min-w-0 flex-col gap-2 p-3 sm:p-4">
        {/* Title → full caption/script context → what it was made from. */}
        <p className="text-[13px] font-semibold leading-snug text-white" title={v.title || undefined}>{v.title || v.caption || "Untitled"}</p>
        {v.caption && v.caption !== v.title && v.caption !== v.description && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-zinc-300">{v.caption}</p>}
        {v.description && v.description !== v.title && (
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-zinc-300" title={v.description}>{v.description}</p>
        )}
        {v.prompt && v.prompt !== v.title && (
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-[4px] border border-white/10 bg-white/[0.05] px-2 py-1.5 text-[11px] leading-relaxed text-zinc-400" title={v.prompt}>
            <span className="font-semibold uppercase tracking-wider text-zinc-600">Prompt </span>{v.prompt}
          </p>
        )}
        <p className="truncate text-[10.5px] text-zinc-500">{v.agentName}</p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="text-[10.5px] text-zinc-500">{formatWhen(v.createdAt)}</span>
          <StateBadge state={v.state} />
        </div>
        <div className="flex items-center gap-2 text-[10.5px]">
          {v.viewCount != null && <span className="text-zinc-500">{v.viewCount.toLocaleString()} views</span>}
          {typeof v.viralScore === "number" && (
            <span className={`rounded px-1 font-semibold ${v.viralScore >= 70 ? "bg-emerald-500/15 text-emerald-300" : v.viralScore >= 40 ? "bg-amber-500/15 text-amber-300" : "bg-white/[0.06] text-zinc-400"}`} title="Virality score (0-100)">
              ⚡{v.viralScore}
            </span>
          )}
          {v.postUrl && (
            <a href={v.postUrl} target="_blank" rel="noopener noreferrer" className={`${CONTROL_GLASS_ACTION} ml-auto inline-flex items-center gap-1 px-2 py-1`}>
              Open <ExternalLink className="size-2.5" />
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── One message. User bubbles spring in from the right; agent replies pop in
   from the left, type themselves out, THEN their cards/buttons follow. ── */
function MessageView({ m, speaker, showAvatar, showName, videos, onOpenVideo, onAvatar, onSeen, threadKey, agents }: {
  threadKey: string;
  agents: Map<string, Agent>;
  m: ChatMessage;
  speaker: Agent;
  showAvatar: boolean;
  showName: boolean;
  videos: FeedItem[];
  onOpenVideo: (list: FeedItem[], i: number) => void;
  onAvatar: () => void;
  onSeen: () => void;
}) {
  const [typed, setTyped] = useState(!m.fresh || !m.content);
  const handleDone = useCallback(() => { setTyped(true); onSeen(); }, [onSeen]);
  useEffect(() => {
    // Card-only reply: nothing to type — reveal extras straight away.
    if (m.fresh && !m.content) onSeen();
  }, [m.fresh, m.content, onSeen]);

  if (m.role === "user") {
    return (
      <motion.div
        layout="position"
        initial={{ opacity: 0, y: 12, scale: 0.94, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={SPRING}
        style={{ originX: 1, originY: 1 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-[#26262b] px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.content}</div>
      </motion.div>
    );
  }

  const shown = m.showVideos ? filterVideos(videos, m.showVideos.filter, m.showVideos.sort).slice(0, m.showVideos.count) : [];
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.94, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={SPRING}
      style={{ originX: 0, originY: 1 }}
      className="flex items-start gap-2"
    >
      <div className="w-7 shrink-0 pt-1">
        {showAvatar && (
          <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={onAvatar} aria-label={`${speaker.name}'s profile`}>
            <Avatar agent={speaker} size={28} />
          </motion.button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        {showName && <p className="-mb-1 pl-1 text-[11.5px] font-medium text-zinc-400">{speaker.name} <span className="text-zinc-600">· {agentKind(speaker)}</span></p>}
        {m.content && (
          <div className={`max-w-[92%] rounded-3xl rounded-tl-md px-4 py-3 text-[15px] leading-relaxed ${m.error ? "border border-amber-500/30 bg-amber-500/10 text-amber-200" : "bg-[#1a1a1d] text-zinc-200"}`}>
            <TypedMarkdown text={m.content} animate={!!m.fresh} onDone={handleDone} />
          </div>
        )}
        <AnimatePresence>
          {typed && m.showVideos && (
            shown.length ? (
              <motion.div key="videos" className="flex w-full max-w-[640px] flex-col gap-3 pb-1" variants={STAGGER} initial="hidden" animate="show">
                {shown.map((v, i) => (
                  <motion.div key={v.id} variants={{ hidden: { opacity: 0, y: 14, scale: 0.95, filter: "blur(6px)" }, show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: SPRING } }}>
                    <VideoCard v={v} onOpen={() => onOpenVideo(shown, i)} />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.p key="novideos" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[12.5px] text-zinc-500">
                No {m.showVideos.filter === "all" ? "" : `${m.showVideos.filter} `}videos yet.
              </motion.p>
            )
          )}
          {typed && m.plan && (
            <motion.div key="plan" className="w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <PlanCard threadKey={threadKey} msgId={m.id} plan={m.plan} agents={agents} />
            </motion.div>
          )}
          {typed && m.postProposal && (
            <motion.div key="proposal" className="w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ProposalCard threadKey={threadKey} msgId={m.id} proposal={m.postProposal} agent={agents.get(m.postProposal.mint)} />
            </motion.div>
          )}
          {typed && m.openBuilder && (
            <motion.div key="builder" variants={ITEM} initial="hidden" animate="show">
              <Link href={m.openBuilder.href} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[13px] text-white transition-colors hover:bg-white/[0.08]">
                <Wand2 className="size-3.5 text-lime-300" /> Open {TAB_LABEL[m.openBuilder.tab] ?? m.openBuilder.tab} in Builder
              </Link>
            </motion.div>
          )}
          {typed && m.notes?.map((n, i) => (
            <motion.p
              key={`note-${i}`}
              initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ ...SPRING, delay: 0.08 + i * 0.06 }}
              className="rounded-full bg-emerald-500/10 px-3 py-1 text-[12.5px] text-emerald-300"
            >✓ {n}</motion.p>
          ))}
        </AnimatePresence>
        <span className="pl-2 text-[10.5px] text-zinc-600">{formatWhen(m.at)}</span>
      </div>
    </motion.div>
  );
}

/* ── Profile sheets: slide over the chat with a blurred backdrop ── */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div
      className="absolute inset-0 z-20 flex justify-end bg-black/50 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={label}
    >
      <motion.div
        initial={{ x: "100%", filter: "blur(6px)" }} animate={{ x: 0, filter: "blur(0px)" }} exit={{ x: "100%", filter: "blur(6px)" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/[0.08] bg-[#181a1c] shadow-2xl"
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-black/40 text-zinc-200 backdrop-blur hover:bg-black/60">
          <X className="size-4" />
        </button>
        <motion.div variants={STAGGER} initial="hidden" animate="show">{children}</motion.div>
      </motion.div>
    </motion.div>
  );
}

function AgentSheet({ agent, videos, feedLoaded, onClose, onOpenVideo }: {
  agent: Agent;
  videos: FeedItem[];
  feedLoaded: boolean;
  onClose: () => void;
  onOpenVideo: (list: FeedItem[], i: number) => void;
}) {
  const connected = agent.connectedPlatforms ?? [];
  const facts: [string, string | undefined][] = [
    ["Type", agentKind(agent)],
    ["Niche", agent.niche],
    ["Language", agent.language],
    ["Voice", agent.archetype],
    ["Video engine", agent.videoEngine],
    ["Created", agent._creationTime ? formatWhen(agent._creationTime) : undefined],
  ];
  return (
    <Sheet label={`${agent.name} profile`} onClose={onClose}>
      <div className="relative h-28 bg-gradient-to-br from-lime-500/25 via-emerald-500/10 to-transparent">
        {connected.length > 0 && (
          <div className="absolute right-4 top-4">
            <ConnectedPlatformStack platforms={connected} accounts={agent.connectedSocialAccounts} badgeClassName="size-7" ringClassName="ring-[#16241a]" />
          </div>
        )}
      </div>
      <div className="-mt-10 px-5 pb-6">
        <motion.div variants={ITEM} className="w-fit rounded-full ring-4 ring-[#0f0f12]"><Avatar agent={agent} size={80} /></motion.div>
        <motion.p variants={ITEM} className="mt-3 text-[20px] font-bold text-white">{agent.name}</motion.p>
        {agent.description && <motion.p variants={ITEM} className="mt-3 text-[13.5px] leading-relaxed text-zinc-300">{agent.description}</motion.p>}
        <motion.div variants={ITEM}><VideoStats videos={videos} loaded={feedLoaded} /></motion.div>
        <motion.div variants={ITEM} className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Stat label="Lifetime earned" value={usd(agent.lifetimeEarningsUsdc)} />
          <Stat label="Monthly" value={usd(agent.monthlyEarnings)} />
          <Stat label="TVL" value={usd(agent.tvl)} />
        </motion.div>
        <motion.div variants={ITEM} className="mt-5 space-y-2 rounded-2xl border border-white/[0.07] p-3.5">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-zinc-500">{k}</span>
              <span className="truncate text-right capitalize text-zinc-200">{v}</span>
            </div>
          ))}
        </motion.div>
        {videos.length > 0 && (
          <motion.div variants={ITEM} className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Latest videos</p>
            <motion.div variants={STAGGER} initial="hidden" animate="show" className="grid grid-cols-3 gap-1.5">
              {videos.slice(0, 6).map((v, i) => <Thumb key={v.id} v={v} onClick={() => onOpenVideo(videos, i)} />)}
            </motion.div>
          </motion.div>
        )}
        <motion.div variants={ITEM} className="mt-6 grid grid-cols-1 gap-2">
          <Link href={`/builder?mint=${encodeURIComponent(agent.mintAddress)}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-zinc-200">
            <Wand2 className="size-3.5" /> Open Builder
          </Link>
        </motion.div>
        <DeleteAgentButton mintAddress={agent.mintAddress} name={agent.name} />
      </div>
    </Sheet>
  );
}

/** The team's pinned brief — every member gets it on every reply, and plans
 *  are steered toward it. Saves on blur (synced to the account). */
function TeamBriefEditor({ team }: { team: Team }) {
  const [draft, setDraft] = useState(team.brief ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = draft.trim() !== (team.brief ?? "").trim();
  return (
    <div className="mt-4 rounded-2xl border border-white/[0.07] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-white">Team brief</p>
        <AnimatePresence>
          {saved && !dirty && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[11px] text-[#d7ff00]">Saved</motion.span>
          )}
        </AnimatePresence>
      </div>
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
        onBlur={() => { if (dirty) { setTeamBrief(team.id, draft); setSaved(true); } }}
        rows={4}
        maxLength={1200}
        placeholder={"The standing goal every member works toward, e.g.\n\"Raya season push in BM: 10 videos a week, family-friendly, join any fashion campaign.\""}
        className="mt-2 w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-[13px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
      />
      <p className="mt-1 text-[11px] text-zinc-600">Every member reads this before replying, and their plans follow it.</p>
    </div>
  );
}

function TeamSheet({ team, members, videos, feedLoaded, onClose, onSelectAgent, onOpenVideo, onDelete }: {
  team: Team;
  members: Agent[];
  videos: FeedItem[];
  feedLoaded: boolean;
  onClose: () => void;
  onSelectAgent: (mint: string) => void;
  onOpenVideo: (list: FeedItem[], i: number) => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet label={`${team.name} team`} onClose={onClose}>
      <div className="h-28 bg-gradient-to-br from-emerald-600/35 via-sky-500/20 to-transparent" />
      <div className="-mt-10 px-5 pb-6">
        <motion.div variants={ITEM} className="w-fit"><TeamAvatar members={members} size={84} /></motion.div>
        <motion.p variants={ITEM} className="mt-3 text-[20px] font-bold text-white">{team.name}</motion.p>
        <motion.p variants={ITEM} className="text-[13px] text-zinc-500">{members.length} agents · created {formatWhen(team.createdAt)}</motion.p>
        <motion.div variants={ITEM}><TeamBriefEditor team={team} /></motion.div>
        <motion.div variants={ITEM}><VideoStats videos={videos} loaded={feedLoaded} /></motion.div>
        <motion.div variants={ITEM} className="mt-5 space-y-1 rounded-2xl border border-white/[0.07] p-2">
          {members.map((m) => (
            <button key={m.mintAddress} onClick={() => onSelectAgent(m.mintAddress)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.05]">
              <Avatar agent={m} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-white">{m.name}</span>
                <span className="block truncate text-[12px] text-zinc-500">{agentKind(m)} · {m.niche}</span>
              </span>
              <span className="text-[11.5px] text-zinc-500">Chat 1:1 →</span>
            </button>
          ))}
        </motion.div>
        {videos.length > 0 && (
          <motion.div variants={ITEM} className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Team&apos;s latest videos</p>
            <motion.div variants={STAGGER} initial="hidden" animate="show" className="grid grid-cols-3 gap-1.5">
              {videos.slice(0, 9).map((v, i) => <Thumb key={v.id} v={v} onClick={() => onOpenVideo(videos, i)} />)}
            </motion.div>
          </motion.div>
        )}
        <motion.div variants={ITEM} className="mt-6">
          <button
            onClick={() => (confirm ? onDelete() : setConfirm(true))}
            onBlur={() => setConfirm(false)}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors ${confirm ? "border-rose-500/50 bg-rose-500/15 text-rose-300" : "border-white/10 text-zinc-300 hover:bg-white/5"}`}
          >
            <Trash2 className="size-3.5" /> {confirm ? "Click again to delete this team" : "Delete team"}
          </button>
          <p className="mt-2 text-center text-[11.5px] text-zinc-600">Deleting the team keeps every agent and its own chat.</p>
        </motion.div>
      </div>
    </Sheet>
  );
}
