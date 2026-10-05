"use client";

/* Admin-only view of submitted job applications. The rows carry applicant PII
   (email/phone/telegram/linkedin) + signed résumé URLs, so they are fetched
   from the admin-gated route /api/hiring/submissions (which proves the caller
   is an admin server-side). A matching client gate below is UX-only — the real
   boundary is the route.
   Matches the "City of Agents" theme: #0a0a0f cinematic bg, teal #00FFD1,
   bordered panels, Space Grotesk / JetBrains Mono. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { jbMono } from "@/lib/siteFonts";
import { Loader2, Lock } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ArrowLeft, Download, Mail, MapPin, ExternalLink, Inbox, Send } from "lucide-react";

const SPACE = { fontFamily: "var(--font-space)" } as const;
const MONO = { fontFamily: "var(--font-jbmono)" } as const;

type AppRow = {
  _id: string; role: string; fullName: string; email: string;
  phone?: string; telegram?: string; country?: string; location?: string;
  portfolioUrl?: string; linkedinUrl?: string;
  coverLetter?: string; resumeName?: string; status: string; createdAt: number; resumeUrl: string | null;
};

function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function GateShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#0a0a0f] px-6 text-white" style={{ fontFamily: "var(--font-inter)" }}>
      <div className="max-w-sm border border-[#2a2a3e] bg-[#13131f] px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center border border-[#2a2a3e] bg-[#1a1a2e]">
          <Lock className="size-5 text-white/40" strokeWidth={1.75} />
        </div>
        <h1 className="text-[17px] font-bold" style={SPACE}>{title}</h1>
        <div className="mt-2 text-[13px] text-white/45">{children}</div>
      </div>
    </main>
  );
}

export default function SubmissionsPage() {
  const { profile, loading: authLoading, signInWithGoogle } = useSupabaseAuth();
  const [apps, setApps] = useState<AppRow[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isAdmin = !!profile?.isAdmin;

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setApps(undefined);
    setLoadError(null);
    // The global fetch interceptor attaches a fresh Privy Bearer token to /api/ calls.
    fetch("/api/hiring/submissions")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ applications: AppRow[] }>;
      })
      .then((data) => { if (!cancelled) setApps(data.applications ?? []); })
      .catch(() => { if (!cancelled) { setApps([]); setLoadError("Couldn’t load applications. Try again."); } });
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0f]">
        <Loader2 className="size-6 animate-spin text-white/40" />
      </main>
    );
  }

  if (!profile) {
    return (
      <GateShell title="Admin access">
        <p>Sign in with an admin account to view applications.</p>
        <button
          onClick={() => signInWithGoogle()}
          className="mt-4 inline-flex items-center gap-2 bg-[#00FFD1]/10 px-4 py-2 text-[13px] font-semibold text-[#00FFD1] ring-1 ring-[#00FFD1]/25 transition-colors hover:bg-[#00FFD1]/15"
        >
          Sign in
        </button>
      </GateShell>
    );
  }

  if (!isAdmin) {
    return (
      <GateShell title="Not authorized">
        <p>Your account doesn&rsquo;t have admin access. Ask an existing admin to grant it.</p>
      </GateShell>
    );
  }

  return (
    <main className={`${jbMono.variable} relative min-h-screen bg-[#0a0a0f] text-white antialiased`} style={{ fontFamily: "var(--font-inter)" }}>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0f]">
        <div className="absolute inset-0 [background:radial-gradient(55%_45%_at_50%_0%,rgba(0,255,209,0.06),transparent_60%),radial-gradient(50%_55%_at_85%_25%,rgba(124,77,255,0.08),transparent_60%)]" />
        <div className="city-grid absolute inset-0 opacity-40" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-14">
        <div className="flex items-center justify-between gap-4">
          <Link href="/hiring" className="inline-flex items-center gap-2 text-[13px] text-white/55 transition-colors hover:text-white">
            <ArrowLeft className="size-4" strokeWidth={1.75} /> Hiring
          </Link>
          <span className="text-[11px] uppercase tracking-[0.18em] text-white/35" style={MONO}>
            {apps ? `${apps.length} application${apps.length === 1 ? "" : "s"}` : "Loading…"}
          </span>
        </div>

        <div className="mt-8 border-b border-[#2a2a3e] pb-5">
          <span className="text-[10px] uppercase tracking-[0.24em] text-[#00FFD1]" style={MONO}>Inbox</span>
          <h1 className="mt-2 text-4xl font-bold tracking-tight" style={SPACE}>Applications</h1>
          <p className="mt-2 text-[14px] text-white/45">Everything submitted through the Hiring page, newest first.</p>
        </div>

        {apps === undefined && (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse border border-[#2a2a3e] bg-[#1a1a2e]" />)}
          </div>
        )}

        {apps && apps.length === 0 && (
          <div className="mt-12 flex flex-col items-center gap-3 border border-dashed border-[#2a2a3e] bg-[#13131f] py-20 text-center">
            <Inbox className="size-8 text-white/30" strokeWidth={1.75} />
            <p className="text-[15px] font-medium text-white/70" style={SPACE}>{loadError ? "Couldn’t load applications" : "No applications yet"}</p>
            <p className="text-[13px] text-white/40">{loadError ?? "They’ll appear here the moment someone applies."}</p>
          </div>
        )}

        {apps && apps.length > 0 && (
          <div className="mt-8 space-y-3">
            {apps.map((a) => (
              <div key={a._id} className="border border-[#2a2a3e] bg-[#1a1a2e] p-5 transition-colors hover:border-[#00FFD1]/40 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-[17px] font-bold tracking-tight" style={SPACE}>{a.fullName}</h2>
                      <span className="border border-[#00FFD1]/30 bg-[#00FFD1]/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#00FFD1]" style={MONO}>{a.role}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-white/50">
                      <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1.5 transition-colors hover:text-white"><Mail className="size-3.5" strokeWidth={1.75} />{a.email}</a>
                      {a.phone && <span>{a.phone}</span>}
                      {a.telegram && <a href={`https://t.me/${a.telegram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[#00FFD1]/80 transition-colors hover:text-[#00FFD1]"><Send className="size-3.5" strokeWidth={1.75} />{a.telegram}</a>}
                      {(a.country || a.location) && <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" strokeWidth={1.75} />{[a.location, a.country].filter(Boolean).join(" · ")}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-white/35" style={MONO}>{timeAgo(a.createdAt)}</span>
                </div>

                {a.coverLetter && <p className="mt-4 whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/65">{a.coverLetter}</p>}

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  {a.resumeUrl && <a href={a.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#00FFD1]/10 px-3.5 py-1.5 text-[12.5px] font-medium text-[#00FFD1] ring-1 ring-[#00FFD1]/25 transition-colors hover:bg-[#00FFD1]/15"><Download className="size-3.5" strokeWidth={1.75} /> {a.resumeName ?? "Résumé"}</a>}
                  {a.portfolioUrl && <a href={a.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border border-[#2a2a3e] px-3.5 py-1.5 text-[12.5px] text-white/60 transition-colors hover:border-white/30 hover:text-white"><ExternalLink className="size-3.5" strokeWidth={1.75} /> Portfolio</a>}
                  {a.linkedinUrl && <a href={a.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border border-[#2a2a3e] px-3.5 py-1.5 text-[12.5px] text-white/60 transition-colors hover:border-white/30 hover:text-white"><ExternalLink className="size-3.5" strokeWidth={1.75} /> Profile</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
