"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { isOwnerWallet } from "@/lib/solana/activeWallet";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Loader2, Save, ArrowLeft, Bot } from "lucide-react";
import Link from "next/link";

const NICHES = ["lifestyle", "tech", "fashion", "fitness", "food", "travel", "finance", "gaming"];
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ms", label: "Malay" },
  { value: "ar", label: "Arabic" },
  { value: "zh", label: "Chinese" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "id", label: "Indonesian" },
];
const ARCHETYPES = ["creator", "educator", "entertainer", "analyst", "advocate", "curator"];
const TRAIT_COLORS: Record<string, string> = {
  warmth: "bg-orange-500",
  humor: "bg-yellow-500",
  authority: "bg-blue-500",
  boldness: "bg-purple-500",
};

export default function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  // Privy-aware: resolves the active address whether the user logged in with an
  // external wallet OR a Google/email login that minted an embedded Privy
  // wallet. Plain useWallet() returns publicKey=null for the embedded case, so
  // isOwner below was always false and embedded-wallet owners could never save
  // edits to their own agent.
  const { publicKey } = useUnifiedSolanaWallet();

  const agent = useQuery(api.influencers.getById, { id: id as Id<"influencers"> });

  const [form, setForm] = useState({
    name: "",
    handle: "",
    avatarUrl: "",
    niche: "lifestyle",
    language: "en",
    archetype: "creator",
    description: "",
    personality: { warmth: 70, humor: 60, authority: 50, boldness: 65 },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Populate form once agent loads
  useEffect(() => {
    if (!agent) return;
    setForm({
      name: agent.name,
      handle: agent.handle,
      avatarUrl: agent.avatarUrl,
      niche: agent.niche,
      language: agent.language,
      archetype: agent.archetype,
      description: agent.description,
      personality: agent.personality,
    });
  }, [agent]);

  // Guard: only creator can edit
  const isOwner =
    isOwnerWallet(publicKey?.toBase58(), agent?.creatorWallet) ||
    ((agent as { coCreatorWallets?: string[] } | null | undefined)?.coCreatorWallets ?? []).some((w) =>
      isOwnerWallet(publicKey?.toBase58(), w),
    );

  async function handleSave() {
    if (!agent || !isOwner) return;
    setSaving(true);
    try {
      // influencers.update is now INTERNAL_CRON_SECRET-gated (the row _id is public, so
      // an ungated update let anyone deface any agent). Route through the SIWS-owner-gated
      // /api/agents/config, which proves ownership and injects the secret. Auth headers
      // (Privy Bearer + X-Siws-Session) are auto-attached by the global fetch interceptor.
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: agent.mintAddress, kind: "persona", payload: form }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  if (agent === undefined) {
    return (
      <PageShell title="Edit AI Agent" description="Update your agent's configuration">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (!agent) {
    return (
      <PageShell title="Edit AI Agent" description="">
        <p className="text-muted-foreground text-sm">Agent not found.</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Edit AI Agent" description={`Editing ${agent.name}`}>
      <div className="max-w-2xl space-y-6">

        {/* Back + header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" render={<Link href="/wallet" />}>
            <ArrowLeft className="size-4 mr-1" /> Back
          </Button>
        </div>

        {/* Avatar preview */}
        <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card">
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            className="size-16 rounded-full object-cover ring-2 ring-purple-500/40"
          />
          <div>
            <p className="font-semibold">{agent.name}</p>
            <p className="text-xs text-muted-foreground">{agent.handle}</p>
            <Badge variant="secondary" className="mt-1 capitalize text-xs">{agent.niche}</Badge>
          </div>
          <Bot className="ml-auto size-8 text-purple-400/40" />
        </div>

        {/* Identity */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Identity
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Agent Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Zara Nova"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="handle">Handle</Label>
              <Input
                id="handle"
                value={form.handle}
                onChange={(e) => set("handle", e.target.value)}
                placeholder="@zara_nova"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="avatarUrl">Avatar URL</Label>
            <Input
              id="avatarUrl"
              value={form.avatarUrl}
              onChange={(e) => set("avatarUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Bio / Description</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="Describe your AI agent's persona..."
            />
          </div>
        </section>

        {/* Category */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Category
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {NICHES.map((n) => (
              <button
                key={n}
                onClick={() => set("niche", n)}
                className={`rounded-lg border px-3 py-2 text-sm capitalize transition-all ${
                  form.niche === n
                    ? "border-purple-500 bg-purple-500/10 text-purple-300 font-medium"
                    : "border-border text-muted-foreground hover:border-purple-500/40"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        {/* Settings */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Settings
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={form.language} onValueChange={(v: string | null) => v && set("language", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Archetype</Label>
              <Select value={form.archetype} onValueChange={(v: string | null) => v && set("archetype", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARCHETYPES.map((a) => (
                    <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Personality */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Personality Traits
          </h3>
          <div className="space-y-5">
            {(["warmth", "humor", "authority", "boldness"] as const).map((trait) => (
              <div key={trait} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="capitalize font-medium">{trait}</span>
                  <span className="font-mono text-muted-foreground">
                    {form.personality[trait]}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`size-2 rounded-full ${TRAIT_COLORS[trait]}`} />
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={form.personality[trait]}
                    onValueChange={(v: number | readonly number[]) =>
                      set("personality", { ...form.personality, [trait]: Array.isArray(v) ? (v as number[])[0] : v as number })
                    }
                    className="flex-1"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Save */}
        <div className="flex gap-3 pt-2 border-t border-border">
          <Button
            onClick={handleSave}
            disabled={saving || !isOwner}
            className="gap-2 bg-purple-600 hover:bg-purple-700"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : saved ? (
              "✓ Saved!"
            ) : (
              <>
                <Save className="size-4" /> Save Changes
              </>
            )}
          </Button>
          <Button variant="outline" render={<Link href="/wallet" />}>
            Cancel
          </Button>
          {!isOwner && (
            <p className="text-xs text-muted-foreground self-center ml-2">
              Only the creator can edit this agent.
            </p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
