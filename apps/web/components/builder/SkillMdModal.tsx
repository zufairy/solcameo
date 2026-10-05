"use client";

import { useMemo, useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { X } from "lucide-react";

interface SkillMdModalProps {
  open: boolean;
  onClose: () => void;
  skill: { id: string; label: string; desc: string };
  sessionId: string;
  mintAddress?: string;
  initialMarkdown?: string;
}

function defaultTemplate(skill: { label: string; desc: string }): string {
  return `# ${skill.label}\n\n${skill.desc}\n\n## Instructions\n\n## Examples\n\n`;
}

// ─── Tiny markdown renderer ────────────────────────────────────────────────────
// Supports: # / ## / ### headers, **bold**, *italic*, - lists, ```code blocks```, paragraphs

function renderInline(text: string): React.ReactNode[] {
  // Replace **bold** and *italic* with placeholders to safely process
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key++} className="font-bold text-zinc-900">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={key++} className="font-mono text-[12px] bg-zinc-100 px-1 py-0.5 rounded">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key++} className="italic">{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let listBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(
      <ul key={key++} className="list-disc pl-5 mb-2 space-y-0.5">
        {listBuf.map((item, idx) => (
          <li key={idx} className="text-[13px] text-zinc-800 leading-[1.55]">{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    // code block
    if (line.startsWith("```")) {
      flushList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push(
        <pre key={key++} className="bg-zinc-100 p-3 rounded font-mono text-[11px] text-zinc-800 overflow-x-auto mb-2 border border-zinc-200">
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      out.push(<h3 key={key++} className="text-[13px] font-bold uppercase tracking-wide mt-2 mb-1 text-zinc-900">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      out.push(<h2 key={key++} className="font-serif text-[16px] font-bold mt-3 mb-1.5 text-zinc-900">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      flushList();
      out.push(<h1 key={key++} className="font-serif text-[20px] font-bold mt-3 mb-2 text-zinc-900">{renderInline(line.slice(2))}</h1>);
    } else if (/^\s*-\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*-\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(<p key={key++} className="text-[13px] text-zinc-800 leading-[1.55] mb-2">{renderInline(line)}</p>);
    }
    i++;
  }
  flushList();
  return out;
}

export default function SkillMdModal({
  open,
  onClose,
  skill,
  sessionId,
  mintAddress,
  initialMarkdown,
}: SkillMdModalProps) {
  const upsert = useMutation(api.agentSkillFiles.upsert);
  const [markdown, setMarkdown] = useState<string>(initialMarkdown || defaultTemplate(skill));
  const [mode, setMode] = useState<"edit" | "view">(initialMarkdown ? "view" : "edit");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setMarkdown(initialMarkdown || defaultTemplate(skill));
    setMode(initialMarkdown ? "view" : "edit");
  }, [initialMarkdown, skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const wordCount = useMemo(
    () => markdown.trim().split(/\s+/).filter(Boolean).length,
    [markdown],
  );

  if (!open) return null;

  const handleSave = async () => {
    if (!sessionId) return;
    setSaving(true);
    try {
      await upsert({
        sessionId,
        mintAddress: mintAddress || undefined,
        skillId: skill.id,
        title: skill.label,
        markdown,
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-xl flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-[760px] w-full bg-[#fbfaf6] border border-zinc-300 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "min(85vh, 700px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-200 bg-[#fbfaf6]">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-0.5">Skill Instruction</p>
            <h2 className="font-serif text-[20px] font-bold text-zinc-900 leading-tight truncate">{skill.label}</h2>
            <p className="text-[12px] text-zinc-600 leading-snug mt-0.5 line-clamp-2">{skill.desc}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 size-8 rounded-md border border-zinc-300 bg-white hover:bg-zinc-100 flex items-center justify-center text-zinc-700"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="px-5 py-2.5 border-b border-zinc-200 bg-[#f5f3ec] flex items-center gap-2">
          <div className="inline-flex border border-zinc-300 rounded-md overflow-hidden bg-white">
            <button
              onClick={() => setMode("view")}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 ${
                mode === "view" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              View
            </button>
            <button
              onClick={() => setMode("edit")}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 border-l border-zinc-300 ${
                mode === "edit" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              Edit
            </button>
          </div>
          {savedAt && (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700">Saved</p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#fbfaf6]">
          {mode === "edit" ? (
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              spellCheck={false}
              className="w-full h-full min-h-[360px] font-mono text-[12px] leading-[1.6] text-zinc-900 bg-zinc-50 border border-zinc-300 rounded-md p-3 focus:outline-none focus:border-zinc-500 resize-none"
            />
          ) : (
            <div className="prose-paper">{renderMarkdown(markdown)}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 bg-[#f5f3ec] flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {wordCount} word{wordCount === 1 ? "" : "s"} · {markdown.length} chars
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-800 px-3 py-2 border border-zinc-300 rounded-md bg-white hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !sessionId}
              className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-2 rounded-md bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
