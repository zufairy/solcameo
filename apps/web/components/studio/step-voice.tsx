"use client";

import { useWizardStore } from "@/store/wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const VOICES = [
  { id: "v-warm-female-en", label: "Warm Female (EN)", language: "en" },
  { id: "v-assertive-male-en", label: "Assertive Male (EN)", language: "en" },
  { id: "v-friendly-female-ms", label: "Friendly Female (MS)", language: "ms" },
  { id: "v-calm-male-ms", label: "Calm Male (MS)", language: "ms" },
  { id: "v-energetic-female-id", label: "Energetic Female (ID)", language: "id" },
  { id: "v-deep-male-ar", label: "Deep Male (AR)", language: "ar" },
];

export function StepVoice() {
  const { voice, updateVoice, nextStep, prevStep } = useWizardStore();

  const filteredVoices = VOICES.filter(
    (v) => !voice.language || v.language === voice.language
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Voice</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select a voice and language for your AI Influencer&apos;s content.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Primary language</label>
          <Select
            value={voice.language}
            onValueChange={(v) => updateVoice({ language: v as string })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ms">Malay</SelectItem>
              <SelectItem value="id">Indonesian</SelectItem>
              <SelectItem value="ar">Arabic</SelectItem>
              <SelectItem value="zh">Mandarin</SelectItem>
              <SelectItem value="hi">Hindi</SelectItem>
              <SelectItem value="es">Spanish</SelectItem>
              <SelectItem value="fr">French</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Voice library</label>
          {filteredVoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No voices available for this language yet.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredVoices.map((v) => (
                <Card
                  key={v.id}
                  className={`cursor-pointer transition-colors ${
                    voice.voiceId === v.id
                      ? "border-primary bg-primary/10"
                      : "hover:border-primary/40"
                  }`}
                  onClick={() => updateVoice({ voiceId: v.id })}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <span className="text-sm">{v.label}</span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                      }}
                    >
                      <Play className="size-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={nextStep} disabled={!voice.voiceId}>
          Next: Personality
        </Button>
      </div>
    </div>
  );
}
