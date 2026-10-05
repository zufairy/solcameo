"use client";

// DEV-ONLY screen walkthrough for the AI-Clipper workspace.
// Mounts <AgentWorkspace> with a demo clipper agent (no auth/mint gatekeeping)
// and a small bottom-left navigator to click through ALL tabs — including ones
// hidden/aliased for a clipper (Director, History).
//
// The local dev Convex is disabled (free-plan limit), so this page uses a FAKE
// Convex client: the list queries below return canned DUMMY data so every screen
// is populated; any query NOT mocked falls back to READ-ONLY prod; ALL mutations
// are no-ops (never writes anywhere). Scoped here via a nested ConvexProvider.
// Pure dev tooling — reach it at /dev/clipper; not linked anywhere.

import { useCallback, useState } from "react";
import { notFound } from "next/navigation";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import AgentWorkspace from "@/components/builder/AgentWorkspace";
import type { AgentBlueprint } from "@/lib/builder/agentTypes";

const PROD_CONVEX_URL = "https://brainy-gull-865.convex.cloud";
const MINT = "DemoCL1pPeRMint1111111111111111111111111111";
const SAMPLE_MP4 =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
const H = 3_600_000; // 1h in ms

type TabId =
  | "home" | "clipping" | "marketplace" | "library" | "posting"
  | "tasks" | "generations" | "budget" | "director" | "history";

const DEMO_CLIPPER: AgentBlueprint = {
  agentType: "clipping",
  agentStatus: "ready",
  mintCompleted: true,
  mintAddress: MINT,
  installedSkills: [
    "clip.captions", "clip.hook", "clip.zoom", "clip.keywords",
    "clip.fillercut", "clip.facetrack", "clip.brainrot", "clip.memeaudio",
    "clip.campaignscout",
  ],
  persona: {
    name: "Demo Clipper",
    handle: "@democlipper",
    niche: "Podcast & gaming clips",
    audience: "Short-form viewers",
    voiceArchetype: "entertainer",
    contentPillars: ["Viral Moments", "Hooks", "Captions"],
  },
  wallet: {
    balanceUsdc: 42,
    earnings: { lifetimeUsdc: 0, last30dUsdc: 0, last7dUsdc: 0 },
    burnRate: { dailyUsdc: 0 },
  },
} as AgentBlueprint;

// A fake Convex client: canned data for the mocked list queries, read-only prod
// fallback for everything else, no-op mutations. Returns a Proxy around a real
// prod client so unknown methods (setAuth, connectionState, …) still work.
function makeDemoClient(): ConvexReactClient {
  const real = new ConvexReactClient(PROD_CONVEX_URL);
  const now = Date.now();

  const skill = (skillId: string, title: string, blurb: string, i: number) => ({
    _id: `sk_${i}`, _creationTime: now - i * H, mintAddress: MINT, sessionId: "dev-clipper",
    skillId, title, markdown: `# ${title}\n\n${blurb}`, updatedAt: now - i * H,
  });
  const DUMMY_SKILLS = [
    skill("clip.captions", "Dynamic Captions", "Karaoke-style word-by-word captions burned in.", 1),
    skill("clip.brainrot", "Brain Rot", "Split-screen the clip over a gameplay background.", 2),
    skill("clip.memeaudio", "Meme Audio", "Overlay a trending meme sound at the hook.", 3),
    skill("clip.hook", "Auto Hook", "Punchy first-2-second hook text.", 4),
    skill("clip.zoom", "Zoom Punch", "Auto zoom-ins on emphasis beats.", 5),
  ];

  const clip = (i: number, title: string, score: number, status: string, extra: Record<string, unknown> = {}) => ({
    _id: `c_${i}`, _creationTime: now - i * H, jobId: `j_${i}`, mintAddress: MINT,
    title, reason: "Strong hook + payoff", startSeconds: 12 * i, endSeconds: 12 * i + 30,
    viralScore: score, clipUrl: SAMPLE_MP4, captionText: title, status,
    createdAt: now - i * H, updatedAt: now - i * H, ...extra,
  });
  const DUMMY_CLIPS = [
    clip(1, "The $0 marketing hack nobody talks about", 92, "ready"),
    clip(2, "Why most founders fail in year one", 84, "posted", { postUrl: "https://tiktok.com/@democlipper/video/1", platform: "tiktok" }),
    clip(3, "3 hooks that always go viral", 71, "ready"),
    clip(4, "This one mindset shift changed everything", 58, "ready"),
  ];

  const DUMMY_FEED = [
    { clipId: "c_2", title: "Why most founders fail in year one", clipUrl: SAMPLE_MP4, viralScore: 84, state: "posted", postUrl: "https://tiktok.com/@democlipper/video/1", platform: "tiktok", scheduledFor: null, error: null },
    { clipId: "c_1", title: "The $0 marketing hack nobody talks about", clipUrl: SAMPLE_MP4, viralScore: 92, state: "posting", postUrl: null, platform: null, scheduledFor: null, error: null },
    { clipId: "c_3", title: "3 hooks that always go viral", clipUrl: SAMPLE_MP4, viralScore: 71, state: "queued", postUrl: null, platform: null, scheduledFor: now + 2 * H, error: null },
    { clipId: "c_4", title: "This one mindset shift changed everything", clipUrl: SAMPLE_MP4, viralScore: 58, state: "not_posted", postUrl: null, platform: null, scheduledFor: null, error: null },
  ];

  const sched = (i: number, offsetMs: number, status: string, topic: string, extra: Record<string, unknown> = {}) => ({
    _id: `sc_${i}`, _creationTime: now, mintAddress: MINT, videoUrl: SAMPLE_MP4,
    scheduledFor: now + offsetMs, status, topic, caption: topic, platforms: ["tiktok"],
    createdAt: now, ...extra,
  });
  const DUMMY_SCHEDULED = [
    sched(1, -4 * H, "posted", "Why most founders fail in year one", { postedAt: now - 4 * H, platforms: ["tiktok", "instagram"] }),
    sched(2, 2 * H, "scheduled", "3 hooks that always go viral"),
    sched(3, 6 * H, "scheduled", "Caption test clip", { platforms: ["instagram"] }),
    sched(4, 26 * H, "scheduled", "Day-2 drip clip"),
  ];

  const task = (i: number, type: string, title: string, status: string, agoMs: number) => ({
    _id: `t_${i}`, _creationTime: now - agoMs, mintAddress: MINT, type, title, status,
  });
  const DUMMY_TASKS = [
    task(1, "research", "Research trending short-form formats", "running", 60_000),
    task(2, "find_jobs", "Scout brand campaigns to clip", "succeeded", 5 * 60_000),
    task(3, "post_content", "Posted clip to TikTok", "succeeded", 60 * 60_000),
    task(4, "self_reflect", "Self-reflect on last week's performance", "succeeded", 20 * 60_000),
    task(5, "clip_source", "Clip a source video", "failed", 120 * 60_000),
  ];

  const MOCK: Record<string, () => unknown> = {
    "agentSkillFiles:listByMint": () => DUMMY_SKILLS,
    "agentSkillFiles:listBySession": () => DUMMY_SKILLS,
    "clipJobs:listClipsByMint": () => DUMMY_CLIPS,
    "clipJobs:listJobsByMint": () => [],
    "clipJobs:postingFeed": () => DUMMY_FEED,
    "scheduledContent:listByMint": () => DUMMY_SCHEDULED,
    "agentTasks:listByMint": () => DUMMY_TASKS,
  };

  const staticWatch = (value: unknown) => ({
    onUpdate: () => () => {},
    localQueryResult: () => value,
    journal: () => undefined,
  });

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "watchQuery") {
        return (query: unknown, ...rest: unknown[]) => {
          let name = "";
          try { name = getFunctionName(query as never); } catch { /* ignore */ }
          if (name in MOCK) return staticWatch(MOCK[name]());
          // delegate to prod (read-only) for anything not mocked
          return (target.watchQuery as (...a: unknown[]) => unknown)(query, ...rest);
        };
      }
      // never write — mutations/actions are inert on the demo page
      if (prop === "mutation" || prop === "action") return async () => undefined;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as ConvexReactClient;
}

const SCREENS: { id: TabId; label: string; note: string; tag?: "new" | "hidden" | "alias" }[] = [
  { id: "home", label: "Home", note: "identity · wallet · skills" },
  { id: "clipping", label: "Clipping", note: "the flow canvas (inspector, run preview, palette)" },
  { id: "marketplace", label: "Marketplace", note: "install clip skills" },
  { id: "library", label: "Library", note: "installed skills" },
  { id: "posting", label: "Posting", note: "auto-post toggle · scheduler · calendar", tag: "new" },
  { id: "tasks", label: "Tasks", note: "task history (read-only list)" },
  { id: "generations", label: "Generations", note: "clip input · queue · history" },
  { id: "budget", label: "Budget", note: "spend / runway" },
  { id: "director", label: "Director", note: "hidden for clipper (influencer Veo)", tag: "hidden" },
  { id: "history", label: "History", note: "alias — folded into Generations", tag: "alias" },
];

export default function DevClipperScreensPage() {
  // SECURITY: this page is no-auth + hardcodes a prod Convex URL. It must NEVER
  // be reachable on prod. NODE_ENV is inlined at build time → 404 on velloagents.com,
  // renders only under `next dev` locally.
  if (process.env.NODE_ENV === "production") notFound();

  const [convex] = useState(() => makeDemoClient());
  const [setTab, setSetTab] = useState<((id: TabId) => void) | null>(null);
  const [current, setCurrent] = useState<TabId>("home");
  const [open, setOpen] = useState(true);

  // Stable controller so AgentWorkspace's register-effect fires exactly once.
  const onTabController = useCallback((fn: (id: TabId) => void) => {
    setSetTab(() => fn);
  }, []);

  const go = (id: TabId) => {
    setCurrent(id);
    setTab?.(id);
  };

  const tagStyle = (tag?: string) =>
    tag === "new" ? "bg-lime-200 text-lime-900"
      : tag === "hidden" ? "bg-amber-200 text-amber-900"
        : tag === "alias" ? "bg-zinc-300 text-zinc-700"
          : "";

  return (
    <ConvexProvider client={convex}>
      {/* h-screen so AgentWorkspace's `h-full` root resolves — the flow canvas
          needs a fixed-height ancestor or it collapses. */}
      <div className="relative h-screen overflow-hidden">
        <AgentWorkspace
          blueprint={DEMO_CLIPPER}
          skillDefs={[]}
          knowledgeEntries={[]}
          avatarUrls={[]}
          sessionId="dev-clipper"
          onEditField={() => {}}
          onToggleContentType={() => {}}
          onToggleSkill={() => {}}
          onUploadKnowledge={() => {}}
          onTestAgent={() => {}}
          initialTab="home"
          onTabController={onTabController}
        />

        {/* Bottom-left screen navigator (dev). Always on top, collapsible. */}
        <div className="fixed bottom-4 left-4 z-[9999] font-sans text-[13px]">
          {open ? (
            <div className="w-[260px] overflow-hidden rounded-xl border-2 border-zinc-900 bg-white shadow-[0_4px_0_0_rgba(0,0,0,0.18)]">
              <div className="flex items-center justify-between border-b border-zinc-900/15 bg-zinc-900 px-3 py-2 text-white">
                <span className="font-bold">Screens · dev</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-1.5 text-white/80 hover:text-white"
                  aria-label="Collapse"
                >
                  –
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-1.5">
                {SCREENS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => go(s.id)}
                    className={`mb-1 flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                      current === s.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold">{s.label}</span>
                      {s.tag ? (
                        <span className={`rounded px-1 py-px text-[9.5px] font-bold uppercase ${tagStyle(s.tag)}`}>
                          {s.tag}
                        </span>
                      ) : null}
                    </span>
                    <span className={`text-[11px] leading-tight ${current === s.id ? "text-white/70" : "text-zinc-500"}`}>
                      {s.note}
                    </span>
                  </button>
                ))}
              </div>
              <div className="border-t border-zinc-900/10 px-3 py-1.5 text-[10.5px] text-zinc-400">
                demo agent · dummy data · no gatekeeping
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-full border-2 border-zinc-900 bg-white px-3 py-2 font-bold shadow-[0_3px_0_0_rgba(0,0,0,0.18)]"
            >
              Screens ▴
            </button>
          )}
        </div>
      </div>
    </ConvexProvider>
  );
}
