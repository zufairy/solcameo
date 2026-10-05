"use client";

import { useState } from "react";
import { Trash2, FileText, Store } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CLIP_SKILL_BY_ID, isClipSkillId } from "@/lib/builder/clipSkillsCatalog";

/**
 * Builder "Library" tab - the clipping skills this agent owns (installed from the
 * Marketplace, stored in agentSkillFiles). View each skill's MD (the rules the AI
 * editor follows) or uninstall it.
 */
export function ClipLibrary({ sessionId, mintAddress }: { sessionId?: string; mintAddress?: string }) {
  const ownedDocs =
    (useQuery(
      mintAddress ? api.agentSkillFiles.listByMint : api.agentSkillFiles.listBySession,
      mintAddress ? { mintAddress } : sessionId ? { sessionId } : "skip",
    ) as { _id: string; skillId: string; title: string; markdown: string }[] | undefined) ?? [];
  const skills = ownedDocs.filter((d) => isClipSkillId(d.skillId));
  const remove = useMutation(api.agentSkillFiles.remove);
  const [openId, setOpenId] = useState<string | null>(null);

  if (skills.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <Store className="mx-auto size-7 text-zinc-400" />
          <div className="mt-3 font-serif text-xl font-bold text-zinc-900">No skills installed</div>
          <div className="mt-1 text-sm text-zinc-600">
            Install clipping skills from the Marketplace - they&apos;ll appear here and on the canvas.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#ece5d6] px-8 py-10" style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <h2 className="font-serif text-2xl font-bold text-zinc-900">Library</h2>
      <p className="mt-1 text-sm text-zinc-600">
        {skills.length} clipping skill{skills.length === 1 ? "" : "s"} installed. Click one to see how the AI editor uses it.
      </p>
      <div className="mt-6 space-y-3">
        {skills.map((d) => {
          const meta = CLIP_SKILL_BY_ID[d.skillId];
          const open = openId === d._id;
          return (
            <div key={d._id} className="rounded-xl border-2 border-zinc-900/15 bg-white shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-3 p-4">
                <span className="text-xl leading-none">{meta?.icon ?? "✨"}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-zinc-900">{d.title}</div>
                  <div className="truncate text-xs text-zinc-500">{meta?.blurb ?? d.skillId}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : d._id)}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  <FileText className="size-3.5" />
                  {open ? "Hide" : "View"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove({ id: d._id as unknown as never })}
                  title="Uninstall"
                  className="text-zinc-400 transition-colors hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {open && (
                <pre className="overflow-x-auto whitespace-pre-wrap border-t border-zinc-900/10 bg-zinc-50 p-4 text-[12px] leading-relaxed text-zinc-700">
                  {d.markdown}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
