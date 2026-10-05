"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, RefreshCw, Link as LinkIcon, Globe } from "lucide-react";
import { timeAgo } from "./util";

type Row = {
  _id: string;
  source: "hero_video_link" | "cta_website";
  url: string;
  businessName?: string;
  summary?: string;
  angles?: string[];
  userAgent?: string;
  referer?: string;
  createdAt: number;
};

const SOURCE_LABEL: Record<Row["source"], { label: string; cls: string }> = {
  hero_video_link: { label: "Video link", cls: "bg-sky-500/15 text-sky-300" },
  cta_website: { label: "Website", cls: "bg-lime-500/15 text-lime-300" },
};

export function LeadsSection() {
  const { accessToken } = useSupabaseAuth();
  const listLeads = useAction(api.admin.listLeads);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setBusy(true);
    try {
      setRows((await listLeads({ accessToken })) as Row[]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }, [accessToken, listLeads]);

  // Initial load — every setState here happens strictly AFTER the await, so
  // nothing renders-cascades; rows === null shows the loader meanwhile.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = (await listLeads({ accessToken })) as Row[];
        if (!cancelled) { setRows(next); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken, listLeads]);

  if (rows === null) {
    return <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  }

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-white">Leads</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            {rows.length} captured on the landing page — hero video links + &quot;3 free videos&quot; website submits
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-[#26262c] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {err && <p className="px-6 py-3 text-[12px] text-red-400">{err}</p>}

      {rows.length === 0 && !err && (
        <p className="px-6 py-12 text-center text-[13px] text-zinc-600">No leads yet — they appear the moment someone drops a link or a website on the landing page.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-[#18181c] text-[11px] uppercase tracking-wide text-zinc-600">
                <th className="px-6 py-2.5 font-semibold">Source</th>
                <th className="px-4 py-2.5 font-semibold">URL</th>
                <th className="px-4 py-2.5 font-semibold">Business</th>
                <th className="px-4 py-2.5 font-semibold">Summary</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const src = SOURCE_LABEL[r.source];
                const expanded = open === r._id;
                return (
                  <tr
                    key={r._id}
                    className="border-b border-[#131317] align-top transition-colors hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => setOpen(expanded ? null : r._id)}
                  >
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${src.cls}`}>
                        {r.source === "cta_website" ? <Globe className="size-3" /> : <LinkIcon className="size-3" />}
                        {src.label}
                      </span>
                    </td>
                    <td className="max-w-[240px] px-4 py-3">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate text-sky-300 hover:underline"
                      >
                        {r.url}
                      </a>
                      {expanded && r.referer && <p className="mt-1 truncate text-[11px] text-zinc-600">from {r.referer}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-200">{r.businessName ?? "—"}</td>
                    <td className="max-w-[380px] px-4 py-3 text-zinc-400">
                      <p className={expanded ? "" : "line-clamp-2"}>{r.summary ?? "—"}</p>
                      {expanded && !!r.angles?.length && (
                        <ul className="mt-2 space-y-1">
                          {r.angles.map((a) => (
                            <li key={a} className="text-[11.5px] text-zinc-500">• {a}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-500">{timeAgo(r.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
