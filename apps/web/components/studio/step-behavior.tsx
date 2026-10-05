"use client";

import { useWizardStore } from "@/store/wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";

export function StepBehavior() {
  const { behavior, updateBehavior, nextStep, prevStep } = useWizardStore();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Behavior Programming</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set rules for how your AI Influencer auto-manages campaigns.
        </p>
      </div>

      <Card className="border-blue-600/30 bg-blue-600/10">
        <CardContent className="p-3 flex gap-2 text-sm text-blue-300">
          <Info className="size-4 mt-0.5 shrink-0" />
          Campaigns matching your brand profile are auto-evaluated. Rules below
          determine what gets auto-accepted vs. queued for your review.
        </CardContent>
      </Card>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="autoAccept">
          Auto-accept campaigns with budget above (USDC)
        </label>
        <Input
          id="autoAccept"
          type="number"
          min={100}
          value={behavior.autoAcceptBelow}
          onChange={(e) =>
            updateBehavior({ autoAcceptBelow: Number(e.target.value) })
          }
        />
        <p className="text-xs text-muted-foreground">
          Campaigns below this budget require your manual approval.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <label className="font-medium">Operational pool (% of earnings)</label>
          <span className="text-muted-foreground">
            {behavior.operationalPoolPercent}%
          </span>
        </div>
        <input
          type="range"
          min={10}
          max={30}
          step={1}
          value={behavior.operationalPoolPercent}
          onChange={(e) => updateBehavior({ operationalPoolPercent: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <p className="text-xs text-muted-foreground">
          This portion of earnings funds future content generation. Minimum 10% recommended.
        </p>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>Back</Button>
        <Button onClick={nextStep}>Next: Launch</Button>
      </div>
    </div>
  );
}
