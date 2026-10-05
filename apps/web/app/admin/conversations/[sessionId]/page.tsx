"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ArrowLeft, Loader2 } from "lucide-react";
import { shortAddr, timeAgo } from "@/components/admin/util";
import { TranscriptMessage } from "@/components/admin/TranscriptMessage";
import type { BuilderSessionDetail } from "@/convex/adminBuilder";

type Detail = BuilderSessionDetail;

function DraftField({ label, value }: { label: string; value?: string | string[] | null }) {
  const text = Array.isArray(value) ? value.join(", ") : value;
  if (!text) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-zinc-700">{label}</p>
      <p className="text-[12px] text-zinc-300 mt-0.5 whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export default function AdminConversationDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { accessToken } = useSupabaseAuth();
  const getSession = useAction(api.adminBuilder.getBuilderSession);
  const [detail, setDetail] = useState<Detail | null | "loading">("loading");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !sessionId) return;
    try {
      setErr(null);
      setDetail(await getSession({ accessToken, sessionId: decodeURIComponent(sessionId) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load session");
      setDetail(null);
    }
  }, [accessToken, getSession, sessionId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (detail === "loading") {
    return <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  }
  if (detail === null) {
    return (
      <div className="py-20 text-center text-zinc-600 text-[13px]">
        {err ? <>Failed to load session: <span className="text-amber-400">{err}</span></> : "Session not found."}
        <div className="mt-3"><Link href="/admin/conversations" className="text-emerald-400 hover:underline">← Back to conversations</Link></div>
      </div>
    );
  }

  const { session, draft, status, account } = detail;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/admin/conversations" className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="size-3.5" /> Conversations
        </Link>
        <span className="text-[11px] text-zinc-600">
          {account?.accountName || account?.accountEmail ? `${account.accountName ?? account.accountEmail} · ` : ""}{shortAddr(session.wallet)} · {session.messageCount} messages · last active {timeAgo(session.lastActivityAt)}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        {/* Transcript */}
        <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5 space-y-3">
          {session.messageCount > session.messages.length && (
            <p className="text-[11px] text-zinc-600 text-center">
              Showing the last {session.messages.length} of {session.messageCount} messages (older messages trimmed at sync).
            </p>
          )}
          {session.messages.map((m, i) => (
            <TranscriptMessage key={i} m={m} />
          ))}
          {session.messages.length === 0 && (
            <p className="py-10 text-center text-zinc-700 text-[13px]">No text messages captured.</p>
          )}
        </div>

        {/* Draft context */}
        <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-white">Draft</h3>
            <span className={`inline-flex items-center text-[10px] font-semibold rounded-md px-2 py-0.5 border ${
              status === "minted" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : status === "abandoned" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
              : "text-sky-400 bg-sky-500/10 border-sky-500/20"
            }`}>{status === "draft" ? "in progress" : status}</span>
          </div>
          {draft ? (
            <div className="space-y-3">
              {draft.avatarUrls[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.avatarUrls[0]} alt="" className="size-16 rounded-xl object-cover border border-[#1e1e24]" />
              )}
              <DraftField label="Name" value={draft.name} />
              <DraftField label="Handle" value={draft.handle} />
              <DraftField label="Niche" value={draft.niche} />
              <DraftField label="Mint status" value={draft.mintStatus} />
              <DraftField label="Mint address" value={draft.mintAddress} />
              <DraftField label="Backstory" value={draft.questionnaire.backstory} />
              <DraftField label="Traits" value={draft.questionnaire.traits} />
              <DraftField label="Content pillars" value={draft.questionnaire.contentPillars} />
              <DraftField label="Voice" value={draft.questionnaire.voiceArchetype} />
              <DraftField label="Audience" value={draft.questionnaire.audience} />
            </div>
          ) : (
            <p className="text-[12px] text-zinc-600">
              No draft saved — the user chatted but never reached the persona/draft stage.
            </p>
          )}
          <div className="pt-2 border-t border-[#18181c] space-y-3">
            <DraftField label="Account name" value={account?.accountName} />
            <DraftField label="Account email" value={account?.accountEmail} />
            <DraftField label="Wallet" value={session.wallet} />
            <DraftField label="Session ID" value={session.sessionId} />
            <DraftField label="Agent type" value={session.agentType} />
            <DraftField label="Project" value={session.projectName} />
            {session.mintAddress && (
              <Link href={`/admin/investments/${encodeURIComponent(session.mintAddress)}`} className="inline-block text-[12px] text-emerald-400 hover:underline">
                View agent economics →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
