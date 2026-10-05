"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import MintCelebration from "@/components/builder/MintCelebration";
import velloLogo from "@/assets/lo.png";
import {
  Building2, User, TrendingUp, ShoppingBag, Users, Compass,
  Scissors, Sparkles, ArrowRight, ArrowLeft, Check, X,
} from "lucide-react";

/**
 * First-run onboarding — a step-by-step glass modal on /home that captures
 * personal/business + niche + goal (saved via users.completeOnboarding), then
 * ends by having the operator pick a starting path (clip vs. build an agent).
 * That choice doesn't navigate directly — it closes the modal and hands off
 * to <OnboardingTour> (see onboarding-tour.tsx), which spotlights the real
 * shortcut button on the page so the operator clicks it themselves. Mounted
 * once from home-dashboard.tsx, gated on
 * `profile && !onboardingCompletedAt && !onboardingSkippedAt`.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const SPRING = { type: "spring", stiffness: 340, damping: 30 } as const;
const STEPS = ["welcome", "type", "goal", "path"] as const;
type Step = (typeof STEPS)[number];

type AccountType = "personal" | "business";
type Goal = "grow_views" | "sell_product" | "build_audience" | "other";
export type TourTarget = "clip" | "agent";

const GOALS: { id: Goal; label: string; sub: string; Icon: typeof TrendingUp }[] = [
  { id: "grow_views", label: "Grow views", sub: "Rack up reach and followers", Icon: TrendingUp },
  { id: "sell_product", label: "Sell a product", sub: "Turn content into sales", Icon: ShoppingBag },
  { id: "build_audience", label: "Build an audience", sub: "Grow a loyal following", Icon: Users },
  { id: "other", label: "Just exploring", sub: "Not sure yet, show me around", Icon: Compass },
];

export function OnboardingModal({
  open, onClose, onChoosePath,
}: {
  open: boolean;
  onClose: () => void;
  onChoosePath: (target: TourTarget) => void;
}) {
  const { getFreshToken, refreshProfile } = useSupabaseAuth();
  const completeOnboarding = useAction(api.users.completeOnboarding);
  const skipOnboarding = useAction(api.users.skipOnboarding);

  const [stepIdx, setStepIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [niche, setNiche] = useState("");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [pathChoice, setPathChoice] = useState<TourTarget | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const step: Step = STEPS[stepIdx];

  const go = (delta: 1 | -1) => { setDir(delta); setStepIdx((i) => Math.max(0, Math.min(STEPS.length - 1, i + delta))); };

  // Measures whichever step is currently mounted and animates the modal's
  // content area to that exact height — steps vary a lot (a 2-line welcome vs.
  // a 4-item goal list), so a fixed min-height either clipped the tall ones or
  // left a lot of dead space on the short ones.
  const measureRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>();
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // `entries[0].contentRect` excludes the element's OWN padding (the spec's
    // content-box, not border-box) — measureRef carries px-6/pt-5/pb-6 itself,
    // so that number came in short by exactly that padding and the outer
    // container was set a few pixels too small, clipping the bottom of every
    // step (the "Let's go" button on the welcome step, worst of all). Reading
    // offsetHeight instead gives the real border-box height that matches what
    // is actually on screen.
    const ro = new ResizeObserver(() => setContentHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const skip = async () => {
    onClose();
    try {
      const token = await getFreshToken();
      if (token) await skipOnboarding({ accessToken: token });
    } catch {
      // best-effort — never block leaving the modal on this failing
    }
  };

  const choosePath = (target: TourTarget) => {
    onClose();
    onChoosePath(target);
    // Fire-and-forget — the tour starts immediately, this just persists the
    // answers behind it.
    if (accountType && goal) {
      void (async () => {
        try {
          const token = await getFreshToken();
          if (token) {
            await completeOnboarding({ accessToken: token, accountType, niche: niche.trim() || undefined, goal });
            await refreshProfile();
          }
        } catch {
          // best-effort
        }
      })();
    }
  };

  // Picking a path card only selects it (see PathCard's `selected` state) —
  // finalizing is a deliberate second action, same as every other step's
  // Continue button. Confetti plays over the still-open modal for a beat
  // before choosePath closes it, so the celebration is actually seen.
  const finalize = () => { if (pathChoice) setCelebrating(true); };
  useEffect(() => {
    if (!celebrating || !pathChoice) return;
    const t = setTimeout(() => choosePath(pathChoice), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choosePath closes over fresh state each render; only `celebrating` should retrigger this
  }, [celebrating]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={SPRING}
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to Vello"
            className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/15 bg-white/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_40px_120px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
          >
            {/* Progress dots + skip */}
            <div className="flex items-center justify-between px-6 pt-5">
              <div className="flex items-center gap-1.5">
                {STEPS.map((s, i) => (
                  <motion.span
                    key={s}
                    animate={{ width: i === stepIdx ? 20 : 6, backgroundColor: i <= stepIdx ? "#a3e635" : "rgba(255,255,255,0.15)" }}
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                    className="h-1.5 rounded-full"
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={skip}
                className="flex items-center gap-1 text-[11.5px] font-medium text-white/40 transition-colors hover:text-white"
              >
                Skip <X className="size-3" />
              </button>
            </div>

            <motion.div
              animate={{ height: contentHeight ?? "auto" }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <div ref={measureRef} className="relative px-6 pb-6 pt-5">
              <AnimatePresence mode="wait" custom={dir}>
                {step === "welcome" && (
                  <StepShell key="welcome" dir={dir}>
                    <div className="flex flex-col items-center pt-6 text-center">
                      <Image src={velloLogo} alt="Vello" className="h-14 w-auto object-contain" />
                      <h2 className="mt-5 text-[22px] font-semibold leading-tight text-white">Welcome to Vello</h2>
                      <p className="mt-2.5 max-w-[290px] text-[13.5px] leading-relaxed text-white/50">
                        A few quick questions, then we&apos;ll get your first AI agent making and posting video for you.
                      </p>
                      <button
                        type="button"
                        onClick={() => go(1)}
                        className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-[14px] font-semibold text-neutral-900 transition-transform active:scale-[0.98] hover:brightness-95"
                      >
                        Let&apos;s go <ArrowRight className="size-4" />
                      </button>
                    </div>
                  </StepShell>
                )}

                {step === "type" && (
                  <StepShell key="type" dir={dir}>
                    <h2 className="text-[18.5px] font-semibold text-white">How will you use Vello?</h2>
                    <p className="mt-1.5 text-[13px] text-white/45">This tunes the content and suggestions your agent leans on.</p>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      {(
                        [
                          { id: "personal" as const, label: "Personal", sub: "Building my own brand", Icon: User },
                          { id: "business" as const, label: "Business", sub: "Growing a company", Icon: Building2 },
                        ]
                      ).map(({ id, label, sub, Icon }) => {
                        const selected = accountType === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setAccountType(id)}
                            className={`flex flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition-all ${
                              selected ? "border-lime-400/50 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                            }`}
                          >
                            <span className={`grid size-9 place-items-center rounded-xl transition-colors ${selected ? "bg-lime-400 text-black" : "bg-white/[0.07] text-white/50"}`}>
                              <Icon className="size-4.5" />
                            </span>
                            <span className="text-[14px] font-medium text-white">{label}</span>
                            <span className="text-[11.5px] leading-snug text-white/40">{sub}</span>
                          </button>
                        );
                      })}
                    </div>
                    <label htmlFor="onboarding-niche" className="mt-4 block text-[11px] font-semibold uppercase tracking-widest text-white/35">
                      Your niche <span className="normal-case text-white/25">(optional)</span>
                    </label>
                    <input
                      id="onboarding-niche"
                      value={niche}
                      onChange={(e) => setNiche(e.target.value)}
                      placeholder="Fitness, real estate, SaaS…"
                      className="mt-1.5 h-11 w-full rounded-xl border border-white/12 bg-white/[0.05] px-3.5 text-[13.5px] text-white outline-none placeholder:text-white/25 focus:border-lime-400/50"
                    />
                    <StepNav onBack={() => go(-1)} onNext={() => go(1)} nextDisabled={!accountType} />
                  </StepShell>
                )}

                {step === "goal" && (
                  <StepShell key="goal" dir={dir}>
                    <h2 className="text-[18.5px] font-semibold text-white">What&apos;s your main goal?</h2>
                    <p className="mt-1.5 text-[13px] text-white/45">Your agent will lean its content toward this.</p>
                    <div className="mt-5 space-y-2">
                      {GOALS.map(({ id, label, sub, Icon }) => {
                        const selected = goal === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setGoal(id)}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                              selected ? "border-lime-400/50 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                            }`}
                          >
                            <span className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${selected ? "bg-lime-400 text-black" : "bg-white/[0.07] text-white/50"}`}>
                              <Icon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-medium text-white">{label}</span>
                              <span className="block truncate text-[11.5px] text-white/40">{sub}</span>
                            </span>
                            {selected && <Check className="size-4 shrink-0 text-lime-400" />}
                          </button>
                        );
                      })}
                    </div>
                    <StepNav onBack={() => go(-1)} onNext={() => go(1)} nextDisabled={!goal} />
                  </StepShell>
                )}

                {step === "path" && (
                  <StepShell key="path" dir={dir}>
                    <div className="text-center">
                      <h2 className="text-[18.5px] font-semibold text-white">Where do you want to start?</h2>
                      <p className="mt-1.5 text-[13px] text-white/45">Pick one, then finish up, we&apos;ll point you right at it.</p>
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <PathCard
                        Icon={Scissors}
                        label="Clip a video"
                        sub="Turn a link into short clips"
                        selected={pathChoice === "clip"}
                        onClick={() => setPathChoice("clip")}
                      />
                      <PathCard
                        Icon={Sparkles}
                        label="Build an agent"
                        sub="A persona that posts on its own"
                        selected={pathChoice === "agent"}
                        onClick={() => setPathChoice("agent")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={finalize}
                      disabled={!pathChoice || celebrating}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-[14px] font-semibold text-neutral-900 transition-transform active:scale-[0.98] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Finish setup <Check className="size-4" />
                    </button>
                    <button type="button" onClick={() => go(-1)} disabled={celebrating} className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12px] text-white/40 transition-colors hover:text-white disabled:opacity-30">
                      <ArrowLeft className="size-3.5" /> Back
                    </button>
                  </StepShell>
                )}
              </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>

          <MintCelebration active={celebrating} durationMs={1100} label="YOU'RE ALL SET ✦" />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Shared per-step wrapper — a horizontal slide-in matching the nav direction
 *  (forward slides in from the right, back from the left), fading as it goes. */
function StepShell({ dir, children }: { dir: number; children: React.ReactNode }) {
  return (
    <motion.div
      custom={dir}
      initial={{ opacity: 0, x: 18 * dir }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 * dir }}
      transition={{ duration: 0.28, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

function PathCard({ Icon, label, sub, selected, onClick }: { Icon: typeof Scissors; label: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group flex flex-col items-center gap-2.5 rounded-2xl border px-3 py-6 text-center transition-all hover:-translate-y-0.5 ${
        selected ? "border-lime-400/50 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-lime-400/40 hover:bg-lime-400/[0.06]"
      }`}
    >
      <span className={`grid size-11 place-items-center rounded-xl transition-colors ${selected ? "bg-lime-400 text-black" : "bg-white/[0.07] text-white/60 group-hover:bg-lime-400 group-hover:text-black"}`}>
        <Icon className="size-5" />
      </span>
      <span className="text-[13.5px] font-medium text-white">{label}</span>
      <span className="text-[11px] leading-snug text-white/40">{sub}</span>
      {selected && <Check className="size-4 text-lime-400" />}
    </button>
  );
}

function StepNav({ onBack, onNext, nextDisabled }: { onBack: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="mt-6 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <ArrowLeft className="size-3.5" /> Back
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-[13.5px] font-semibold text-neutral-900 transition-[filter,opacity] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-30"
      >
        Continue <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}
