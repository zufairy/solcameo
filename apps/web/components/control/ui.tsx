"use client";

import { useEffect, useRef, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import type { Agent } from "./store";

/* Shared motion language for /control: springy pops that blur in, so every
   popup / menu / card lands with focus instead of just appearing. */
export const SPRING = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 } as const;
export const POP: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 8, filter: "blur(8px)" },
  show: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transition: { ...SPRING, filter: { duration: 0.2 } } },
  exit: { opacity: 0, scale: 0.96, y: 6, filter: "blur(6px)", transition: { duration: 0.14 } },
};
export const STAGGER: Variants = { show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } } };
export const ITEM: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: SPRING },
};

export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
export const usd = (n: number | undefined) => `$${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const previewOf = (text: string) => text.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

type AvatarAgent = Pick<Agent, "avatarUrl" | "name"> & Partial<Pick<Agent, "mintAddress" | "avatarStills">>;

export function Avatar({ agent, size = 44 }: { agent: AvatarAgent; size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="shrink-0 overflow-hidden rounded-full bg-white/5">
      <AgentAvatar
        url={agent.avatarUrl}
        alternateUrls={agent.avatarStills}
        name={agent.name}
        seed={agent.mintAddress ?? agent.name}
        className="h-full w-full rounded-full object-cover"
        initialClassName="text-[15px]"
      />
    </div>
  );
}

/** Overlapping member avatars for a team (up to 3, in a small cluster). */
export function TeamAvatar({ members, size = 44 }: { members: AvatarAgent[]; size?: number }) {
  const shown = members.slice(0, 3);
  if (shown.length <= 1) return shown[0] ? <Avatar agent={shown[0]} size={size} /> : <div style={{ width: size, height: size }} className="rounded-full bg-white/10" />;
  const inner = Math.round(size * 0.62);
  const far = size - inner;
  const spots = shown.length === 2 ? [[0, 0], [far, far]] : [[0, 0], [far, 0], [far / 2, far]];
  return (
    <div style={{ width: size, height: size }} className="relative shrink-0">
      {shown.map((m, i) => (
        <div key={i} className="absolute rounded-full ring-2 ring-[#0c0c0e]" style={{ left: spots[i][0], top: spots[i][1] }}>
          <Avatar agent={m} size={inner} />
        </div>
      ))}
    </div>
  );
}

export function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-zinc-400"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export const CONTROL_GLASS_ACTION = "rounded-[4px] border border-white/30 bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_4px_14px_-8px_rgba(0,0,0,0.55)] backdrop-blur-xl backdrop-saturate-150 transition-colors hover:border-white/50 hover:bg-white/[0.24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40";

export function StateBadge({ state }: { state: string }) {
  const label = state === "generated" ? "ready" : state;
  return <span className={`${CONTROL_GLASS_ACTION} !rounded-full px-2.5 py-1 text-[10px] font-semibold`}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] px-2 py-2">
      <p className="truncate text-[15px] font-semibold text-white">{value}</p>
      <p className="text-[10.5px] text-zinc-500">{label}</p>
    </div>
  );
}

/* ── Minimal, safe markdown (React nodes only, no HTML injection): headings,
   bullets, numbered lists, **bold**, *italic*, `code`, [links](https://…).
   While a reply streams, plain text is split into words keyed by their offset
   so React keeps words already shown and only NEW ones mount → only they play
   the fade-in (Grok-style). The cursor renders INLINE at the end of the last
   line instead of on its own line. ── */
type Block =
  | { kind: "p"; text: string; key: string }
  | { kind: "h"; level: number; text: string; key: string }
  | { kind: "list"; ordered: boolean; items: string[]; key: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;
  text.replace(/\r/g, "").split("\n").forEach((raw, idx) => {
    const line = raw.trimEnd();
    const item = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (item) {
      const ordered = item[1] !== undefined;
      if (list && list.ordered !== ordered) list = null;
      if (!list) { list = { kind: "list", ordered, items: [], key: `l${idx}` }; blocks.push(list); }
      list.items.push(item[2]);
      return;
    }
    list = null;
    if (!line.trim()) return;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) blocks.push({ kind: "h", level: h[1].length, text: h[2], key: `h${idx}` });
    else blocks.push({ kind: "p", text: line, key: `p${idx}` });
  });
  return blocks;
}

/** Plain text → words (each its own fading span) when animating, else as-is. */
function words(text: string, keyBase: string, animate: boolean): React.ReactNode[] {
  if (!animate) return [text];
  const out: React.ReactNode[] = [];
  const re = /\S+\s*|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(<span key={`${keyBase}w${m.index}`} className="vello-word">{m[0]}</span>);
  return out;
}

function renderInline(text: string, keyBase: string, animate: boolean): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\)|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...words(text.slice(last, m.index), `${keyBase}-${last}`, animate));
    const tok = m[0];
    const k = `${keyBase}-t${m.index}`;
    const cls = animate ? "vello-word" : undefined;
    if (tok.startsWith("**")) out.push(<strong key={k} className={`font-semibold text-white ${cls ?? ""}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className={`rounded bg-white/10 px-1 py-0.5 text-[0.9em] ${cls ?? ""}`}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = tok.slice(tok.indexOf("(") + 1, -1);
      out.push(
        <a key={k} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className={`text-sky-400 hover:underline ${cls ?? ""}`}>{label}</a>,
      );
    } else out.push(<em key={k} className={cls}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(...words(text.slice(last), `${keyBase}-${last}`, animate));
  return out;
}

const Caret = () => <span className="vello-caret" aria-hidden />;

export function Markdown({ text, caret, animate = false }: { text: string; caret?: boolean; animate?: boolean }) {
  const blocks = parseBlocks(text);
  const lastIdx = blocks.length - 1;
  return (
    <div className="space-y-2.5">
      {blocks.map((b, bi) => {
        const tail = caret && bi === lastIdx ? <Caret /> : null;
        if (b.kind === "list") {
          const cls = `${b.ordered ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 marker:text-zinc-500`;
          const lis = b.items.map((it, j) => (
            <li key={j}>{renderInline(it, `${b.key}-${j}`, animate)}{tail && j === b.items.length - 1 ? tail : null}</li>
          ));
          return b.ordered ? <ol key={b.key} className={cls}>{lis}</ol> : <ul key={b.key} className={cls}>{lis}</ul>;
        }
        if (b.kind === "h") {
          const size = b.level === 1 ? "text-[19px]" : b.level === 2 ? "text-[17px]" : "text-[15.5px]";
          return <p key={b.key} className={`${size} pt-1 font-bold text-white`}>{renderInline(b.text, b.key, animate)}{tail}</p>;
        }
        return <p key={b.key}>{renderInline(b.text, b.key, animate)}{tail}</p>;
      })}
      {caret && blocks.length === 0 && <p><Caret /></p>}
    </div>
  );
}

/** Streams a fresh reply in word-by-word (each new word fades up out of a
 *  blur, cursor riding the end of the line), then calls onDone. Pace adapts to
 *  length so long answers still finish in ~2.2s; short ones read naturally. */
export function TypedMarkdown({ text, animate, onDone }: { text: string; animate: boolean; onDone: () => void }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  const doneRef = useRef(!animate);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!animate) return;
    const total = text.length;
    const charsPerMs = Math.max(0.045, total / 2200);
    const start = performance.now();
    let raf = 0;
    let last = -1;
    const tick = (now: number) => {
      let n = Math.min(total, Math.round((now - start) * charsPerMs));
      // End on a word boundary so markdown tokens don't flicker mid-word.
      if (n < total) { const sp = text.indexOf(" ", n); n = sp === -1 ? total : sp; }
      if (n !== last) { last = n; setShown(n); }
      if (n < total) raf = requestAnimationFrame(tick);
      else if (!doneRef.current) { doneRef.current = true; onDoneRef.current(); }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Leaving mid-reveal: count it as read so it doesn't replay.
      if (!doneRef.current) { doneRef.current = true; onDoneRef.current(); }
    };
  }, [animate, text]);

  const streaming = shown < text.length;
  // Keep word spans for the whole reveal (and the frame it completes) so the
  // last words finish their fade; once marked seen it renders as plain text.
  return <Markdown text={text.slice(0, shown)} caret={streaming} animate={animate} />;
}

/** Grok-style "thinking" label — a light sweep across the text. */
export function ThinkingLabel({ children }: { children: React.ReactNode }) {
  return <span className="vello-shimmer text-[13.5px] font-medium">{children}</span>;
}
