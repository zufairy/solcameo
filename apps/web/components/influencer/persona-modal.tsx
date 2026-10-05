"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Flame, Sparkles, Shield, Zap, Globe, Star, Video, FileVideo } from "lucide-react";
import type { AIInfluencer } from "@/lib/types";

// ── Niche capabilities ──────────────────────────────────────────────────────

const NICHE_CAPABILITIES: Record<string, string[]> = {
  lifestyle: ["Day-in-life vlogs", "Lifestyle reviews", "Brand integrations", "Product unboxing", "Routine videos"],
  tech:      ["Product reviews", "Tutorial content", "Tech explainers", "App showcases", "Comparison videos"],
  finance:   ["Investment education", "Market analysis", "Product endorsements", "Explainer content", "Financial tips"],
  gaming:    ["Gameplay footage", "Game reviews", "Esports coverage", "Gaming product reviews", "Tutorial walkthroughs"],
  fashion:   ["OOTD content", "Brand hauls", "Style guides", "Fashion reviews", "Trend coverage"],
  fitness:   ["Workout content", "Supplement reviews", "Progress documentation", "Tutorial videos", "Health tips"],
  food:      ["Recipe content", "Restaurant reviews", "Product tastings", "Cooking tutorials", "Food hauls"],
  travel:    ["Destination vlogs", "Travel guides", "Hotel reviews", "Budget tips", "Itinerary content"],
};

function getArchetypeSkills(archetype?: string): string[] {
  if (!archetype) return ["Content creation", "Brand collaboration", "Audience engagement", "Campaign execution"];
  const lower = archetype.toLowerCase();
  if (lower.includes("educator") || lower.includes("expert"))
    return ["Educational content", "Tutorial creation", "Explainer videos", "Thought leadership"];
  if (lower.includes("entertainer") || lower.includes("comedian"))
    return ["Entertainment content", "Viral content creation", "Trending formats", "Storytelling"];
  if (lower.includes("reviewer") || lower.includes("critic"))
    return ["Product reviews", "Honest feedback", "Comparison content", "In-depth analysis"];
  if (lower.includes("lifestyle") || lower.includes("vlogger"))
    return ["Authentic storytelling", "Day-in-life content", "Aspirational content", "Personal branding"];
  return ["Content creation", "Brand collaboration", "Audience engagement", "Campaign execution"];
}

// ── Personality helpers ────────────────────────────────────────────────────

const TRAIT_META: Record<string, { icon: React.ReactNode; color: string; label: string; barColor: string }> = {
  warmth:    { icon: <Flame className="size-3.5" />,    color: "text-orange-400",  label: "Warmth",    barColor: "bg-orange-500" },
  humor:     { icon: <Sparkles className="size-3.5" />, color: "text-yellow-400",  label: "Humor",     barColor: "bg-yellow-500" },
  authority: { icon: <Shield className="size-3.5" />,   color: "text-blue-400",    label: "Authority", barColor: "bg-blue-500" },
  boldness:  { icon: <Zap className="size-3.5" />,      color: "text-purple-400",  label: "Boldness",  barColor: "bg-purple-500" },
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English", ms: "Malay", id: "Indonesian", ar: "Arabic",
  zh: "Chinese", hi: "Hindi", es: "Spanish", fr: "French",
};

function deriveCommunicationStyle(personality: AIInfluencer["personality"]): string {
  const entries = Object.entries(personality) as [string, number][];
  const dominant = entries.reduce((a, b) => (b[1] > a[1] ? b : a), entries[0]);
  switch (dominant[0]) {
    case "warmth":    return "Friendly & Approachable";
    case "humor":     return "Playful & Entertaining";
    case "authority": return "Expert & Authoritative";
    case "boldness":  return "Bold & Direct";
    default:          return "Balanced & Versatile";
  }
}

// ── Props ──────────────────────────────────────────────────────────────────

interface PersonaModalProps {
  influencer: AIInfluencer & { archetype?: string };
  open: boolean;
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function PersonaModal({ influencer, open, onClose }: PersonaModalProps) {
  const nicheCapabilities = NICHE_CAPABILITIES[influencer.niche] ?? [];
  const archetypeSkills = getArchetypeSkills(influencer.archetype);
  const allCapabilities = Array.from(new Set([...nicheCapabilities, ...archetypeSkills]));
  const commStyle = deriveCommunicationStyle(influencer.personality);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-950 border-zinc-800 text-zinc-100 p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800">
          <DialogTitle className="text-base font-semibold text-zinc-100">Agent Persona</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">

          {/* ── Identity block ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <Avatar className="size-16 border-2 border-zinc-700 shrink-0">
              <AvatarImage src={influencer.avatarUrl} alt={influencer.name} className="object-cover" />
              <AvatarFallback className="bg-zinc-800 text-zinc-200 text-xl font-bold">
                {influencer.name[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-zinc-100 truncate">{influencer.name}</h2>
              <p className="text-sm text-zinc-400 font-mono">{influencer.handle}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {influencer.archetype && (
                  <Badge className="bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs capitalize">
                    <Star className="size-2.5 mr-1" />
                    {influencer.archetype}
                  </Badge>
                )}
                <Badge className="bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs capitalize">
                  <Video className="size-2.5 mr-1" />
                  {influencer.niche}
                </Badge>
                <Badge className="bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs">
                  <Globe className="size-2.5 mr-1" />
                  {LANGUAGE_LABELS[influencer.language] ?? influencer.language}
                </Badge>
              </div>
            </div>
          </div>

          {/* ── Description ─────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">About</h3>
            <p className="text-sm text-zinc-300 leading-relaxed">{influencer.description}</p>
          </div>

          {/* ── Personality Matrix ───────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Personality Matrix</h3>
              <span className="text-xs text-zinc-400 bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded-md">
                {commStyle}
              </span>
            </div>
            <div className="space-y-3">
              {(Object.entries(influencer.personality) as [string, number][]).map(([trait, value]) => {
                const meta = TRAIT_META[trait];
                return (
                  <div key={trait} className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className={`flex items-center gap-1.5 text-xs ${meta?.color ?? "text-zinc-400"}`}>
                        {meta?.icon}
                        {meta?.label ?? trait}
                      </span>
                      <span className="text-xs font-mono font-semibold text-zinc-300">
                        {value}<span className="text-zinc-600">/100</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${meta?.barColor ?? "bg-purple-500"}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Content Capabilities ────────────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Content Capabilities</h3>
            <div className="flex flex-wrap gap-2">
              {allCapabilities.map((cap) => (
                <span
                  key={cap}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-medium"
                >
                  <FileVideo className="size-3 text-zinc-500" />
                  {cap}
                </span>
              ))}
            </div>
          </div>

          {/* ── On-Chain Info ────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">On-Chain Info</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Mint Address",      value: influencer.id.length > 16 ? `${influencer.id.slice(0, 8)}…${influencer.id.slice(-4)}` : influencer.id },
                { label: "Share Price",        value: `$${influencer.sharePrice.toFixed(4)}` },
                { label: "Total Shares",       value: influencer.totalShares.toLocaleString() },
                { label: "Available Shares",   value: influencer.availableShares.toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium mb-0.5">{label}</p>
                  <p className="text-sm font-mono font-semibold text-zinc-200 truncate">{value}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
