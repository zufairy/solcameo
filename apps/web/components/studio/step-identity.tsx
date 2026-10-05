"use client";

import { useWizardStore } from "@/store/wizard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ARCHETYPES = [
  { id: "asian-female-lifestyle", label: "Asian Female, 22, Lifestyle" },
  { id: "black-male-tech", label: "Black Male, 28, Tech" },
  { id: "latina-female-fitness", label: "Latina Female, 25, Fitness" },
  { id: "malay-female-modest", label: "Malay Female, 24, Modest Fashion" },
  { id: "arab-male-finance", label: "Arab Male, 30, Finance" },
  { id: "white-male-gaming", label: "White Male, 21, Gaming" },
];

export function StepIdentity() {
  const { identity, updateIdentity, nextStep } = useWizardStore();

  const canProceed = identity.name.length >= 2 && (identity.archetype || identity.referencePhotoUrl);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Identity</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Define who your AI Influencer is. Choose a base archetype or upload reference photos.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="name">Display name</label>
          <Input
            id="name"
            placeholder="e.g. Aisha Rahman"
            value={identity.name}
            onChange={(e) => updateIdentity({ name: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="handle">Handle</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
              @
            </span>
            <Input
              id="handle"
              className="rounded-l-none"
              placeholder="aisha.rahman.ai"
              value={identity.handle}
              onChange={(e) =>
                updateIdentity({
                  handle: e.target.value.toLowerCase().replace(/\s/g, "."),
                })
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Base archetype</label>
          <p className="text-xs text-muted-foreground">
            AI will generate a face-consistent model from this base.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ARCHETYPES.map((a) => (
              <Card
                key={a.id}
                className={`cursor-pointer transition-colors ${
                  identity.archetype === a.id
                    ? "border-primary bg-primary/10"
                    : "hover:border-primary/40"
                }`}
                onClick={() => updateIdentity({ archetype: a.id })}
              >
                <CardContent className="p-3 flex items-center justify-between">
                  <span className="text-sm">{a.label}</span>
                  {identity.archetype === a.id && (
                    <Badge className="text-xs">Selected</Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={nextStep} disabled={!canProceed}>
          Next: Voice
        </Button>
      </div>
    </div>
  );
}
