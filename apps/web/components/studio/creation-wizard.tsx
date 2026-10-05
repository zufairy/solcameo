"use client";

import type React from "react";
import { useWizardStore, WIZARD_STEPS, type WizardStep } from "@/store/wizard";
import { Card, CardContent } from "@/components/ui/card";
import { StepIdentity } from "./step-identity";
import { StepVoice } from "./step-voice";
import { StepPersonality } from "./step-personality";
import { StepBrand } from "./step-brand";
import { StepBehavior } from "./step-behavior";
import { StepLaunch } from "./step-launch";
import { cn } from "@/lib/utils";

const STEP_LABELS: Record<WizardStep, string> = {
  identity: "Identity",
  voice: "Voice",
  personality: "Personality",
  brand: "Brand",
  behavior: "Behavior",
  launch: "Launch",
};

const STEP_COMPONENTS: Record<WizardStep, React.ComponentType> = {
  identity: StepIdentity,
  voice: StepVoice,
  personality: StepPersonality,
  brand: StepBrand,
  behavior: StepBehavior,
  launch: StepLaunch,
};

export function CreationWizard() {
  const { currentStep, goToStep } = useWizardStore();
  const currentIndex = WIZARD_STEPS.indexOf(currentStep);
  const StepComponent = STEP_COMPONENTS[currentStep];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Step progress */}
      <div className="flex items-center">
        {WIZARD_STEPS.map((step, idx) => (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => idx <= currentIndex && goToStep(step)}
              className={cn(
                "flex flex-col items-center gap-1",
                idx <= currentIndex ? "cursor-pointer" : "cursor-not-allowed"
              )}
            >
              <div
                className={cn(
                  "size-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                  idx < currentIndex
                    ? "bg-primary border-primary text-primary-foreground"
                    : idx === currentIndex
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                )}
              >
                {idx + 1}
              </div>
              <span
                className={cn(
                  "text-xs",
                  idx === currentIndex
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </button>
            {idx < WIZARD_STEPS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2 mb-4",
                  idx < currentIndex ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          <StepComponent />
        </CardContent>
      </Card>
    </div>
  );
}
