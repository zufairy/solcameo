"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useSiwsSession } from "@/hooks/use-siws-session";
import type { ShowBible } from "@/lib/builder/showBible";
import { draftFromBible, draftToBible, draftStepComplete, emptyDraft, type OnboardingDraft } from "@/lib/builder/onboardingDraft";
import { StepPremise, StepModel, StepFormats, StepTunables, StepVoice, StepCadence, effectiveEngine } from "./steps";
import SampleGate, { launchKey as sampleLaunchKey, type AdjustChip } from "./SampleGate";

/** Step-by-step onboarding wizard — collects an OnboardingDraft across 5
 *  content steps, commits the mapped Show Bible, then renders ONE sample
 *  video against the saved bible for approval (SampleGate) before handing
 *  off to onDone. Full-height dark glass panel inside the builder tab (not a
 *  modal) — same control surface as VideoDirectorTab, same blur/y stagger
 *  as components/auth/auth-form.tsx. */

/** SampleGate's onAdjust chips map back onto the earlier content steps that
 *  actually control that axis. */
const ADJUST_STEP: Record<AdjustChip, number> = {
  topic: 1,
  style: 3,
  pace: 4,
  length: 4,
  voice: 5,
};

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};

const TOTAL_STEPS = 7; // 6 content steps + the sample gate

const STEP_META: { title: string; subtitle: string }[] = [
  { title: "What's this agent about?", subtitle: "The premise, in one line." },
  { title: "Pick the face", subtitle: "Choose the influencer's look, or upload your own photo." },
  { title: "Pick your formats", subtitle: "Up to 3, this drives everything the agent produces." },
  { title: "Dial in each format", subtitle: "Length and style, per format." },
  { title: "Find your voice", subtitle: "Tone, language, energy." },
  { title: "Set the cadence", subtitle: "How often it posts, and what that costs." },
  { title: "Sample", subtitle: "One last look before it goes live." },
];

function storageKey(mintAddress: string): string {
  return `vello-onboarding-${mintAddress}`;
}

/** Clears the sample-gate's persisted launch counter (I4) — called from the
 *  approve path so a LATER "Redo setup" starts with a fresh quota instead of
 *  inheriting whatever this run already spent. */
function clearSampleCounters(mintAddress: string): void {
  try {
    window.localStorage.removeItem(sampleLaunchKey(mintAddress));
  } catch {
    // ignore
  }
}

function loadDraft(mintAddress: string, existingBible: ShowBible | null): OnboardingDraft {
  try {
    const raw = window.localStorage.getItem(storageKey(mintAddress));
    // Merge over emptyDraft so drafts saved before new fields (e.g. `engine`)
    // still load with every field defined.
    if (raw) return { ...emptyDraft(), ...(JSON.parse(raw) as Partial<OnboardingDraft>) };
  } catch {
    // corrupt/unavailable localStorage — fall through to bible/empty draft
  }
  return draftFromBible(existingBible);
}

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            n === step ? "w-6 bg-lime-400" : n < step ? "w-1.5 bg-lime-400/50" : "w-1.5 bg-white/15"
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingWizard({
  mintAddress,
  existingBible,
  initialStep,
  initialAspectRatio,
  onDone,
}: {
  mintAddress: string;
  existingBible: ShowBible | null;
  initialStep?: number;
  /** The agent's current videoConfig.aspectRatio (lives outside the bible —
   *  see OnboardingDraft.aspectRatio) — seeds Step 3's picker so it reflects
   *  whatever VideoDirectorTab's own Aspect ratio control last saved. */
  initialAspectRatio?: "9:16" | "16:9";
  onDone: () => void;
}) {
  const [step, setStep] = useState(() => Math.min(Math.max(initialStep ?? 1, 1), TOTAL_STEPS));
  const [draft, setDraft] = useState<OnboardingDraft>(() => {
    if (typeof window === "undefined") return emptyDraft();
    const loaded = loadDraft(mintAddress, existingBible);
    // Only apply the agent's live videoConfig when the wizard has no saved
    // pick of its own yet (a resumed draft's choice wins — don't clobber an
    // in-progress edit on every remount).
    return loaded.aspectRatio === "9:16" && initialAspectRatio && initialAspectRatio !== "9:16"
      ? { ...loaded, aspectRatio: initialAspectRatio }
      : loaded;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ensureSiwsSession } = useSiwsSession();

  // I6: a pencil-edit reopen (an already-committed bible, opened directly onto
  // one of its content steps rather than step 1) is a quick edit, not a fresh
  // first run — it must not trap the operator behind the sample gate, and it
  // needs an escape hatch that abandons the edit without committing anything.
  // Captured once at mount: `existingBible`/`initialStep` are the open-time
  // props, not meant to react to in-wizard changes (e.g. once `commit()`
  // below re-saves the bible, `existingBible` is still whatever it was when
  // this instance opened).
  const [isEditReopen] = useState(() => existingBible != null && (initialStep ?? 1) > 1);

  // Mirror the draft to localStorage on every change (best-effort).
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(mintAddress), JSON.stringify(draft));
    } catch {
      // ignore — draft just won't survive a refresh
    }
  }, [mintAddress, draft]);

  const meta = STEP_META[step - 1];
  const canAdvance = step >= TOTAL_STEPS ? true : draftStepComplete(draft, step);

  // I2 (accepted deviation, not fixed here): the bible commits BEFORE the
  // sample gate by design — the sample renders from the saved bible, so the
  // save has to land first. Approval on step 6 is advisory, not a gate on the
  // write itself. See plan ledger I2 ruling.
  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const bible = draftToBible(draft, existingBible);
      // Persist the engine choice with the bible — the explicit pick, else the
      // suggestion, so the agent renders with what Step 2 showed.
      const engine = effectiveEngine(draft);
      const res = await fetch("/api/agents/onboarding/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, bible, aspectRatio: draft.aspectRatio, ...(engine ? { videoEngine: engine.id } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || "Save failed");
      try {
        window.localStorage.removeItem(storageKey(mintAddress));
      } catch {
        // ignore
      }
      // I6: a pencil-edit reopen skips the sample gate entirely — the operator
      // came in to tweak one thing, not to re-approve a fresh render. Commit
      // and hand straight back to the recap.
      if (isEditReopen) {
        clearSampleCounters(mintAddress);
        onDone();
        return;
      }
      setStep(TOTAL_STEPS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  /** SampleGate's approve path — wraps onDone so a later "Redo setup" starts
   *  with a fresh sample-launch quota (I4) instead of inheriting whatever this
   *  run already spent. Also kicks off the FIRST batch of ideas against the
   *  just-approved bible, fire-and-forget: previously "Yes, go live" only
   *  closed the wizard, leaving the Ideas tab empty until the operator
   *  separately noticed and clicked "New ideas" (or waited on IdeasPanel's
   *  own auto-ideate-on-empty effect, which only fires once THAT tab is
   *  actually opened). Same endpoint/body IdeasPanel.tsx's manual button uses. */
  const handleApprove = () => {
    clearSampleCounters(mintAddress);
    void (async () => {
      try {
        await ensureSiwsSession();
        await fetch("/api/agents/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mintAddress }),
        });
      } catch (e) {
        console.warn("[onboarding] post-approval idea generation failed (non-blocking):", e instanceof Error ? e.message : e);
      }
    })();
    onDone();
  };

  const handleNext = () => {
    if (!canAdvance || busy) return;
    if (step === TOTAL_STEPS - 1) {
      void commit();
      return;
    }
    if (step >= TOTAL_STEPS) {
      // Same approve path as SampleGate's own buttons (I4) — the footer
      // "Continue" on step 6 is another way to finish, and must clear the
      // sample-launch quota too.
      handleApprove();
      return;
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  };

  const handleBack = () => {
    if (busy) return;
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  };

  const nextLabel = useMemo(() => {
    if (step === TOTAL_STEPS - 1) return busy ? "Saving…" : "Save my show plan";
    if (step >= TOTAL_STEPS) return "Continue";
    return "Next";
  }, [step, busy]);

  return (
    <div className="relative flex h-full min-h-[600px] flex-col overflow-hidden rounded-2xl border border-white/10" style={GLASS_BG}>
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <ProgressDots step={step} />
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            Step {step} / {TOTAL_STEPS}
          </span>
          {/* I6: a pencil-edit reopen (existing bible, opened past step 1) can
              be abandoned outright, closes without committing anything. */}
          {isEditReopen && (
            <button
              type="button"
              onClick={onDone}
              aria-label="Close without saving"
              className="rounded-lg p-1 text-zinc-500 transition-colors hover:text-white"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
          >
            <h2 className="text-[19px] font-semibold text-white">{meta.title}</h2>
            <p className="mt-1 text-[12.5px] text-zinc-500">{meta.subtitle}</p>

            <div className="mt-6">
              {step === 1 && <StepPremise draft={draft} onChange={setDraft} />}
              {step === 2 && <StepModel draft={draft} onChange={setDraft} mintAddress={mintAddress} />}
              {step === 3 && <StepFormats draft={draft} onChange={setDraft} />}
              {step === 4 && <StepTunables draft={draft} onChange={setDraft} />}
              {step === 5 && <StepVoice draft={draft} onChange={setDraft} />}
              {step === 6 && <StepCadence draft={draft} onChange={setDraft} />}
              {step === 7 && (
                <SampleGate
                  mintAddress={mintAddress}
                  formatId={draft.formats[0] ?? ""}
                  topicHint={draft.premise}
                  videoEngine={effectiveEngine(draft)?.id}
                  durationSeconds={draft.formats[0] ? draft.perFormatDuration[draft.formats[0]] : undefined}
                  onApprove={handleApprove}
                  onAdjust={(chip) => setStep(ADJUST_STEP[chip])}
                />
              )}
            </div>

            {error && <p className="mt-4 text-[12.5px] text-red-400">{error}</p>}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
        {/* I3: Back is hidden on the sample gate (step 6), going back and
            forward through it is exactly what fired a fresh paid sample
            render on every cycle; the sample gate's own "Try another format" /
            adjust chips are the only way back from here now. */}
        {step === TOTAL_STEPS ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 1 || busy}
            className="rounded-lg px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={!canAdvance || busy}
          className="flex items-center gap-2 rounded-lg bg-lime-500 px-5 py-2.5 text-[13px] font-bold text-black shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-lime-500"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
