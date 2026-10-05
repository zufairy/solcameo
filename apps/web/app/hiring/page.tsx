"use client";

/* ───────────────────────────────────────────────────────────────────────────
   Hiring — apply to roles at Vello.
   Matches the landing ("City of Agents") system: #0a0a0f cinematic bg, teal
   #00FFD1 accent, bordered bracketed panels, Space Grotesk display + JetBrains
   Mono technical labels. Reuses the landing Navigation + Footer. Submissions
   persist to Convex (jobApplications) → viewable at /hiring/submissions.
   ─────────────────────────────────────────────────────────────────────────── */

import { useRef, useState, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ArrowRight, ArrowUpRight, Check, Paperclip, X, MapPin, Clock3, Loader2, Zap, Globe2, Coins, Users, ChevronDown } from "lucide-react";
import { Navigation, Footer } from "@/components/mach/sections";
import { Button, ScrollReveal, Bracket, LiveDot } from "@/components/mach/ui";
import HeroIllustration from "@/components/hiring/HeroIllustration";

const SPACE = { fontFamily: "var(--font-space)" } as const;
const MONO = { fontFamily: "var(--font-jbmono)" } as const;


type Role = { id: string; title: string; team: string; type: string; location: string; blurb: string };

const ROLES: Role[] = [
  { id: "founding-frontend", title: "Founding Frontend Engineer", team: "Product", type: "Full-time", location: "Remote", blurb: "Own the agent-builder experience end to end — motion, interactions, the craft people screenshot." },
  { id: "video-pipeline", title: "AI Video Pipeline Engineer", team: "AI", type: "Full-time", location: "Remote", blurb: "Push frames through Veo & nano-banana. Make autonomous agents render scroll-stopping video at scale." },
  { id: "solana-protocol", title: "Solana Protocol Engineer", team: "Protocol", type: "Full-time", location: "Remote", blurb: "Escrow, attestations, USDC payouts — on-chain settlement for an economy of AI creators." },
  { id: "growth-community", title: "Growth & Community Lead", team: "Growth", type: "Full-time", location: "Remote", blurb: "Turn operators into a movement. Own the loop from first agent to first payout." },
  { id: "design-engineer", title: "Design Engineer", team: "Design", type: "Full-time", location: "Remote", blurb: "Live in the seam between Figma and React — systems, micro-interactions, taste." },
  { id: "open", title: "Open Application", team: "Anywhere", type: "Flexible", location: "Remote", blurb: "Don't see your role? Tell us what you'd build and why it has to be Vello." },
];

const PERKS = [
  { icon: Globe2, label: "Remote-first", note: "Async, global, outcome-driven." },
  { icon: Coins, label: "Token + equity", note: "Own a slice of the protocol." },
  { icon: Zap, label: "Ship to millions", note: "Agents post across every platform." },
  { icon: Users, label: "Tiny senior team", note: "High trust, zero bureaucracy." },
];

/* Bordered, bracketed panel — the landing's surface language. */
function Panel({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={`group/panel relative border border-[#2a2a3e] bg-[#1a1a2e] ${hover ? "transition-all duration-300 hover:-translate-y-0.5 hover:border-[#00FFD1]/40 hover:bg-[#20203a]" : ""} ${className}`}>
      <Bracket className="opacity-25 group-hover/panel:opacity-100" />
      {children}
    </div>
  );
}

const FIELD =
  "w-full border border-[#2a2a3e] bg-[#13131f] px-3.5 py-3 text-[14px] text-white placeholder-white/25 outline-none transition-colors duration-300 focus:border-[#00FFD1]/55 focus:bg-[#16162a]";

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.18em] text-white/40" style={MONO}>
        {label}{required && <span className="text-[#00FFD1]"> *</span>}
      </span>
      {children}
    </label>
  );
}

export default function HiringPage() {
  const reduce = useReducedMotion();
  const generateUploadUrl = useMutation(api.jobApplications.generateUploadUrl);
  const submit = useMutation(api.jobApplications.submit);
  const formRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [role, setRole] = useState("");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", telegram: "", country: "", location: "", portfolioUrl: "", linkedinUrl: "", coverLetter: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const [resume, setResume] = useState<{ name: string; size: number; storageId: Id<"_storage"> } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");

  const selectedRole = ROLES.find((r) => r.id === role);

  const pickRole = (id: string) => {
    setRole(id);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { setError("Résumé must be under 12 MB."); return; }
    setError(""); setUploading(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setResume({ name: file.name, size: file.size, storageId });
    } catch { setError("Couldn't upload that file — try again."); }
    finally { setUploading(false); }
  }, [generateUploadUrl]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!role) { setError("Pick a role above first."); formRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!form.fullName.trim()) { setError("Your name is required."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { setError("Enter a valid email."); return; }
    setStatus("submitting");
    try {
      await submit({
        role: selectedRole?.title ?? role,
        fullName: form.fullName, email: form.email,
        phone: form.phone || undefined, telegram: form.telegram || undefined,
        country: form.country || undefined, location: form.location || undefined,
        portfolioUrl: form.portfolioUrl || undefined, linkedinUrl: form.linkedinUrl || undefined,
        coverLetter: form.coverLetter || undefined,
        resumeStorageId: resume?.storageId, resumeName: resume?.name,
      });
      setStatus("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { setError((err as Error).message || "Something went wrong."); setStatus("idle"); }
  };

  return (
    <main className="relative min-h-screen bg-[#0a0a0f] text-white antialiased" style={{ fontFamily: "var(--font-inter)" }}>
      {/* Shared cinematic background — same atmosphere as the landing. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0f]">
        <div className="absolute inset-0 [background:radial-gradient(55%_45%_at_50%_0%,rgba(0,255,209,0.07),transparent_60%),radial-gradient(50%_55%_at_85%_25%,rgba(124,77,255,0.10),transparent_60%),radial-gradient(55%_55%_at_12%_70%,rgba(0,120,255,0.09),transparent_60%)]" />
        <div className="city-grid absolute inset-0 opacity-40" />
      </div>

      <div className="relative z-10">
        <Navigation />

        <AnimatePresence mode="wait">
          {status === "done" ? (
            /* ── Success ──────────────────────────────────────────────────── */
            <motion.section key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto flex min-h-[80vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
              <motion.div initial={reduce ? false : { scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 18 }} className="grid size-20 place-items-center rounded-full border border-[#00FFD1]/30 bg-[#00FFD1]/10">
                <Check className="size-9 text-[#00FFD1]" strokeWidth={2} />
              </motion.div>
              <h1 className="mt-8 text-balance text-4xl font-bold tracking-tight sm:text-5xl" style={SPACE}>Application received.</h1>
              <p className="mt-4 max-w-md text-pretty text-[15px] leading-relaxed text-white/55">
                Thanks{form.fullName ? `, ${form.fullName.split(" ")[0]}` : ""}. We review every application personally — if there&rsquo;s a fit for <span className="text-[#00FFD1]">{selectedRole?.title}</span>, you&rsquo;ll hear from us at <span className="text-white/85">{form.email}</span>.
              </p>
              <div className="mt-10"><Button href="/" trailing={<ArrowRight className="size-4" strokeWidth={2} />}>Back to Vello</Button></div>
            </motion.section>
          ) : (
            <motion.div key="form" exit={{ opacity: 0 }}>
              {/* ── Hero ───────────────────────────────────────────────────── */}
              <section className="mx-auto max-w-6xl px-6 pt-32 pb-16 sm:pt-40">
                <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
                  <div>
                <ScrollReveal>
                  <span className="inline-flex items-center gap-2 border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-[#00FFD1]" style={MONO}>
                    <LiveDot size="sm" /> Careers // Vello
                  </span>
                </ScrollReveal>
                <ScrollReveal delay={0.06}>
                  <h1 className="mt-6 max-w-4xl text-balance text-[clamp(2.6rem,7vw,5rem)] font-bold leading-[0.95] tracking-[-0.03em]" style={SPACE}>
                    Build the <span className="bg-gradient-to-r from-[#00FFD1] to-[#7C4DFF] bg-clip-text text-transparent">agent economy.</span>
                  </h1>
                </ScrollReveal>
                <ScrollReveal delay={0.12}>
                  <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-white/55">
                    A small senior team building the protocol where autonomous AI creators work, earn, and live on Solana. Obsess over craft? Put your work in front of millions.
                  </p>
                </ScrollReveal>
                <ScrollReveal delay={0.18}>
                  <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <Button onClick={() => document.getElementById("roles")?.scrollIntoView({ behavior: "smooth" })} trailing={<ArrowRight className="size-4" strokeWidth={2} />}>View open roles</Button>
                    <div className="flex items-center gap-x-5 text-[11px] uppercase tracking-[0.18em] text-white/40" style={MONO}>
                      <span>{ROLES.length} roles</span><span className="text-white/15">/</span><span>remote-first</span><span className="text-white/15">/</span><span>on-chain equity</span>
                    </div>
                  </div>
                </ScrollReveal>
                  </div>
                  {/* Animated agent-constellation illustration */}
                  <ScrollReveal delay={0.1} className="mt-4 lg:mt-0">
                    <HeroIllustration />
                  </ScrollReveal>
                </div>

                {/* Perks strip — packed */}
                <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden border border-[#2a2a3e] bg-[#2a2a3e] md:grid-cols-4">
                  {PERKS.map((p, i) => (
                    <ScrollReveal key={p.label} delay={0.06 * i} className="bg-[#13131f]">
                      <div className="flex h-full flex-col gap-2 p-5">
                        <p.icon className="size-4 text-[#00FFD1]" strokeWidth={1.75} />
                        <span className="text-[14px] font-semibold text-white" style={SPACE}>{p.label}</span>
                        <span className="text-[12px] leading-snug text-white/45">{p.note}</span>
                      </div>
                    </ScrollReveal>
                  ))}
                </div>
              </section>

              {/* ── Roles ──────────────────────────────────────────────────── */}
              <section id="roles" className="mx-auto max-w-6xl px-6 py-16">
                <ScrollReveal>
                  <div className="flex items-end justify-between gap-4 border-b border-[#2a2a3e] pb-4">
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={SPACE}>Open roles</h2>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/35" style={MONO}>{ROLES.length} positions</span>
                  </div>
                </ScrollReveal>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {ROLES.map((r, i) => {
                    const active = role === r.id;
                    return (
                      <ScrollReveal key={r.id} delay={Math.min(i * 0.05, 0.3)}>
                        <button onClick={() => pickRole(r.id)} aria-pressed={active}
                          className={`group/card relative flex h-full w-full flex-col gap-3 border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 ${active ? "border-[#00FFD1]/50 bg-[#00FFD1]/[0.06]" : "border-[#2a2a3e] bg-[#1a1a2e] hover:border-[#00FFD1]/40 hover:bg-[#20203a]"}`}>
                          <Bracket className="opacity-25 group-hover/card:opacity-100" />
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/40" style={MONO}>
                            <span className="text-[#00FFD1]">{r.team}</span><span className="text-white/15">/</span><span className="inline-flex items-center gap-1"><Clock3 className="size-3" strokeWidth={1.75} />{r.type}</span><span className="text-white/15">/</span><span className="inline-flex items-center gap-1"><MapPin className="size-3" strokeWidth={1.75} />{r.location}</span>
                          </div>
                          <h3 className={`text-[19px] font-bold leading-tight tracking-tight transition-colors ${active ? "text-[#00FFD1]" : "text-white"}`} style={SPACE}>{r.title}</h3>
                          <p className="text-[13px] leading-relaxed text-white/50">{r.blurb}</p>
                          <span className={`mt-auto inline-flex items-center gap-1.5 pt-1 text-[12px] font-medium transition-colors ${active ? "text-[#00FFD1]" : "text-white/45 group-hover/card:text-[#00FFD1]"}`} style={SPACE}>
                            {active ? <><Check className="size-3.5" strokeWidth={2} /> Selected — apply below</> : <>Apply <ArrowUpRight className="size-3.5 transition-transform duration-300 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5" strokeWidth={2} /></>}
                          </span>
                        </button>
                      </ScrollReveal>
                    );
                  })}
                </div>
              </section>

              {/* ── Apply form ─────────────────────────────────────────────── */}
              <section ref={formRef} className="mx-auto max-w-4xl scroll-mt-24 px-6 py-16">
                <ScrollReveal>
                  <div className="flex items-end justify-between gap-4 border-b border-[#2a2a3e] pb-4">
                    <div>
                      <span className="text-[10px] uppercase tracking-[0.24em] text-[#00FFD1]" style={MONO}>Application</span>
                      <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={SPACE}>
                        {selectedRole ? <>Apply — <span className="text-[#00FFD1]">{selectedRole.title}</span></> : "Tell us about you"}
                      </h2>
                    </div>
                    <span className="hidden text-[11px] uppercase tracking-[0.18em] text-white/35 sm:block" style={MONO}>~2 min</span>
                  </div>
                </ScrollReveal>

                <ScrollReveal delay={0.1}>
                  <Panel className="mt-6">
                    <form onSubmit={onSubmit} className="p-6 sm:p-8">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {/* Role dropdown — stays in sync with the cards above */}
                        <div className="sm:col-span-2">
                          <Field label="Role" required>
                            <div className="relative">
                              <select
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                className={`${FIELD} cursor-pointer appearance-none pr-10 ${role ? "text-white" : "text-white/35"}`}
                              >
                                <option value="" disabled className="bg-[#13131f] text-white/40">Select a role…</option>
                                {ROLES.map((r) => (
                                  <option key={r.id} value={r.id} className="bg-[#13131f] text-white">{r.title}</option>
                                ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-white/40" strokeWidth={1.75} />
                            </div>
                          </Field>
                        </div>
                        <div className="sm:col-span-2"><Field label="Full name" required><input className={FIELD} value={form.fullName} onChange={set("fullName")} placeholder="Ada Lovelace" autoComplete="name" /></Field></div>
                        <Field label="Email" required><input type="email" className={FIELD} value={form.email} onChange={set("email")} placeholder="ada@domain.com" autoComplete="email" /></Field>
                        <Field label="Phone"><input type="tel" className={FIELD} value={form.phone} onChange={set("phone")} placeholder="+1 …" autoComplete="tel" /></Field>
                        <Field label="Telegram"><input className={FIELD} value={form.telegram} onChange={set("telegram")} placeholder="@username" /></Field>
                        <Field label="Country"><input className={FIELD} value={form.country} onChange={set("country")} placeholder="Country" autoComplete="country-name" /></Field>
                        <Field label="City / timezone"><input className={FIELD} value={form.location} onChange={set("location")} placeholder="City · GMT+8" /></Field>
                        <Field label="Portfolio / GitHub"><input type="url" className={FIELD} value={form.portfolioUrl} onChange={set("portfolioUrl")} placeholder="https://…" /></Field>
                        <div className="sm:col-span-2"><Field label="LinkedIn / X"><input type="url" className={FIELD} value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://…" /></Field></div>
                        <div className="sm:col-span-2"><Field label="Why Vello?"><textarea rows={4} className={`${FIELD} resize-none leading-relaxed`} value={form.coverLetter} onChange={set("coverLetter")} placeholder="What would you build, and why does it have to be us?" /></Field></div>

                        <div className="sm:col-span-2">
                          <Field label="Résumé / CV">
                            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => void handleFile(e.target.files?.[0])} />
                            {resume ? (
                              <div className="flex items-center justify-between gap-3 border border-[#00FFD1]/30 bg-[#00FFD1]/[0.06] px-4 py-3">
                                <span className="flex min-w-0 items-center gap-2.5 text-[13px]"><Paperclip className="size-4 shrink-0 text-[#00FFD1]" strokeWidth={1.75} /><span className="truncate text-white/90">{resume.name}</span><span className="shrink-0 text-[11px] text-white/40" style={MONO}>{(resume.size / 1024 / 1024).toFixed(1)} MB</span></span>
                                <button type="button" onClick={() => setResume(null)} aria-label="Remove résumé" className="grid size-7 shrink-0 place-items-center text-white/40 transition-colors hover:text-white"><X className="size-4" strokeWidth={1.75} /></button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => fileRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                                onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files?.[0]); }}
                                className={`flex w-full flex-col items-center gap-1.5 border border-dashed px-4 py-7 transition-colors duration-300 ${dragging ? "border-[#00FFD1]/60 bg-[#00FFD1]/[0.07]" : "border-[#2a2a3e] bg-[#13131f] hover:border-white/25"}`}>
                                {uploading ? <Loader2 className="size-5 animate-spin text-[#00FFD1]" strokeWidth={1.75} /> : <Paperclip className="size-5 text-white/45" strokeWidth={1.75} />}
                                <span className="text-[13px] font-medium text-white/80">{uploading ? "Uploading…" : "Drop your résumé or click to browse"}</span>
                                <span className="text-[10px] uppercase tracking-[0.16em] text-white/30" style={MONO}>PDF or DOC · max 12 MB</span>
                              </button>
                            )}
                          </Field>
                        </div>
                      </div>

                      <AnimatePresence>
                        {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-[13px] text-rose-200">{error}</motion.p>}
                      </AnimatePresence>

                      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-[#2a2a3e] pt-6">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-white/30" style={MONO}>We read every application.</span>
                        <button type="submit" disabled={status === "submitting" || uploading}
                          className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 text-[14px] font-medium text-[#0a0a0f] [background:linear-gradient(135deg,#00FFD1,#00CCAA)] shadow-[0_0_24px_rgba(0,255,209,0.35)] transition-all duration-300 hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_36px_rgba(0,255,209,0.5)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FFD1]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]" style={SPACE}>
                          {status === "submitting" ? <><Loader2 className="size-4 animate-spin" strokeWidth={2} /> Sending…</> : <>Submit application <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2} /></>}
                        </button>
                      </div>
                    </form>
                  </Panel>
                </ScrollReveal>
              </section>

              <Footer />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
