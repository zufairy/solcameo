"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "convex/react";
import {
  Search, FolderClosed, ChevronDown, ArrowUp, Check,
  Sparkles, UserRound, AudioLines, Clapperboard, Send, Play,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import flashAvatar from "@/assets/flash.jpeg";
import velloMark from "@/assets/transparent-image.png";
import mecha2 from "@/assets/mecha-2.jpg";
import mecha3 from "@/assets/mecha-3.jpg";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { SOCIAL_ICONS } from "./social-icons";

/* ── "How it works" builder demo ──────────────────────────────────────────────
   A single client component that plays a synced demo: the copilot conversation
   and the n8n-style flow build up together, one step at a time, so it reads as
   "the agent is being built while you chat." The flow runs LEFT → RIGHT; the
   Generate-video node shows three different real generated clips (pulled from the
   platform feed, with a static fallback); Auto-post is wired off it. Loops. No
   em-dashes anywhere. Reduced-motion users get the finished state at once. */

const INTER = { fontFamily: "var(--font-inter)" } as const;
const CHAT_TABS = ["Build", "Studio", "Campaigns", "Earn"] as const;
const STATIC_THUMBS = [flashAvatar.src, mecha2.src, mecha3.src];

/* ── Flow graph (positions are % of the wide canvas) ─────────────────────────── */
type FlowNode = {
  key: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  Icon: typeof Sparkles;
  tone: string;
  /** Reveal this node once the message at this index has appeared. */
  at: number;
};
const FLOW_NODES: FlowNode[] = [
  { key: "prompt", label: "Your prompt", sub: "Coffee influencer", x: 12, y: 50, Icon: Sparkles, tone: "#65a30d", at: 0 },
  { key: "persona", label: "Persona", sub: "Voice & memory", x: 35, y: 23, Icon: UserRound, tone: "#2563eb", at: 3 },
  { key: "face", label: "Face & Voice", sub: "Consistent look", x: 35, y: 77, Icon: AudioLines, tone: "#db2777", at: 3 },
  { key: "render", label: "Generate video", sub: "3 clips", x: 60, y: 50, Icon: Clapperboard, tone: "#0d9488", at: 5 },
  { key: "post", label: "Auto-post", sub: "Live", x: 87, y: 50, Icon: Send, tone: "#7c3aed", at: 6 },
];
const FLOW_EDGES: [string, string][] = [
  ["prompt", "persona"], ["prompt", "face"],
  ["persona", "render"], ["face", "render"],
  ["render", "post"],
];
const nodeByKey = (k: string) => FLOW_NODES.find((n) => n.key === k)!;

/* ── Chat script ──────────────────────────────────────────────────────────────
   Each message's index lines up with the flow reveal above (see `at`). */
type Msg =
  | { role: "user" | "copilot"; type: "text"; text: string }
  | { role: "copilot"; type: "agent" }
  | { role: "copilot"; type: "post" };

const MESSAGES: Msg[] = [
  { role: "user", type: "text", text: "Create an AI influencer for my coffee brand." }, // 0 → prompt
  { role: "copilot", type: "text", text: "Love it. What vibe should Kaverro have?" }, // 1
  { role: "user", type: "text", text: "Cozy and aesthetic. Speaks English and Malay." }, // 2
  { role: "copilot", type: "text", text: "Building the persona, face, and voice now." }, // 3 → persona + face
  { role: "copilot", type: "agent" }, // 4
  { role: "copilot", type: "text", text: "Rendering three clips from her scenes." }, // 5 → render
  { role: "copilot", type: "post" }, // 6 → post
  { role: "user", type: "text", text: "Perfect. Post daily from now on." }, // 7
  { role: "copilot", type: "text", text: "Done. Kaverro posts every morning and joins campaigns for you." }, // 8
];

const rise = {
  initial: { opacity: 0, y: 10, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const },
};
const pop = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1 },
  transition: { type: "spring" as const, stiffness: 300, damping: 22 },
};

/* ── A single flow node's CARD (position-agnostic) — shared by the desktop wide
   canvas and the mobile portrait stack. ─────────────────────────────────────── */
function NodeCard({ n, thumbs, rendering }: { n: FlowNode; thumbs: string[]; rendering: boolean }) {
  if (n.key === "render") {
    return (
      <div className="w-[168px] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-1.5 border-b border-black/[0.06] px-2.5 py-1.5">
          <span className="grid size-5 place-items-center rounded-md" style={{ background: `${n.tone}1a`, color: n.tone }}>
            <n.Icon className="size-3" />
          </span>
          <span className="whitespace-nowrap text-[11.5px] font-semibold text-neutral-800">{n.label}</span>
        </div>
        <div className="flex gap-1.5 p-2">
          {["0:09", "0:12", "…"].map((dur, i) => (
            <div key={i} className="relative aspect-[9/16] flex-1 overflow-hidden rounded-md bg-neutral-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbs[i] ?? thumbs[0]} alt="" className="absolute inset-0 size-full object-cover" />
              <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              {i === 2 && rendering ? (
                <span className="cf-shimmer absolute inset-0 grid place-items-center">
                  <span className="size-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                </span>
              ) : (
                <>
                  <span className="absolute left-1/2 top-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-neutral-900">
                    <Play className="size-2 translate-x-px fill-current" />
                  </span>
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[7.5px] font-medium text-white">
                    {i === 2 ? "0:15" : dur}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (n.key === "post") {
    return (
      <div className="w-[132px] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-1.5 border-b border-black/[0.06] px-2.5 py-1.5">
          <span className="grid size-5 place-items-center rounded-md" style={{ background: `${n.tone}1a`, color: n.tone }}>
            <n.Icon className="size-3" />
          </span>
          <span className="whitespace-nowrap text-[11.5px] font-semibold text-neutral-800">{n.label}</span>
          <span className="relative ml-auto flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
        </div>
        <div className="flex items-center justify-around px-2 py-2.5">
          {SOCIAL_ICONS.map((p) => (
            <span key={p.key} title={p.label} className="grid size-7 place-items-center rounded-lg bg-neutral-50 ring-1 ring-black/[0.05]">
              <p.Icon className="size-[15px]" />
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (n.key === "face") {
    return (
      <div className="flex w-max items-center gap-2 whitespace-nowrap rounded-xl border border-black/[0.08] bg-white px-2.5 py-2 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.15)]">
        <span className="relative size-7 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/[0.06]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={flashAvatar.src} alt="" className="size-full object-cover" />
        </span>
        <span className="leading-tight">
          <span className="block text-[12px] font-semibold text-neutral-800">{n.label}</span>
          <span className="block text-[10.5px] text-neutral-400">{n.sub}</span>
        </span>
      </div>
    );
  }
  return (
    <div className={`flex w-max items-center gap-2 whitespace-nowrap rounded-xl border border-black/[0.08] bg-white px-2.5 py-2 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.15)] ${n.key === "prompt" ? "cf-pulse-ring" : ""}`}>
      {n.key === "prompt" ? (
        <span className="size-7 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={velloMark.src} alt="Solcameo" className="size-full object-contain" />
        </span>
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `${n.tone}1a`, color: n.tone }}>
          <n.Icon className="size-3.5" />
        </span>
      )}
      <span className="leading-tight">
        <span className="block text-[12px] font-semibold text-neutral-800">{n.label}</span>
        <span className="block text-[10.5px] text-neutral-400">{n.sub}</span>
      </span>
    </div>
  );
}

/* ── Flow canvas ─────────────────────────────────────────────────────────────── */
function FlowCanvas({ shown, thumbs }: { shown: number; thumbs: string[] }) {
  const wire = (a: FlowNode, b: FlowNode) => {
    // Orthogonal "elbow" connector: run horizontally out of A, drop vertically at
    // the midpoint, then run horizontally into B — right-angle segments read as a
    // tidy, organised graph (vs the old S-curve). Collapses to a single straight
    // line when A and B share a row or column.
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
  };
  const isShown = (key: string) => shown > nodeByKey(key).at;
  const rendering = shown <= 6; // last clip still "rendering" until posted

  return (
    <div className="relative size-full">
      {/* Wires — appear only once both endpoints exist. */}
      <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        {FLOW_EDGES.map(([from, to], i) => {
          if (!isShown(from) || !isShown(to)) return null;
          const d = wire(nodeByKey(from), nodeByKey(to));
          return (
            <motion.g key={`${from}-${to}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
              <path d={d} fill="none" stroke="#d5d3c8" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path
                d={d}
                fill="none"
                stroke="#65a30d"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeDasharray="1 6"
                vectorEffect="non-scaling-stroke"
                className="cf-flow"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            </motion.g>
          );
        })}
      </svg>

      {/* Nodes */}
      {FLOW_NODES.map((n) => {
        if (!isShown(n.key)) return null;
        return (
          <motion.div
            key={n.key}
            initial={pop.initial}
            animate={pop.animate}
            transition={pop.transition}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
          >
            <NodeCard n={n} thumbs={thumbs} rendering={rendering} />
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── Chat bubbles ────────────────────────────────────────────────────────────── */
function AgentCard() {
  return (
    <div className="w-[86%] self-start rounded-2xl border border-black/[0.07] bg-white p-2.5 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2">
        <span className="size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-black/[0.08]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={flashAvatar.src} alt="Kaverro avatar" className="size-full object-cover" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[12.5px] font-semibold text-neutral-900">Kaverro</span>
          <span className="block truncate text-[11px] text-neutral-400">@kaverro.coffee · AI influencer</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
          <Check className="size-3" /> Ready
        </span>
      </div>
    </div>
  );
}

function PostCard() {
  return (
    <div className="w-[86%] self-start rounded-2xl border border-black/[0.07] bg-white p-2.5 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-semibold text-neutral-800">3 clips generated</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          Posting
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {SOCIAL_ICONS.map((s) => (
          <span key={s.key} title={s.label} className="grid size-7 place-items-center rounded-lg bg-neutral-50 ring-1 ring-black/[0.05]">
            <s.Icon className="size-[15px]" />
          </span>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (m.type === "agent") return <AgentCard />;
  if (m.type === "post") return <PostCard />;
  const isUser = m.role === "user";
  return (
    <div
      className={`max-w-[82%] px-3 py-2 text-[12.5px] leading-snug shadow-sm ${
        isUser
          ? "self-end rounded-2xl rounded-br-md bg-neutral-900 text-white"
          : "self-start rounded-2xl rounded-bl-md bg-neutral-100 text-neutral-700"
      }`}
    >
      {m.text}
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-center gap-1 self-start rounded-2xl rounded-bl-md bg-neutral-100 px-3 py-2.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

/* ── Mobile portrait flow — the same nodes stacked TOP→BOTTOM with animated
   connectors, so the builder reads as a tall vertical pipeline on phones. ─────── */
const MOBILE_ORDER = ["prompt", "persona", "face", "render", "post"] as const;
function MobileFlow({ shown, thumbs }: { shown: number; thumbs: string[] }) {
  const isShown = (key: string) => shown > nodeByKey(key).at;
  const rendering = shown <= 6;
  return (
    <div className="flex flex-col items-center py-4">
      {MOBILE_ORDER.map((key, idx) => {
        if (!isShown(key)) return null;
        const n = nodeByKey(key);
        return (
          <div key={key} className="flex flex-col items-center">
            {idx > 0 && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="cf-flow-v my-1.5 h-6 w-[3px] origin-top rounded-full"
              />
            )}
            <motion.div initial={pop.initial} animate={pop.animate} transition={pop.transition}>
              <NodeCard n={n} thumbs={thumbs} rendering={rendering} />
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Copilot chat panel — reused by the desktop side column and the mobile
   below-the-builder card. ────────────────────────────────────────────────────── */
function ChatPanel({ shown, typing, bodyClass }: { shown: number; typing: boolean; bodyClass?: string }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3 text-[13px]">
        {CHAT_TABS.map((t, i) => (
          <span key={t} className={i === 0 ? "rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-800" : "px-1 py-1 text-neutral-400"}>
            {t}
          </span>
        ))}
      </div>

      <div className={`flex flex-1 flex-col justify-end gap-2.5 overflow-hidden px-3.5 py-4 ${bodyClass ?? ""}`}>
        {MESSAGES.slice(0, shown).map((m, i) => (
          <motion.div layout key={i} initial={rise.initial} animate={rise.animate} transition={rise.transition} className="flex flex-col">
            <Bubble m={m} />
          </motion.div>
        ))}
        {typing && (
          <motion.div layout initial={rise.initial} animate={rise.animate} transition={rise.transition} className="flex flex-col">
            <TypingBubble />
          </motion.div>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 rounded-xl border border-black/[0.08] bg-[#fbfaf7] py-2 pl-3 pr-2">
          <span className="flex-1 truncate text-[13px] text-neutral-400">Ask Vello to create an agent…</span>
          <span className="grid size-7 place-items-center rounded-lg bg-neutral-900 text-white" aria-hidden>
            <ArrowUp className="size-3.5" />
          </span>
        </div>
      </div>
    </>
  );
}

/* ── The synced view (pure — driven by props/thumbnails) ─────────────────────── */
function BuilderView({ thumbs }: { thumbs: string[] }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? MESSAGES.length : 0);
  const [typing, setTyping] = useState(false);
  // Keep the newest node in view on the mobile portrait pipeline as it builds up.
  const mobileFlowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mobileFlowRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown]);

  useEffect(() => {
    if (reduce) {
      setShown(MESSAGES.length);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = (i: number) => {
      if (cancelled) return;
      if (i >= MESSAGES.length) {
        timer = setTimeout(() => {
          if (cancelled) return;
          setShown(0);
          run(0);
        }, 3600);
        return;
      }
      const msg = MESSAGES[i];
      const reveal = () => {
        if (cancelled) return;
        setTyping(false);
        setShown(i + 1);
        timer = setTimeout(() => run(i + 1), msg.role === "user" ? 900 : 1150);
      };
      if (msg.role === "copilot") {
        setTyping(true);
        timer = setTimeout(reveal, 850);
      } else {
        reveal();
      }
    };
    timer = setTimeout(() => run(0), 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reduce]);

  const toolbar = (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 py-3 text-[13px] text-neutral-500">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-lg border border-black/[0.06] bg-white px-2 py-1 shadow-sm">
          <span className="size-5 overflow-hidden rounded-md ring-1 ring-black/[0.06]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flashAvatar.src} alt="" className="size-full object-cover" />
          </span>
          <span className="text-neutral-700">Kaverro · coffee</span>
          <ChevronDown className="size-3.5 text-neutral-400" />
        </span>
        <span className="hidden text-neutral-400 sm:inline">⌗ Flow</span>
      </div>
      <div className="flex items-center gap-3 text-neutral-400">
        <FolderClosed className="size-4" />
        <Search className="size-4" />
      </div>
    </div>
  );
  const dottedGrid = (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{ backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1.4px)", backgroundSize: "18px 18px" }}
    />
  );

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-[#fbfaf7] p-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.12)]" style={INTER}>
      {/* ── Desktop / tablet: wide builder + copilot side-by-side ── */}
      <div className="hidden h-[472px] overflow-hidden rounded-xl lg:flex">
        <div className="relative flex-1 overflow-hidden rounded-xl bg-[#fcfbf9]">
          {dottedGrid}
          {toolbar}
          <div className="absolute inset-0 px-6 pb-6 pt-14">
            <FlowCanvas shown={shown} thumbs={thumbs} />
          </div>
        </div>
        <div className="w-[320px] shrink-0 flex-col border-l border-black/[0.06] bg-white flex">
          <ChatPanel shown={shown} typing={typing} />
        </div>
      </div>

      {/* ── Mobile: PORTRAIT builder on top, animated copilot below ── */}
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="relative h-[420px] overflow-hidden rounded-xl bg-[#fcfbf9]">
          {dottedGrid}
          {toolbar}
          {/* Vertical pipeline, scrolls if the built flow grows past the frame. */}
          <div ref={mobileFlowRef} className="absolute inset-0 overflow-y-auto scroll-smooth px-4 pb-4 pt-14">
            <MobileFlow shown={shown} thumbs={thumbs} />
          </div>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#fcfbf9] to-transparent" />
        </div>
        <div className="flex h-[300px] flex-col overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-10px_rgba(0,0,0,0.2)]">
          <ChatPanel shown={shown} typing={typing} />
        </div>
      </div>
    </div>
  );
}

/* ── Live wrapper: real generated-video thumbnails, static fallback ──────────── */
function BuilderLive() {
  const feed = useQuery(api.clipJobs.globalVideoFeed, { limit: 6, kind: "ugc" });
  const dynamic = (feed?.items ?? [])
    .map((it: { posterUrl: string | null; agentAvatar: string }) => it.posterUrl || it.agentAvatar)
    .filter(Boolean)
    .slice(0, 3);
  const thumbs = dynamic.length >= 3 ? dynamic : STATIC_THUMBS;
  return <BuilderView thumbs={thumbs} />;
}

export function BuilderDemo() {
  // A feed hiccup must never crash the homepage — fall back to static thumbs.
  return (
    <ErrorBoundary fallback={<BuilderView thumbs={STATIC_THUMBS} />}>
      <BuilderLive />
    </ErrorBoundary>
  );
}
