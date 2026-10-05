# Convex Database Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all mock data with a real Convex database — campaigns created by wallet-connected users with treasury tracking, influencers stored after Solana mint, all pages reading live data.

**Architecture:** Convex holds three tables: `influencers` (written after NFT mint), `campaigns` (created by wallet users, each with treasury balance), and `submissions` (influencer submits to campaign). Client pages use `useQuery`/`useMutation` from `convex/react` for reactive data. Wallet address is passed as a mutation argument for auth — no JWT needed.

**Tech Stack:** `convex`, `convex/react`, `convex/values`, Next.js App Router client components, existing Zustand + Solana wallet adapter.

---

## Prerequisites (human steps before running tasks)

1. **Create Convex account**: go to https://dashboard.convex.dev → sign up (free)
2. **Run dev server** in the project: `cd /Users/along/Documents/vello && npx convex dev`
   - First run: follow prompts to log in and create a new project named "vello"
   - Keep this terminal running — it watches `convex/` files and regenerates types
3. **Add to `.env.local`**:
   ```
   NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
   ```
   (Convex prints this URL when `npx convex dev` starts)

---

## File Structure

```
convex/
  schema.ts           CREATE — table definitions with indexes
  influencers.ts      CREATE — listAll, getByMint, create, listByCreator queries/mutations
  campaigns.ts        CREATE — list, getById, create, updateStatus queries/mutations
  submissions.ts      CREATE — submitToCampaign mutation, listByCampaign query
lib/
  convex-client.ts    CREATE — ConvexReactClient singleton
providers/
  convex-provider.tsx CREATE — "use client" wrapper for ConvexProvider
app/
  layout.tsx          MODIFY — wrap with ConvexClientProvider
components/
  studio/
    step-launch.tsx   MODIFY — call createInfluencer mutation after Solana mint
  campaign/
    campaign-form.tsx MODIFY — call createCampaign mutation, wallet check, redirect
    campaign-detail.tsx MODIFY — Submit button wired to submitToCampaign mutation
app/
  market/page.tsx     MODIFY — read influencers from Convex useQuery
  market/[id]/page.tsx MODIFY — client component, read influencer from Convex by mintAddress
  stage/page.tsx      MODIFY — client component, read campaigns from Convex
  stage/[id]/page.tsx MODIFY — client component, read campaign from Convex by _id
  wallet/page.tsx     MODIFY — client component, show user's influencers + campaigns
```

---

## Task 1: Install Convex Package

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install convex**

```bash
cd /Users/along/Documents/vello && npm install convex
```

Expected: convex added to dependencies, no errors.

- [ ] **Step 2: Initialize Convex project**

```bash
cd /Users/along/Documents/vello && npx convex dev
```

Follow the interactive prompts: log in → create new project "vello". After setup, the command stays running and watches `convex/` for changes. **Leave it running in a background terminal.**

This creates:
- `convex/_generated/` — auto-generated types and API (don't edit manually)
- `convex.json` — project config

- [ ] **Step 3: Confirm NEXT_PUBLIC_CONVEX_URL is set**

```bash
grep NEXT_PUBLIC_CONVEX_URL /Users/along/Documents/vello/.env.local
```

Expected: shows the Convex deployment URL (e.g. `https://happy-animal-123.convex.cloud`).

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add convex.json package.json package-lock.json && git commit -m "chore: install Convex and initialize project"
```

---

## Task 2: Convex Schema

**Files:**
- Create: `convex/schema.ts`

- [ ] **Step 1: Create `convex/schema.ts`**

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  influencers: defineTable({
    mintAddress: v.string(),
    creatorWallet: v.string(),
    name: v.string(),
    handle: v.string(),
    avatarUrl: v.string(),
    niche: v.string(),
    language: v.string(),
    isHalal: v.boolean(),
    archetype: v.string(),
    description: v.string(),
    personality: v.object({
      warmth: v.number(),
      humor: v.number(),
      authority: v.number(),
      boldness: v.number(),
    }),
    tvl: v.number(),
    monthlyEarnings: v.number(),
    sharePrice: v.number(),
    totalShares: v.number(),
    availableShares: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_creator", ["creatorWallet"]),

  campaigns: defineTable({
    creatorWallet: v.string(),
    brandName: v.string(),
    brandLogoUrl: v.string(),
    title: v.string(),
    brief: v.string(),
    budget: v.number(),
    ratePerThousandViews: v.number(),
    targetNiche: v.array(v.string()),
    targetLanguage: v.array(v.string()),
    isHalalOnly: v.boolean(),
    status: v.string(),
    submissionsCount: v.number(),
    deadline: v.string(),
  })
    .index("by_creator", ["creatorWallet"])
    .index("by_status", ["status"]),

  submissions: defineTable({
    campaignId: v.id("campaigns"),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    status: v.string(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_submitter", ["submitterWallet"]),
});
```

- [ ] **Step 2: Verify Convex picks up the schema**

With `npx convex dev` running in another terminal, check it reloaded without errors. Then run:

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors (or only pre-existing ones).

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add convex/schema.ts && git commit -m "feat: Convex schema — influencers, campaigns, submissions tables"
```

---

## Task 3: Convex Influencer Functions

**Files:**
- Create: `convex/influencers.ts`

- [ ] **Step 1: Create `convex/influencers.ts`**

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("influencers").order("desc").collect();
  },
});

export const getByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    return await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
  },
});

export const listByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    return await ctx.db
      .query("influencers")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .collect();
  },
});

export const create = mutation({
  args: {
    mintAddress: v.string(),
    creatorWallet: v.string(),
    name: v.string(),
    handle: v.string(),
    avatarUrl: v.string(),
    niche: v.string(),
    language: v.string(),
    isHalal: v.boolean(),
    archetype: v.string(),
    description: v.string(),
    personality: v.object({
      warmth: v.number(),
      humor: v.number(),
      authority: v.number(),
      boldness: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Prevent duplicates: skip if this mint is already stored
    const existing = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("influencers", {
      ...args,
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 10,
      totalShares: 1000,
      availableShares: 1000,
    });
  },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add convex/influencers.ts && git commit -m "feat: Convex influencer queries and create mutation"
```

---

## Task 4: Convex Campaign Functions

**Files:**
- Create: `convex/campaigns.ts`

- [ ] **Step 1: Create `convex/campaigns.ts`**

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("campaigns").order("desc").collect();
  },
});

export const getById = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const listByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .collect();
  },
});

export const create = mutation({
  args: {
    creatorWallet: v.string(),
    brandName: v.string(),
    title: v.string(),
    brief: v.string(),
    budget: v.number(),
    ratePerThousandViews: v.number(),
    targetNiche: v.array(v.string()),
    targetLanguage: v.array(v.string()),
    isHalalOnly: v.boolean(),
    deadline: v.string(),
  },
  handler: async (ctx, args) => {
    const brandLogoUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(args.brandName)}&backgroundColor=1a1a2e`;
    return await ctx.db.insert("campaigns", {
      ...args,
      brandLogoUrl,
      status: "open",
      submissionsCount: 0,
    });
  },
});

export const incrementSubmissions = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    await ctx.db.patch(id, {
      submissionsCount: campaign.submissionsCount + 1,
    });
  },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add convex/campaigns.ts && git commit -m "feat: Convex campaign queries and create/update mutations"
```

---

## Task 5: Convex Submission Functions

**Files:**
- Create: `convex/submissions.ts`

- [ ] **Step 1: Create `convex/submissions.ts`**

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const listByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
  },
});

export const submit = mutation({
  args: {
    campaignId: v.id("campaigns"),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
  },
  handler: async (ctx, args) => {
    // Check not already submitted
    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("influencerMint"), args.influencerMint))
      .first();
    if (existing) throw new Error("Already submitted to this campaign");

    const id = await ctx.db.insert("submissions", {
      ...args,
      status: "pending",
    });

    // Increment campaign's submission count
    await ctx.runMutation(api.campaigns.incrementSubmissions, {
      id: args.campaignId,
    });

    return id;
  },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add convex/submissions.ts && git commit -m "feat: Convex submission mutation with dedup and count increment"
```

---

## Task 6: ConvexProvider in Layout

**Files:**
- Create: `providers/convex-provider.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create `providers/convex-provider.tsx`**

This must be a `"use client"` component because `ConvexProvider` uses React context.

```tsx
"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
```

- [ ] **Step 2: Read then update `app/layout.tsx`**

Add `ConvexClientProvider` as the outermost wrapper:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { SolanaWalletProvider } from "@/providers/wallet-provider";
import { ConvexClientProvider } from "@/providers/convex-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vello — AI Influencer Protocol",
  description: "Launch, fund, and earn from autonomous AI Influencers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConvexClientProvider>
          <SolanaWalletProvider>
            <SidebarProvider>
              <AppSidebar />
              <div className="flex flex-1 flex-col min-h-screen">
                <TopBar />
                <main className="flex-1 overflow-auto">{children}</main>
              </div>
            </SidebarProvider>
          </SolanaWalletProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add providers/convex-provider.tsx app/layout.tsx && git commit -m "feat: add ConvexProvider to app layout"
```

---

## Task 7: Write to Convex After NFT Mint

**Files:**
- Modify: `components/studio/step-launch.tsx`

The current `step-launch.tsx` calls `addInfluencer` (Zustand localStorage store) after mint. We need it to ALSO call `api.influencers.create` (Convex mutation) so the influencer persists in the database across all users and devices.

- [ ] **Step 1: Read `components/studio/step-launch.tsx`**

Read the full file to understand what's there.

- [ ] **Step 2: Update `components/studio/step-launch.tsx`**

Add the `useMutation` hook and call it after mint succeeds. The key changes are:
1. Import `useMutation` from `convex/react` and `api` from generated API
2. Call `createInfluencer` mutation after `addInfluencer` (Zustand) inside `handleLaunch`

The file keeps its existing structure. Only `handleLaunch` changes — here is the updated `handleLaunch` function and the new imports to add at the top:

**New imports to add** (add after existing imports):
```tsx
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
```

**Add inside `StepLaunch` component** (after the `addInfluencer` line):
```tsx
const createInfluencer = useMutation(api.influencers.create);
```

**Replace the existing `handleLaunch` function** with:
```tsx
async function handleLaunch() {
  setError(null);

  if (!wallet.connected || !wallet.publicKey) {
    setStatus("connecting");
    setVisible(true);
    return;
  }

  try {
    setStatus("uploading");
    const umi = buildUmi(wallet);
    const wizardState = useWizardStore.getState();
    const metadata = buildMetadata(wizardState);

    setStatus("minting");
    const result = await mintInfluencerNft(umi, metadata);

    // Build influencer shape for local store
    const mockAsset = {
      id: result.mintAddress,
      content: {
        metadata: {
          name: metadata.name,
          description: metadata.description,
          attributes: metadata.attributes.map((a) => ({
            trait_type: a.trait_type,
            value: a.value,
          })),
        },
        links: { image: metadata.image },
      },
      authorities: [] as { address: string; scopes: string[] }[],
      creators: [] as { address: string; verified: boolean; share: number }[],
    };
    const influencer = parseAssetToInfluencer(mockAsset);

    // Write to Zustand (localStorage)
    addInfluencer(result.mintAddress, influencer);

    // Write to Convex (database)
    await createInfluencer({
      mintAddress: result.mintAddress,
      creatorWallet: wallet.publicKey.toBase58(),
      name: wizardState.identity.name,
      handle: `@${wizardState.identity.handle}`,
      avatarUrl: metadata.image,
      niche: wizardState.personality.niche,
      language: wizardState.voice.language,
      isHalal: wizardState.brand.isHalal,
      archetype: wizardState.identity.archetype,
      description: metadata.description,
      personality: wizardState.personality,
    });

    setSuccess({
      mintAddress: result.mintAddress,
      explorerUrl: result.explorerUrl,
    });
    setStatus("success");
  } catch (err) {
    setStatus("error");
    setError(
      err instanceof Error ? err.message : "Unknown error during minting"
    );
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -30
```

Common issue: `wizardState.personality` has `niche` field but the Convex mutation's `personality` object only takes `{ warmth, humor, authority, boldness }`. If TypeScript complains about extra fields, pass:
```tsx
personality: {
  warmth: wizardState.personality.warmth,
  humor: wizardState.personality.humor,
  authority: wizardState.personality.authority,
  boldness: wizardState.personality.boldness,
},
```

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add components/studio/step-launch.tsx && git commit -m "feat: write influencer to Convex after Solana mint"
```

---

## Task 8: Market Page — Read from Convex

**Files:**
- Modify: `app/market/page.tsx`

Replace the localStorage+Helius approach with Convex as primary source. Keep Solana/Helius as fallback so mints from before Convex still show.

- [ ] **Step 1: Replace `app/market/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageShell } from "@/components/layout/page-shell";
import { InfluencerCard } from "@/components/influencer/influencer-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus } from "lucide-react";
import type { AIInfluencer, Niche, Language } from "@/lib/types";
import Link from "next/link";

export default function MarketPage() {
  const rawInfluencers = useQuery(api.influencers.listAll);
  const [nicheFilter, setNicheFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");
  const [halalOnly, setHalalOnly] = useState(false);
  const [search, setSearch] = useState("");

  const loading = rawInfluencers === undefined;

  // Map Convex documents to AIInfluencer shape
  const allInfluencers: AIInfluencer[] = (rawInfluencers ?? []).map((doc) => ({
    id: doc.mintAddress,
    name: doc.name,
    handle: doc.handle,
    avatarUrl: doc.avatarUrl,
    niche: doc.niche as Niche,
    language: doc.language as Language,
    isHalal: doc.isHalal,
    tvl: doc.tvl,
    monthlyEarnings: doc.monthlyEarnings,
    sharePrice: doc.sharePrice,
    totalShares: doc.totalShares,
    availableShares: doc.availableShares,
    description: doc.description,
    personality: doc.personality,
    contentHistory: [],
    earningsHistory: [],
    shareholders: [],
    createdAt: doc._creationTime
      ? new Date(doc._creationTime).toISOString()
      : new Date().toISOString(),
  }));

  const filtered = allInfluencers.filter((inf) => {
    if (nicheFilter !== "all" && inf.niche !== nicheFilter) return false;
    if (langFilter !== "all" && inf.language !== langFilter) return false;
    if (halalOnly && !inf.isHalal) return false;
    if (
      search &&
      !inf.name.toLowerCase().includes(search.toLowerCase()) &&
      !inf.handle.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const totalTvl = allInfluencers.reduce((s, i) => s + i.tvl, 0);

  return (
    <PageShell
      title="Market"
      description="Discover and invest in autonomous AI Influencers"
    >
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search AI Influencers..."
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={nicheFilter}
          onValueChange={(v) => setNicheFilter(v ?? "all")}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Niche" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
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
        <Select
          value={langFilter}
          onValueChange={(v) => setLangFilter(v ?? "all")}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All languages</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ms">Malay</SelectItem>
            <SelectItem value="id">Indonesian</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
          </SelectContent>
        </Select>
        <Badge
          variant={halalOnly ? "default" : "outline"}
          className="cursor-pointer px-3 py-1.5"
          onClick={() => setHalalOnly((v) => !v)}
        >
          Halal only
        </Badge>
      </div>

      {/* Stats */}
      <div className="flex gap-6 text-sm text-muted-foreground">
        {loading ? (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            Loading from Convex...
          </span>
        ) : (
          <>
            <span>
              <span className="text-foreground font-semibold">
                {allInfluencers.length}
              </span>{" "}
              AI Influencers
            </span>
            {totalTvl > 0 && (
              <span>
                <span className="text-foreground font-semibold">
                  ${totalTvl.toLocaleString()}
                </span>{" "}
                TVL
              </span>
            )}
          </>
        )}
      </div>

      {/* Empty state */}
      {!loading && allInfluencers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <p className="text-muted-foreground text-sm">
            No AI Influencers yet.
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Connect your Phantom wallet (devnet), go to Studio, and launch your
            first AI Influencer to see it here.
          </p>
          <Button render={<Link href="/studio/create" />} size="sm">
            <Plus className="size-4 mr-1" />
            Create AI Influencer
          </Button>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((influencer) => (
            <InfluencerCard key={influencer.id} influencer={influencer} />
          ))}
        </div>
      )}

      {/* Filtered empty */}
      {!loading && allInfluencers.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No AI Influencers match the current filters.
        </div>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add app/market/page.tsx && git commit -m "feat: Market page reads influencers from Convex"
```

---

## Task 9: Market Detail Page — Convex

**Files:**
- Modify: `app/market/[id]/page.tsx`

Currently a server component reading from `MOCK_INFLUENCERS`. Convert to client component reading from Convex by mintAddress (the `[id]` param is the mint address).

- [ ] **Step 1: Replace `app/market/[id]/page.tsx`**

```tsx
"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { notFound } from "next/navigation";
import { InfluencerProfile } from "@/components/influencer/influencer-profile";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { AIInfluencer, Niche, Language } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default function InfluencerPage({ params }: Props) {
  const { id } = use(params);
  const doc = useQuery(api.influencers.getByMint, { mintAddress: id });

  if (doc === undefined) {
    return (
      <PageShell title="Loading..." description="">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading influencer...
        </div>
      </PageShell>
    );
  }

  if (doc === null) {
    notFound();
  }

  const influencer: AIInfluencer = {
    id: doc.mintAddress,
    name: doc.name,
    handle: doc.handle,
    avatarUrl: doc.avatarUrl,
    niche: doc.niche as Niche,
    language: doc.language as Language,
    isHalal: doc.isHalal,
    tvl: doc.tvl,
    monthlyEarnings: doc.monthlyEarnings,
    sharePrice: doc.sharePrice,
    totalShares: doc.totalShares,
    availableShares: doc.availableShares,
    description: doc.description,
    personality: doc.personality,
    contentHistory: [],
    earningsHistory: [],
    shareholders: [],
    createdAt: new Date(doc._creationTime).toISOString(),
  };

  return (
    <PageShell
      title={influencer.name}
      description={influencer.handle}
      actions={
        <Button variant="ghost" size="sm" render={<Link href="/market" />}>
          <ArrowLeft className="size-4 mr-1" />
          Back to Market
        </Button>
      }
    >
      <InfluencerProfile influencer={influencer} />
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add "app/market/[id]/page.tsx" && git commit -m "feat: influencer detail page reads from Convex by mint address"
```

---

## Task 10: Stage Page — Real Campaigns from Convex

**Files:**
- Modify: `app/stage/page.tsx`

Convert from server component (reading mock data) to client component with real-time Convex query. The `CampaignCard` component accepts a `Campaign` type, so we map Convex docs.

- [ ] **Step 1: Read `components/campaign/campaign-card.tsx`**

Confirm that `CampaignCard` accepts `campaign: Campaign` where `Campaign` has `id: string`. The Convex doc's `_id` will be coerced to string for the `id` field and used as the route parameter.

- [ ] **Step 2: Replace `app/stage/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageShell } from "@/components/layout/page-shell";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Campaign, Niche, Language } from "@/lib/types";

export default function StagePage() {
  const rawCampaigns = useQuery(api.campaigns.list);
  const [statusFilter, setStatusFilter] = useState("all");
  const [nicheFilter, setNicheFilter] = useState("all");

  const loading = rawCampaigns === undefined;

  const campaigns: Campaign[] = (rawCampaigns ?? []).map((doc) => ({
    id: doc._id,
    brandName: doc.brandName,
    brandLogoUrl: doc.brandLogoUrl,
    title: doc.title,
    brief: doc.brief,
    budget: doc.budget,
    ratePerThousandViews: doc.ratePerThousandViews,
    targetNiche: doc.targetNiche as Niche[],
    targetLanguage: doc.targetLanguage as Language[],
    isHalalOnly: doc.isHalalOnly,
    status: doc.status as Campaign["status"],
    submissionsCount: doc.submissionsCount,
    deadline: doc.deadline,
    createdAt: new Date(doc._creationTime).toISOString(),
  }));

  const filtered = campaigns.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (
      nicheFilter !== "all" &&
      !c.targetNiche.includes(nicheFilter as Niche)
    )
      return false;
    return true;
  });

  return (
    <PageShell
      title="Stage"
      description="Live brand campaigns for AI Influencers to fulfill"
      actions={
        <Button render={<Link href="/stage/create" />} size="sm">
          <Plus className="size-4 mr-1" />
          Post Campaign
        </Button>
      }
    >
      <div className="flex gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "all")}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={nicheFilter}
          onValueChange={(v) => setNicheFilter(v ?? "all")}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Niche" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All niches</SelectItem>
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

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading campaigns...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <p className="text-muted-foreground text-sm">No campaigns yet.</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Connect your wallet and post the first campaign.
          </p>
          <Button render={<Link href="/stage/create" />} size="sm">
            <Plus className="size-4 mr-1" />
            Post Campaign
          </Button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
cd /Users/along/Documents/vello && git add app/stage/page.tsx && git commit -m "feat: Stage page reads real campaigns from Convex"
```

---

## Task 11: Campaign Detail Page — Convex + Submit Button

**Files:**
- Modify: `app/stage/[id]/page.tsx`
- Modify: `components/campaign/campaign-detail.tsx`

The `[id]` route param is the Convex `_id` string. The campaign detail page fetches the campaign and passes it to `CampaignDetail`. The Submit button is wired to `api.submissions.submit`.

- [ ] **Step 1: Replace `app/stage/[id]/page.tsx`**

```tsx
"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { notFound } from "next/navigation";
import { CampaignDetail } from "@/components/campaign/campaign-detail";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { Campaign, Niche, Language } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default function CampaignPage({ params }: Props) {
  const { id } = use(params);
  const doc = useQuery(api.campaigns.getById, {
    id: id as Id<"campaigns">,
  });

  if (doc === undefined) {
    return (
      <PageShell title="Loading..." description="">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading campaign...
        </div>
      </PageShell>
    );
  }

  if (doc === null) {
    notFound();
  }

  const campaign: Campaign = {
    id: doc._id,
    brandName: doc.brandName,
    brandLogoUrl: doc.brandLogoUrl,
    title: doc.title,
    brief: doc.brief,
    budget: doc.budget,
    ratePerThousandViews: doc.ratePerThousandViews,
    targetNiche: doc.targetNiche as Niche[],
    targetLanguage: doc.targetLanguage as Language[],
    isHalalOnly: doc.isHalalOnly,
    status: doc.status as Campaign["status"],
    submissionsCount: doc.submissionsCount,
    deadline: doc.deadline,
    createdAt: new Date(doc._creationTime).toISOString(),
  };

  return (
    <PageShell
      title={campaign.title}
      description={`by ${campaign.brandName} · treasury: $${campaign.budget.toLocaleString()} USDC`}
      actions={
        <Button render={<Link href="/stage" />} variant="ghost" size="sm">
          <ArrowLeft className="size-4 mr-1" />
          Back to Stage
        </Button>
      }
    >
      <CampaignDetail campaign={campaign} campaignDocId={doc._id} />
    </PageShell>
  );
}
```

- [ ] **Step 2: Read `components/campaign/campaign-detail.tsx`**

Read the full file to understand current structure.

- [ ] **Step 3: Replace `components/campaign/campaign-detail.tsx`**

Add `campaignDocId` prop and wire the Submit button to the Convex mutation. The component needs to be a client component to use wallet + Convex hooks.

```tsx
"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Clock, DollarSign, Eye, Globe, Users, CheckCircle2, Loader2, Wallet } from "lucide-react";
import type { Campaign, Niche, Language } from "@/lib/types";

const NOW = Date.now();

interface CampaignDetailProps {
  campaign: Campaign;
  campaignDocId: Id<"campaigns">;
}

export function CampaignDetail({ campaign, campaignDocId }: CampaignDetailProps) {
  const daysLeft = Math.ceil(
    (new Date(campaign.deadline).getTime() - NOW) / 86400000
  );

  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const submit = useMutation(api.submissions.submit);
  const myInfluencers = useQuery(
    api.influencers.listByCreator,
    connected && publicKey
      ? { creatorWallet: publicKey.toBase58() }
      : "skip"
  );

  const [selectedMint, setSelectedMint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!selectedMint) return;

    const inf = myInfluencers?.find((i) => i.mintAddress === selectedMint);
    if (!inf) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await submit({
        campaignId: campaignDocId,
        influencerMint: selectedMint,
        influencerName: inf.name,
        submitterWallet: publicKey.toBase58(),
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Submission failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Details */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <img
                src={campaign.brandLogoUrl}
                alt={campaign.brandName}
                className="size-16 rounded-xl object-cover"
              />
              <div>
                <h2 className="text-xl font-bold">{campaign.title}</h2>
                <p className="text-muted-foreground">{campaign.brandName}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-1.5">Campaign Brief</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {campaign.brief}
              </p>
            </div>

            <Separator />

            <div>
              <h3 className="font-semibold mb-2">Target Audience</h3>
              <div className="flex flex-wrap gap-2">
                {campaign.targetNiche.map((n) => (
                  <Badge key={n} variant="secondary" className="capitalize">
                    {n}
                  </Badge>
                ))}
                {campaign.targetLanguage.map((l) => (
                  <Badge key={l} variant="outline" className="uppercase">
                    {l}
                  </Badge>
                ))}
                {campaign.isHalalOnly && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700">
                    Halal only
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: Economics + Action */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign Economics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                icon: DollarSign,
                label: "Treasury / Budget",
                value: `$${campaign.budget.toLocaleString()} USDC`,
              },
              {
                icon: Eye,
                label: "Rate per 1K views",
                value: `$${campaign.ratePerThousandViews} USDC`,
              },
              {
                icon: Users,
                label: "Submissions",
                value: campaign.submissionsCount.toString(),
              },
              {
                icon: Clock,
                label: "Days remaining",
                value: daysLeft > 0 ? `${daysLeft} days` : "Ended",
              },
              {
                icon: Globe,
                label: "Deadline",
                value: new Date(campaign.deadline).toLocaleDateString(),
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Icon className="size-3.5" />
                  {label}
                </span>
                <span className="text-sm font-mono font-semibold">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Submit section */}
        {submitted ? (
          <Card className="border-emerald-600/30 bg-emerald-600/10">
            <CardContent className="p-3 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="size-4" />
              Submitted successfully!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {!connected && (
              <Button
                className="w-full gap-2"
                size="lg"
                onClick={() => setVisible(true)}
              >
                <Wallet className="size-4" />
                Connect wallet to submit
              </Button>
            )}

            {connected && myInfluencers && myInfluencers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center">
                You have no AI Influencers. Create one in Studio first.
              </p>
            )}

            {connected && myInfluencers && myInfluencers.length > 0 && (
              <>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedMint}
                  onChange={(e) => setSelectedMint(e.target.value)}
                >
                  <option value="">Select an AI Influencer...</option>
                  {myInfluencers.map((inf) => (
                    <option key={inf.mintAddress} value={inf.mintAddress}>
                      {inf.name} ({inf.handle})
                    </option>
                  ))}
                </select>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={!selectedMint || submitting}
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : null}
                  Submit for Campaign
                </Button>
              </>
            )}

            {submitError && (
              <p className="text-xs text-destructive text-center">
                {submitError}
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Campaign treasury: ${campaign.budget.toLocaleString()} USDC
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -40
```

Common issue: `useQuery` with `"skip"` — Convex supports `"skip"` as the second argument to skip the query when the wallet is not connected.

- [ ] **Step 5: Commit**

```bash
cd /Users/along/Documents/vello && git add "app/stage/[id]/page.tsx" components/campaign/campaign-detail.tsx && git commit -m "feat: campaign detail reads from Convex, Submit button wired to submission mutation"
```

---

## Task 12: Campaign Form — Real Convex Mutation

**Files:**
- Modify: `components/campaign/campaign-form.tsx`

Replace the mock `alert()` with a real Convex `createCampaign` mutation. Add wallet gate (wallet must be connected to post).

- [ ] **Step 1: Replace `components/campaign/campaign-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Wallet } from "lucide-react";

const campaignSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  brandName: z.string().min(2, "Brand name required"),
  brief: z.string().min(50, "Brief must be at least 50 characters"),
  budget: z.coerce.number().min(500, "Minimum budget is $500 USDC"),
  ratePerThousandViews: z.coerce
    .number()
    .min(0.5, "Minimum rate is $0.50 per 1K views"),
  isHalalOnly: z.boolean().default(false),
  deadline: z.string().min(1, "Deadline required"),
  targetNiche: z.string().min(1, "Select at least one niche"),
  targetLanguage: z.string().min(1, "Select at least one language"),
});

type CampaignFormInput = z.input<typeof campaignSchema>;
type CampaignFormValues = z.output<typeof campaignSchema>;

export function CampaignForm() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const createCampaign = useMutation(api.campaigns.create);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CampaignFormInput, unknown, CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      title: "",
      brandName: "",
      brief: "",
      budget: 5000,
      ratePerThousandViews: 3,
      isHalalOnly: false,
      deadline: "",
      targetNiche: "lifestyle",
      targetLanguage: "en",
    },
  });

  if (!connected || !publicKey) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          Connect your wallet to post a campaign.
        </p>
        <Button onClick={() => setVisible(true)} className="gap-2">
          <Wallet className="size-4" />
          Connect Wallet
        </Button>
      </div>
    );
  }

  async function onSubmit(values: CampaignFormValues) {
    if (!publicKey) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCampaign({
        creatorWallet: publicKey.toBase58(),
        brandName: values.brandName,
        title: values.title,
        brief: values.brief,
        budget: values.budget,
        ratePerThousandViews: values.ratePerThousandViews,
        targetNiche: [values.targetNiche],
        targetLanguage: [values.targetLanguage],
        isHalalOnly: values.isHalalOnly,
        deadline: new Date(values.deadline).toISOString(),
      });
      router.push("/stage");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post campaign");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="brandName">
              Brand name
            </label>
            <Input
              id="brandName"
              placeholder="Zalora, Notion, Wise..."
              {...register("brandName")}
            />
            {errors.brandName && (
              <p className="text-xs text-destructive">
                {errors.brandName.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="title">
              Campaign title
            </label>
            <Input
              id="title"
              placeholder="Raya Collection 2026 Launch..."
              {...register("title")}
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="brief">
              Campaign brief
            </label>
            <textarea
              id="brief"
              className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              placeholder="Describe what the content should cover, style, key messages, restrictions..."
              {...register("brief")}
            />
            <p className="text-xs text-muted-foreground">
              Be specific — AI Influencers follow this brief when generating
              content.
            </p>
            {errors.brief && (
              <p className="text-xs text-destructive">{errors.brief.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Targeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="targetNiche">
                Niche
              </label>
              <select
                id="targetNiche"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register("targetNiche")}
              >
                <option value="lifestyle">Lifestyle</option>
                <option value="tech">Tech</option>
                <option value="fashion">Fashion</option>
                <option value="fitness">Fitness</option>
                <option value="food">Food</option>
                <option value="travel">Travel</option>
                <option value="finance">Finance</option>
                <option value="gaming">Gaming</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="targetLanguage">
                Language
              </label>
              <select
                id="targetLanguage"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register("targetLanguage")}
              >
                <option value="en">English</option>
                <option value="ms">Malay</option>
                <option value="id">Indonesian</option>
                <option value="ar">Arabic</option>
                <option value="zh">Chinese</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              {...register("isHalalOnly")}
            />
            <span className="text-sm font-medium">
              Halal-only campaign (filters to halal-certified AI Influencers)
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Treasury / Budget</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="budget">
                Total budget / treasury (USDC)
              </label>
              <Input
                id="budget"
                type="number"
                min={500}
                {...register("budget")}
              />
              {errors.budget && (
                <p className="text-xs text-destructive">
                  {errors.budget.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="rate">
                Rate per 1K views (USDC)
              </label>
              <Input
                id="rate"
                type="number"
                min={0.5}
                step={0.5}
                {...register("ratePerThousandViews")}
              />
              {errors.ratePerThousandViews && (
                <p className="text-xs text-destructive">
                  {errors.ratePerThousandViews.message}
                </p>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="deadline">
              Campaign deadline
            </label>
            <Input id="deadline" type="date" {...register("deadline")} />
            {errors.deadline && (
              <p className="text-xs text-destructive">
                {errors.deadline.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        disabled={submitting}
      >
        {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
        Post Campaign
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add components/campaign/campaign-form.tsx && git commit -m "feat: campaign form posts real campaigns to Convex, wallet-gated"
```

---

## Task 13: Wallet Page — Show User's Real Data

**Files:**
- Modify: `app/wallet/page.tsx`

Convert to client component. Show user's created influencers and campaigns from Convex. Keep investment tab with existing mock data (no smart contracts yet).

- [ ] **Step 1: Replace `app/wallet/page.tsx`**

```tsx
"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageShell } from "@/components/layout/page-shell";
import { PortfolioSummary } from "@/components/wallet/portfolio-summary";
import { EarningsBreakdown } from "@/components/wallet/earnings-breakdown";
import { ActivityFeed } from "@/components/wallet/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Wallet, Plus, Loader2 } from "lucide-react";
import type { Niche, Language } from "@/lib/types";

export default function WalletPage() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();

  const myInfluencers = useQuery(
    api.influencers.listByCreator,
    connected && publicKey
      ? { creatorWallet: publicKey.toBase58() }
      : "skip"
  );

  const myCampaigns = useQuery(
    api.campaigns.listByCreator,
    connected && publicKey
      ? { creatorWallet: publicKey.toBase58() }
      : "skip"
  );

  if (!connected || !publicKey) {
    return (
      <PageShell title="Wallet" description="Your investments, earnings, and activity">
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <p className="text-muted-foreground text-sm">
            Connect your wallet to see your portfolio.
          </p>
          <Button onClick={() => setVisible(true)} className="gap-2">
            <Wallet className="size-4" />
            Connect Wallet
          </Button>
        </div>
      </PageShell>
    );
  }

  const totalTvl = (myInfluencers ?? []).reduce((s, i) => s + i.tvl, 0);
  const totalEarnings = (myInfluencers ?? []).reduce(
    (s, i) => s + i.monthlyEarnings,
    0
  );

  return (
    <PageShell
      title="Wallet"
      description="Your investments, earnings, and activity"
    >
      <PortfolioSummary
        totalInvested={totalTvl}
        currentValue={totalTvl}
        totalEarned={totalEarnings}
        pendingWithdrawal={Math.round(totalEarnings * 0.4)}
      />

      <Tabs defaultValue="influencers">
        <TabsList>
          <TabsTrigger value="influencers">My AI Influencers</TabsTrigger>
          <TabsTrigger value="campaigns">My Campaigns</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="influencers" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {myInfluencers === undefined ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  `${myInfluencers.length} AI Influencers`
                )}
              </CardTitle>
              <Button render={<Link href="/studio/create" />} size="sm" variant="outline">
                <Plus className="size-4 mr-1" />
                Create
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {myInfluencers === undefined && (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
              {myInfluencers?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No AI Influencers yet. Go to Studio to create one.
                </p>
              )}
              {myInfluencers?.map((inf) => (
                <div
                  key={inf._id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border"
                >
                  <img
                    src={inf.avatarUrl}
                    alt={inf.name}
                    className="size-10 rounded-full object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{inf.name}</p>
                    <p className="text-xs text-muted-foreground">{inf.handle}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary" className="capitalize text-xs">
                      {inf.niche}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    render={<Link href={`/market/${inf.mintAddress}`} />}
                  >
                    View
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {myCampaigns === undefined ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  `${myCampaigns.length} Campaigns`
                )}
              </CardTitle>
              <Button render={<Link href="/stage/create" />} size="sm" variant="outline">
                <Plus className="size-4 mr-1" />
                Post Campaign
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {myCampaigns?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No campaigns posted yet.
                </p>
              )}
              {myCampaigns?.map((c) => (
                <div
                  key={c._id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.brandName} · ${c.budget.toLocaleString()} treasury ·{" "}
                      {c.submissionsCount} submissions
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      c.status === "open"
                        ? "text-emerald-400 border-emerald-600/30"
                        : "text-zinc-400"
                    }
                  >
                    {c.status}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    render={<Link href={`/stage/${c._id}`} />}
                  >
                    View
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="earnings" className="mt-4">
          <EarningsBreakdown />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityFeed />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
cd /Users/along/Documents/vello && git add app/wallet/page.tsx && git commit -m "feat: Wallet page shows user's real influencers and campaigns from Convex"
```

---

## Task 14: Final Verification

**Files:** None new

- [ ] **Step 1: Full TypeScript check**

```bash
cd /Users/along/Documents/vello && npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 2: Build**

```bash
cd /Users/along/Documents/vello && npm run build 2>&1 | tail -30
```

Expected: clean build. Common issues:
- `notFound()` cannot be called in client components in some Next.js versions — if this errors, wrap it in a check and render a "not found" message instead
- Missing `"use client"` on a page — add it at the top
- `Id<"campaigns">` type — ensure `convex/_generated/dataModel` is imported

- [ ] **Step 3: Final commit**

```bash
cd /Users/along/Documents/vello && git add -A && git commit -m "feat: complete Convex database integration — real campaigns, influencers, submissions"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Convex `influencers` table | Task 2 |
| Convex `campaigns` table with treasury | Task 2, 4 |
| Convex `submissions` table | Task 2, 5 |
| ConvexProvider in layout | Task 6 |
| Write influencer to Convex after mint | Task 7 |
| Market reads from Convex | Task 8 |
| Market [id] reads from Convex | Task 9 |
| Stage reads campaigns from Convex | Task 10 |
| Stage [id] reads from Convex + treasury shown | Task 11 |
| Submit button wired to Convex mutation | Task 11 |
| Campaign form calls Convex mutation | Task 12 |
| Campaign form wallet-gated | Task 12 |
| Wallet page shows user's influencers | Task 13 |
| Wallet page shows user's campaigns | Task 13 |
| TypeScript clean, build passes | Task 14 |

**No placeholders found.**

**Type consistency:** `Id<"campaigns">` used consistently in Task 11 and Task 5. `api.influencers.create` args match schema in Task 3. `api.campaigns.create` args match schema in Task 4. Campaign mapping (Convex doc → `Campaign` type) is consistent between Task 10 and Task 11.
