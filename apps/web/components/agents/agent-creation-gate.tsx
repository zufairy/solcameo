"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { BrandSplash } from "@/components/brand/BrandSplash";
import { useMyAgents } from "@/lib/client/useMyAgents";
import { useAgentQuota } from "@/hooks/use-agent-quota";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

/** Never mount new-agent tools until the account's quota has been checked. */
export function AgentCreationGate({ children, allowResume = false }: { children: ReactNode; allowResume?: boolean }) {
  const { authenticated, loading, login } = useSupabaseAuth();
  const searchParams = useSearchParams();
  const mint = allowResume ? searchParams.get("mint")?.trim() : undefined;
  const { quota, error, pending, refresh } = useAgentQuota(mint || "new");
  const { agents: myAgents } = useMyAgents();
  // A queued clip link survives the "pick an agent" step: owned-agent links carry it.
  const queued = !mint ? searchParams.get("q")?.trim() : "";
  const queuedSuffix = queued ? `&type=clipping&q=${encodeURIComponent(queued)}` : "";
  if (loading || pending) return <BrandSplash label="Checking access" fullscreen={false} />;
  if (authenticated && quota && (mint ? quota.agents.some(a => a.mintAddress === mint) : quota.canCreate)) return children;
  const title = !authenticated ? "Sign in to create your agent" : error ? "Could not check agent access" : mint ? "Agent unavailable" : queued ? "Pick an agent for this video" : "Agent limit reached";
  const used = quota?.agentCount ?? 0;
  const limit = quota?.agentLimit ?? 1;
  const profiles = new Map((myAgents ?? []).map((a) => [a.mintAddress, a]));
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain">
      {/* The builder behind stays visible but blurred and inert: this dialog can't be dismissed. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none overflow-hidden bg-[#1a1a1a] blur-[14px] saturate-125 scale-105">
        <div className="h-12 border-b border-white/10 bg-black" />
        <div className="grid h-full grid-cols-[320px_1fr]">
          <div className="space-y-3 border-r border-white/10 p-5">
            {[70, 90, 55, 80, 65].map((w, i) => <div key={i} className="h-3 rounded-full bg-white/15" style={{ width: `${w}%` }} />)}
          </div>
          <div className="relative">
            <div className="absolute left-[18%] top-[18%] size-40 rounded-3xl bg-lime-300/30" />
            <div className="absolute left-[46%] top-[34%] size-52 rounded-3xl bg-white/15" />
            <div className="absolute left-[30%] top-[58%] size-36 rounded-3xl bg-emerald-300/25" />
          </div>
        </div>
      </div>
      <div className="absolute inset-0 bg-white/30 backdrop-blur-xl" aria-hidden />

      <div className="relative grid min-h-full place-items-center p-4 sm:p-6">
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-limit-title"
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="relative flex max-h-[min(88dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white/70 text-[#141413] shadow-[0_40px_100px_-30px_rgba(20,20,19,0.45),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl"
        >
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full bg-lime-300/40 blur-3xl" />

          <header className="relative shrink-0 px-6 pb-4 pt-6">
            <span className="grid size-11 place-items-center rounded-2xl bg-[#141413] text-lime-300"><LockKeyhole className="size-5" /></span>
            <h1 id="agent-limit-title" className="mt-4 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-[#141413]/60">
              {!authenticated ? "Sign in to check your account and start building." : error || (mint ? "This agent was deleted or does not belong to your account. Open one of your agents instead." : `Your account has ${used} of ${limit} agent slots in use. Open an existing agent, or delete one from My Agents to free a slot.`)}
            </p>
            {authenticated && !error && !mint && (
              <div className="mt-3 flex items-center gap-1" aria-label={`${used} of ${limit} slots used`}>
                {Array.from({ length: Math.min(Math.max(limit, 1), 12) }).map((_, i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${i < used ? "bg-[#141413]" : "bg-black/10"}`} />
                ))}
              </div>
            )}
            {!authenticated && <button onClick={login} className="mt-4 h-11 rounded-full bg-[#141413] px-6 text-sm font-semibold text-white transition-colors hover:bg-black">Sign in</button>}
            {error && <button onClick={() => void refresh()} className="mt-4 h-11 rounded-full bg-[#141413] px-6 text-sm font-semibold text-white transition-colors hover:bg-black">Retry</button>}
          </header>

          {!!quota?.agents.length && (
            <ul className="relative min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-2 pt-1 [scrollbar-width:thin]" aria-label="Your agents">
              {quota.agents.map((agent, i) => {
                const prof = profiles.get(agent.mintAddress);
                return (
                  <motion.li key={agent.mintAddress} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * Math.min(i, 8), type: "spring", stiffness: 300, damping: 26 }}>
                    <Link
                      href={`/builder?mint=${encodeURIComponent(agent.mintAddress)}${queuedSuffix}`}
                      className="group flex items-center gap-3 rounded-2xl border border-white/80 bg-white/60 p-2.5 pr-3.5 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset] backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-[0_14px_30px_-18px_rgba(20,20,19,0.4)]"
                    >
                      <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-[#141413] ring-1 ring-black/5">
                        {prof?.avatarUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={prof.avatarUrl} alt="" className="size-full object-cover" />
                          : <span className="grid size-full place-items-center text-[15px] font-bold text-lime-300">{agent.name.charAt(0).toUpperCase()}</span>}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-semibold">{agent.name}</span>
                        <span className="block truncate text-[12px] text-[#141413]/50">{prof ? (prof.type === "clipping" ? "Clipping agent" : "AI influencer") + (prof.niche ? ` · ${prof.niche}` : "") : "Open agent"}</span>
                      </span>
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#141413]/90 text-white transition-transform group-hover:scale-110"><ArrowUpRight className="size-4" /></span>
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          )}

          <footer className="relative flex shrink-0 items-center gap-4 px-6 py-4 text-[13px] font-medium">
            <Link href="/control" className="text-[#141413] underline-offset-4 hover:underline">My Agents</Link>
          </footer>
        </motion.section>
      </div>
    </div>
  );
}
