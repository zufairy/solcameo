import { Fragment, type ReactNode } from "react";

/** One transcript turn as stored in builderSessions.messages. */
export type TranscriptMsg = {
  role: "user" | "assistant";
  content: string;
  at: number;
};

/**
 * Inline markdown → React nodes for chat transcripts. Supports the small subset
 * the builder actually emits: **bold**, *italic* / _italic_, and `code`. Runs
 * per line so newlines are preserved by the caller's <br/> handling.
 */
function renderInline(text: string, keyBase: string): ReactNode[] {
  // Split on the inline tokens while keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g);
  const nodes: ReactNode[] = [];
  parts.forEach((tok, i) => {
    if (!tok) return;
    const key = `${keyBase}-${i}`;
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      nodes.push(<strong key={key} className="font-bold text-inherit">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      nodes.push(
        <code key={key} className="rounded bg-black/30 px-1 py-0.5 font-mono text-[12px]">{tok.slice(1, -1)}</code>,
      );
    } else if ((tok.startsWith("*") && tok.endsWith("*") && tok.length > 2)
      || (tok.startsWith("_") && tok.endsWith("_") && tok.length > 2)) {
      nodes.push(<em key={key} className="italic">{tok.slice(1, -1)}</em>);
    } else {
      nodes.push(<Fragment key={key}>{tok}</Fragment>);
    }
  });
  return nodes;
}

/** Renders content with inline markdown, preserving line breaks. */
export function TranscriptMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderInline(line, `l${i}`)}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A single chat bubble for an admin transcript. Both sides render with a role
 * label so the conversation always reads as a two-sided thread — `assistant`
 * left/muted, `user` right/emerald — with **bold** and other inline markdown
 * rendered rather than shown as literal asterisks.
 */
export function TranscriptMessage({ m }: { m: TranscriptMsg }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 px-1 mb-0.5">
        {isUser ? "User" : "Agent"}
      </span>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed break-words ${
        isUser
          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-100"
          : "bg-white/[0.03] border border-[#1e1e24] text-zinc-300"
      }`}>
        <TranscriptMarkdown content={m.content} />
        <p className="mt-1 text-[10px] text-zinc-600">{new Date(m.at).toLocaleString()}</p>
      </div>
    </div>
  );
}
