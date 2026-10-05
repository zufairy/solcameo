"use client";

import { useWizardStore } from "@/store/wizard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TRAITS = [
  { key: "warmth" as const, label: "Warmth", left: "Cold", right: "Warm" },
  { key: "humor" as const, label: "Humor", left: "Serious", right: "Funny" },
  { key: "authority" as const, label: "Authority", left: "Casual", right: "Expert" },
  { key: "boldness" as const, label: "Boldness", left: "Safe", right: "Bold" },
];

export function StepPersonality() {
  const { personality, updatePersonality, nextStep, prevStep } = useWizardStore();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Personality</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Define how your AI Influencer communicates and what content they focus on.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Content niche</label>
        <Select
          value={personality.niche}
          onValueChange={(v) => updatePersonality({ niche: v as string })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lifestyle">Lifestyle</SelectItem>
            <SelectItem value="tech">Tech</SelectItem>
            <SelectItem value="fashion">Fashion</SelectItem>
            <SelectItem value="fitness">Fitness</SelectItem>
            <SelectItem value="food">Food</SelectItem>
            <SelectItem value="travel">Travel</SelectItem>
            <SelectItem value="finance">Finance</SelectItem>
            <SelectItem value="gaming">Gaming</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-5">
        {TRAITS.map(({ key, label, left, right }) => (
          <div key={key} className="space-y-2">
            <div className="flex justify-between text-sm">
              <label className="font-medium">{label}</label>
              <span className="text-muted-foreground">{personality[key]}/100</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={personality[key]}
              onChange={(e) => updatePersonality({ [key]: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{left}</span>
              <span>{right}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>Back</Button>
        <Button onClick={nextStep}>Next: Brand Profile</Button>
      </div>
    </div>
  );
}
