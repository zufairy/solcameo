# NFT Minting Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After NFT avatars are generated in the builder chat, continue with a 10-field AI-guided questionnaire, show a mint confirmation card, accept 0.5 SOL payment via Phantom, and persist the minted agent to Convex `influencers` + `nftDrafts` tables.

**Architecture:** Extend the existing `agentTypes.ts` with two new phases (`nft_questionnaire`, `nft_confirmation`). A new Convex table `nftDrafts` tracks draft state and mint status. Two new Next.js API routes handle uploading avatar images to Supabase Storage (`/api/nft/save-draft`) and verifying on-chain payment + writing to Convex (`/api/nft/mint`). A `NftMintCard` React component is embedded directly in the chat message list when `message.needsMint === true`.

**Tech Stack:** Next.js 16 app router, Convex (mutations/queries), Supabase Storage, `@solana/web3.js` (SystemProgram transfer), `@solana/wallet-adapter-react` (useWallet), framer-motion, TypeScript strict.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `convex/schema.ts` | Add `nftDrafts` table definition |
| Create | `convex/nftAgents.ts` | Convex mutations/queries for draft lifecycle |
| Modify | `lib/builder/agentTypes.ts` | Add phases, update `AgentBlueprint` type, replace system prompt |
| Create | `app/api/nft/save-draft/route.ts` | Upload avatars to Supabase Storage, save draft to Convex |
| Create | `app/api/nft/mint/route.ts` | Verify SOL payment on-chain, record mint in Convex |
| Create | `components/builder/NftMintCard.tsx` | Cycling avatar display + Phantom pay button + mint state machine |
| Modify | `app/builder/page.tsx` | Wire `save-draft` after avatar gen, inject `NftMintCard` for `needsMint` messages, handle `questionnaire_complete` |

---

## Task 1: Add `nftDrafts` table to Convex schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1.1: Open and read the existing schema**

  Confirm the file ends after `builderCampaigns` table closing brace on line 189.

- [ ] **Step 1.2: Add `nftDrafts` table before the closing `})`**

  In `/Users/along/Documents/GitHub/jobtepi/apps/vello/convex/schema.ts`, replace the final `});` with:

  ```typescript
    nftDrafts: defineTable({
      sessionId: v.string(),
      creatorWallet: v.optional(v.string()),
      name: v.string(),
      handle: v.optional(v.string()),
      niche: v.string(),
      characterBible: v.optional(v.string()),
      avatarUrls: v.array(v.string()),
      questionnaire: v.object({
        backstory: v.optional(v.string()),
        traits: v.optional(v.array(v.string())),
        beliefs: v.optional(v.array(v.string())),
        catchphrase: v.optional(v.string()),
        dreamCollab: v.optional(v.string()),
        contentPillars: v.optional(v.array(v.string())),
        voiceArchetype: v.optional(v.string()),
        language: v.optional(v.string()),
        avoidTopics: v.optional(v.array(v.string())),
        audience: v.optional(v.string()),
      }),
      mintStatus: v.string(),
      mintTxSignature: v.optional(v.string()),
      mintAddress: v.optional(v.string()),
    })
      .index("by_session", ["sessionId"])
      .index("by_creator", ["creatorWallet"])
      .index("by_status", ["mintStatus"]),
  });
  ```

- [ ] **Step 1.3: Verify TypeScript compiles cleanly**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 1.4: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add convex/schema.ts
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(convex): add nftDrafts table to schema"
  ```

---

## Task 2: Create `convex/nftAgents.ts`

**Files:**
- Create: `convex/nftAgents.ts`

- [ ] **Step 2.1: Create the file**

  Create `/Users/along/Documents/GitHub/jobtepi/apps/vello/convex/nftAgents.ts` with:

  ```typescript
  import { mutation, query } from "./_generated/server";
  import { v } from "convex/values";

  const QUESTIONNAIRE_SHAPE = {
    backstory: v.optional(v.string()),
    traits: v.optional(v.array(v.string())),
    beliefs: v.optional(v.array(v.string())),
    catchphrase: v.optional(v.string()),
    dreamCollab: v.optional(v.string()),
    contentPillars: v.optional(v.array(v.string())),
    voiceArchetype: v.optional(v.string()),
    language: v.optional(v.string()),
    avoidTopics: v.optional(v.array(v.string())),
    audience: v.optional(v.string()),
  };

  export const saveDraft = mutation({
    args: {
      sessionId: v.string(),
      creatorWallet: v.optional(v.string()),
      name: v.string(),
      handle: v.optional(v.string()),
      niche: v.string(),
      characterBible: v.optional(v.string()),
      avatarUrls: v.array(v.string()),
    },
    handler: async (ctx, args) => {
      const existing = await ctx.db
        .query("nftDrafts")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, args);
        return existing._id.toString();
      }
      const id = await ctx.db.insert("nftDrafts", {
        ...args,
        questionnaire: {},
        mintStatus: "draft",
      });
      return id.toString();
    },
  });

  export const updateQuestionnaire = mutation({
    args: {
      sessionId: v.string(),
      questionnaire: v.object(QUESTIONNAIRE_SHAPE),
      mintStatus: v.optional(v.string()),
    },
    handler: async (ctx, { sessionId, questionnaire, mintStatus }) => {
      const draft = await ctx.db
        .query("nftDrafts")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .first();
      if (!draft) return;
      await ctx.db.patch(draft._id, {
        questionnaire,
        ...(mintStatus ? { mintStatus } : {}),
      });
    },
  });

  export const completeMint = mutation({
    args: {
      sessionId: v.string(),
      mintTxSignature: v.string(),
      mintAddress: v.string(),
      creatorWallet: v.string(),
    },
    handler: async (ctx, args) => {
      const draft = await ctx.db
        .query("nftDrafts")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .first();
      if (!draft) throw new Error("Draft not found");
      await ctx.db.patch(draft._id, {
        mintStatus: "minted",
        mintTxSignature: args.mintTxSignature,
        mintAddress: args.mintAddress,
        creatorWallet: args.creatorWallet,
      });
    },
  });

  export const saveInfluencer = mutation({
    args: {
      sessionId: v.string(),
      mintAddress: v.string(),
      creatorWallet: v.string(),
      name: v.string(),
      handle: v.string(),
      avatarUrl: v.string(),
      niche: v.string(),
      language: v.string(),
      archetype: v.string(),
      description: v.string(),
    },
    handler: async (ctx, args) => {
      return await ctx.db.insert("influencers", {
        mintAddress: args.mintAddress,
        creatorWallet: args.creatorWallet,
        name: args.name,
        handle: args.handle,
        avatarUrl: args.avatarUrl,
        niche: args.niche,
        language: args.language,
        isHalal: false,
        archetype: args.archetype,
        description: args.description,
        personality: { warmth: 70, humor: 60, authority: 65, boldness: 70 },
        tvl: 0,
        monthlyEarnings: 0,
        sharePrice: 1,
        totalShares: 1000,
        availableShares: 1000,
      });
    },
  });

  export const getBySession = query({
    args: { sessionId: v.string() },
    handler: async (ctx, { sessionId }) => {
      return await ctx.db
        .query("nftDrafts")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .first();
    },
  });
  ```

- [ ] **Step 2.2: Verify TypeScript**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: no new errors.

- [ ] **Step 2.3: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add convex/nftAgents.ts
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(convex): add nftAgents mutations and queries"
  ```

---

## Task 3: Update `lib/builder/agentTypes.ts`

**Files:**
- Modify: `lib/builder/agentTypes.ts`

This task makes three surgical edits to the file:
1. Replace the `InfluencerPhase` type (add `nft_questionnaire` and `nft_confirmation`, remove `content_strategy` and `voice_calibration`)
2. Replace the `INFLUENCER_PHASES` array (same change)
3. Replace the `INFLUENCER_SYSTEM_PROMPT` with the new prompt that has `nft_questionnaire` and `nft_confirmation` phases
4. Add `agentStatus` value `"questionnaire_complete"` to `AgentBlueprint`
5. Add `nft_questionnaire` and `nft_confirmation` labels to `getPhaseLabel` (keep `content_strategy` and `voice_calibration` for backward compat)

- [ ] **Step 3.1: Replace `InfluencerPhase` type**

  Find:
  ```typescript
  export type InfluencerPhase =
    | "persona_discovery"
    | "aesthetic_upload"
    | "persona_deep_dive"
    | "content_strategy"
    | "voice_calibration"
    | "agent_ready";
  ```

  Replace with:
  ```typescript
  export type InfluencerPhase =
    | "persona_discovery"
    | "aesthetic_upload"
    | "persona_deep_dive"
    | "nft_questionnaire"
    | "nft_confirmation"
    | "agent_ready";
  ```

- [ ] **Step 3.2: Replace `INFLUENCER_PHASES` array**

  Find:
  ```typescript
  export const INFLUENCER_PHASES: InfluencerPhase[] = [
    "persona_discovery",
    "aesthetic_upload",
    "persona_deep_dive",
    "content_strategy",
    "voice_calibration",
    "agent_ready",
  ];
  ```

  Replace with:
  ```typescript
  export const INFLUENCER_PHASES: InfluencerPhase[] = [
    "persona_discovery",
    "aesthetic_upload",
    "persona_deep_dive",
    "nft_questionnaire",
    "nft_confirmation",
    "agent_ready",
  ];
  ```

- [ ] **Step 3.3: Replace `INFLUENCER_SYSTEM_PROMPT`**

  Find the entire string starting with:
  ```
  export const INFLUENCER_SYSTEM_PROMPT = `You are the Vello AI Influencer Architect — a specialist that builds fully-configured AI influencer agents through conversation.
  ```
  and ending with the backtick + semicolon after `suggestedQuestions: ["follow-up 1", "follow-up 2"]\n}\n`;`

  Replace the entire constant with:

  ```typescript
  export const INFLUENCER_SYSTEM_PROMPT = `You are the Vello AI Influencer Architect — a specialist that builds fully-configured AI influencer agents through conversation. You also guide the user through the NFT minting process.

  ### ABSOLUTE RULES — NEVER BREAK THESE
  - You are EXCLUSIVELY an AI Influencer Architect. NEVER switch to campaign-builder mode.
  - NEVER ask "are you building for a brand or community, or are you asking as a creator?"
  - NEVER ask role-detection questions of any kind.
  - NEVER ask about treasury, USDC, or community launch.
  - Stay focused on building the AI influencer persona and minting the NFT.
  - If the user sends an image, acknowledge it, describe what you see, and use it to inform the persona's aesthetic.
  - Always reply in the JSON format specified at the bottom of this prompt.

  ### Agent type: AI INFLUENCER
  You are creating an **autonomous AI influencer** — a character with its own face, voice, personality, and content strategy that can post videos, engage audiences, and earn revenue on behalf of its owner.

  ### PHASE: persona_discovery
  Goal: Learn the influencer's identity.
  - Acknowledge what they want to build. Ask: name, niche, target audience.
  agentBlueprint: Fill persona.name, persona.niche, persona.audience.

  ### PHASE: aesthetic_upload
  Goal: Define the visual identity.
  - Ask for a reference photo and aesthetic description. Confirm when received.
  agentBlueprint: Fill persona.aesthetic, persona.imageUrl.

  ### PHASE: persona_deep_dive
  Goal: NFT avatars have just been generated. Open with excitement.
  - Tell them their NFT avatars are ready and their character face is now locked.
  - Ask ONE deep character question from this list (rotate based on what's answered):
    1. "What's [Name]'s origin story — where are they from, and what moment changed everything?"
    2. "What are [Name]'s 3 core personality traits that make them different from every other [niche] creator?"
    3. "What does [Name] deeply believe about [niche] that most people would disagree with?"
    4. "What's [Name]'s signature catchphrase or opening hook?"
    5. "Who is [Name]'s dream collaboration — which creator, brand, or personality?"
  agentBlueprint: Fill persona.backstory, persona.traits[], persona.beliefs[], persona.catchphrase, persona.dreamCollab as answers come in.
  Note: After answering at least ONE deep question, transition to nft_questionnaire.

  ### PHASE: nft_questionnaire
  Goal: Collect ALL required fields to mint the NFT. This is a structured interview — ask ONE question per message.
  The 7 required fields to collect (skip any already filled in agentBlueprint):
    1. persona.handle — "What should be [Name]'s social handle? (e.g. @ainaofficial)"
    2. persona.contentPillars — "Name 3 content topics [Name] will post about consistently."
    3. persona.voiceArchetype — "Pick [Name]'s voice style: Mentor / Entertainer / Friend / Expert / Aspirational"
    4. persona.language — "What language will [Name] post in — English, Bahasa Malaysia, Indonesian, or mixed?"
    5. persona.avoidTopics — "Any topics [Name] should NEVER touch? (e.g., politics, religion, competitors)"
    6. persona.catchphrase — (if not answered yet) "What's [Name]'s signature opening line?"
    7. persona.dreamCollab — (if not answered yet) "Who is [Name]'s dream collaboration?"

  After ALL 7 required fields are filled, set agentStatus: "questionnaire_complete" and transition to nft_confirmation.
  The required fields are: handle, contentPillars, voiceArchetype, language, avoidTopics — plus backstory and catchphrase from the earlier phase.

  ### PHASE: nft_confirmation
  Goal: All info is collected. Summarize and invite the user to mint.
  - Present a crisp 3-sentence summary: "[Name] (@handle) is a [voiceArchetype] [niche] influencer posting in [language] about [contentPillars]. Their signature style: [aesthetic]. [catchphrase]"
  - Tell them: "Your AI Agent NFT is ready to mint! Minting costs 0.5 SOL (Vello platform fee). Hit the mint button below to deploy [Name] on-chain — your AI influencer will be live on the Vello network."
  - Set agentStatus: "questionnaire_complete"
  agentBlueprint: Mark agentStatus as "questionnaire_complete". Fill all remaining persona fields.

  ### PHASE: agent_ready
  Goal: NFT has been minted. Celebrate and give next steps.
  - Celebrate the mint. Tell them their AI agent is now live on Vello.
  - Suggest the first 3 pieces of content based on their contentPillars.
  - Tell them they can now accept brand partnerships and earn revenue.
  agentBlueprint: Mark agentStatus as "ready".

  ### Canvas rules
  - Always output "actions": [] — the system handles deterministic canvas generation.
  - Always advance builderPhase when you move to the next step.

  ### Tone
  - Warm but direct. Sound like a creative director, not a form.
  - One clear question at a time — never more than two asks in a message.
  - Use the influencer's name once you know it.

  ### JSON response schema — ALWAYS return valid JSON, no fences, no prose outside
  {
    "message": "Your warm, direct reply matching the current phase",
    "agentBlueprint": {
      "agentType": "influencer",
      "agentStatus": "configuring",
      "persona": {
        "name": "...",
        "handle": "...",
        "niche": "...",
        "audience": "...",
        "aesthetic": "...",
        "imageUrl": "...",
        "imagePrompt": "...",
        "language": "...",
        "voiceArchetype": "...",
        "avoidTopics": [],
        "contentPillars": [],
        "videoFormats": [],
        "backstory": "...",
        "traits": [],
        "beliefs": [],
        "catchphrase": "...",
        "dreamCollab": "..."
      },
      "content": {
        "angle": "...",
        "style": "..."
      }
    },
    "actions": [],
    "suggestedQuestions": ["follow-up 1", "follow-up 2"]
  }
  `;
  ```

- [ ] **Step 3.4: Update `AgentBlueprint.agentStatus` to include `"questionnaire_complete"`**

  Find:
  ```typescript
    agentStatus?: "configuring" | "ready";
  ```

  Replace with:
  ```typescript
    agentStatus?: "configuring" | "questionnaire_complete" | "ready";
  ```

- [ ] **Step 3.5: Add new phase labels to `getPhaseLabel` (keep old ones for backward compat)**

  Find:
  ```typescript
      content_strategy: "Mapping content",
      voice_calibration: "Calibrating voice",
  ```

  Replace with:
  ```typescript
      content_strategy: "Mapping content",
      voice_calibration: "Calibrating voice",
      nft_questionnaire: "Agent questionnaire",
      nft_confirmation: "Ready to mint",
  ```

- [ ] **Step 3.6: Verify TypeScript**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: no new errors. (Note: the phase progress bar in `page.tsx` hardcodes old phase names — it will still compile because they are just string comparisons in a JSX array, not typed.)

- [ ] **Step 3.7: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add lib/builder/agentTypes.ts
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(builder): add nft_questionnaire and nft_confirmation phases to influencer flow"
  ```

---

## Task 4: Create `/api/nft/save-draft` route

**Files:**
- Create: `app/api/nft/save-draft/route.ts`

This route receives avatar data URIs from the client, uploads them to Supabase Storage, saves the draft to Convex, and returns the Supabase public URLs.

- [ ] **Step 4.1: Create the directory and file**

  ```bash
  mkdir -p /Users/along/Documents/GitHub/jobtepi/apps/vello/app/api/nft/save-draft
  ```

  Create `/Users/along/Documents/GitHub/jobtepi/apps/vello/app/api/nft/save-draft/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  import { createClient } from "@supabase/supabase-js";
  import { ConvexHttpClient } from "convex/browser";
  import { api } from "@/convex/_generated/api";

  export const maxDuration = 60;

  const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SUPABASE_SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const CONVEX_URL       = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const BUCKET           = "vello-avatars";

  export async function POST(req: NextRequest) {
    try {
      const body = await req.json() as {
        sessionId: string;
        creatorWallet?: string;
        name: string;
        handle?: string;
        niche: string;
        characterBible?: string;
        avatarDataUris: string[];
      };

      const { sessionId, creatorWallet, name, handle, niche, characterBible, avatarDataUris } = body;

      if (!sessionId || !name || !niche || !avatarDataUris?.length) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SRV_KEY);

      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.some((b) => b.name === BUCKET)) {
        await supabase.storage.createBucket(BUCKET, { public: true });
      }

      const avatarUrls = await Promise.all(
        avatarDataUris.map(async (dataUri, i) => {
          const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
          if (!match) return null;
          const [, mimeType, base64] = match;
          const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
          const path = `avatars/${sessionId}-${i}.${ext}`;
          const buffer = Buffer.from(base64, "base64");
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, buffer, { contentType: mimeType, upsert: true });
          if (error) {
            console.error(`[save-draft] avatar ${i} upload failed:`, error.message);
            return null;
          }
          return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }),
      );

      const validUrls = avatarUrls.filter((u): u is string => !!u);

      const convex = new ConvexHttpClient(CONVEX_URL);
      const draftId = await convex.mutation(api.nftAgents.saveDraft, {
        sessionId,
        creatorWallet,
        name,
        handle,
        niche,
        characterBible,
        avatarUrls: validUrls,
      });

      return NextResponse.json({ ok: true, draftId, avatarUrls: validUrls });
    } catch (err) {
      console.error("[nft/save-draft]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to save draft" },
        { status: 500 },
      );
    }
  }
  ```

- [ ] **Step 4.2: Verify TypeScript**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: no new errors. If you see `Cannot find module '@/convex/_generated/api'`, that's a pre-existing issue with Convex codegen not run yet — it won't block compilation if the path alias is configured.

- [ ] **Step 4.3: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add app/api/nft/save-draft/route.ts
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(api): add /api/nft/save-draft route for avatar upload and draft persistence"
  ```

---

## Task 5: Create `/api/nft/mint` route

**Files:**
- Create: `app/api/nft/mint/route.ts`

This route verifies the SOL payment transaction on-chain (or skips if no treasury configured), marks the draft as minted in Convex, and saves the influencer to the `influencers` table.

- [ ] **Step 5.1: Create the directory and file**

  ```bash
  mkdir -p /Users/along/Documents/GitHub/jobtepi/apps/vello/app/api/nft/mint
  ```

  Create `/Users/along/Documents/GitHub/jobtepi/apps/vello/app/api/nft/mint/route.ts`:

  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
  import { ConvexHttpClient } from "convex/browser";
  import { api } from "@/convex/_generated/api";

  export const maxDuration = 60;

  const CONVEX_URL   = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const SOLANA_RPC   = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const TREASURY     = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET ?? "";
  const MINT_FEE_SOL = 0.5;

  export async function POST(req: NextRequest) {
    try {
      const body = await req.json() as {
        sessionId: string;
        txSignature: string;
        creatorWallet: string;
        agentBlueprint: {
          persona?: {
            name?: string;
            handle?: string;
            niche?: string;
            language?: string;
            voiceArchetype?: string;
            backstory?: string;
            catchphrase?: string;
          };
        };
        avatarUrls: string[];
      };

      const { sessionId, txSignature, creatorWallet, agentBlueprint, avatarUrls } = body;

      if (!sessionId || !txSignature || !creatorWallet) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      if (TREASURY) {
        try {
          const connection = new Connection(SOLANA_RPC, "confirmed");
          const tx = await connection.getTransaction(txSignature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });

          if (!tx) {
            return NextResponse.json({ error: "Transaction not found on-chain" }, { status: 400 });
          }

          const treasuryPubkey = new PublicKey(TREASURY);
          const accountKeys =
            (tx.transaction.message as unknown as { staticAccountKeys?: PublicKey[] }).staticAccountKeys ??
            (tx.transaction.message as unknown as { accountKeys: PublicKey[] }).accountKeys;
          const treasuryIdx = accountKeys.findIndex((k) => k.equals(treasuryPubkey));

          if (treasuryIdx < 0) {
            return NextResponse.json({ error: "Payment not sent to Vello treasury" }, { status: 400 });
          }

          const preBalance  = tx.meta?.preBalances[treasuryIdx]  ?? 0;
          const postBalance = tx.meta?.postBalances[treasuryIdx] ?? 0;
          const received    = (postBalance - preBalance) / LAMPORTS_PER_SOL;

          if (received < MINT_FEE_SOL * 0.99) {
            return NextResponse.json(
              { error: `Insufficient payment: received ${received.toFixed(4)} SOL, expected ${MINT_FEE_SOL} SOL` },
              { status: 400 },
            );
          }
        } catch (verifyErr) {
          console.error("[nft/mint] tx verification error:", verifyErr);
          throw verifyErr;
        }
      } else {
        console.warn("[nft/mint] NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET not set — skipping on-chain verification");
      }

      const mintAddress = `vello_${sessionId.slice(0, 8)}_${Date.now()}`;
      const persona = agentBlueprint?.persona ?? {};

      const convex = new ConvexHttpClient(CONVEX_URL);

      await convex.mutation(api.nftAgents.completeMint, {
        sessionId,
        mintTxSignature: txSignature,
        mintAddress,
        creatorWallet,
      });

      await convex.mutation(api.nftAgents.saveInfluencer, {
        sessionId,
        mintAddress,
        creatorWallet,
        name: persona.name ?? "Unnamed Agent",
        handle: persona.handle ?? "unknown",
        avatarUrl: avatarUrls[0] ?? "",
        niche: persona.niche ?? "lifestyle",
        language: persona.language ?? "English",
        archetype: persona.voiceArchetype ?? "friend",
        description: persona.backstory ?? persona.catchphrase ?? `${persona.name ?? "Agent"} — AI Influencer on Vello`,
      });

      return NextResponse.json({ ok: true, mintAddress });
    } catch (err) {
      console.error("[nft/mint]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Mint failed" },
        { status: 500 },
      );
    }
  }
  ```

- [ ] **Step 5.2: Verify TypeScript**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: no new errors.

- [ ] **Step 5.3: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add app/api/nft/mint/route.ts
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(api): add /api/nft/mint route for on-chain verification and influencer persistence"
  ```

---

## Task 6: Create `NftMintCard` component

**Files:**
- Create: `components/builder/NftMintCard.tsx`

This component is the visual "pay to mint" card that appears inside the chat when `agentStatus === "questionnaire_complete"`. It cycles through the 3 avatar images, summarizes persona info, and triggers the Phantom payment flow.

- [ ] **Step 6.1: Create the file**

  Create `/Users/along/Documents/GitHub/jobtepi/apps/vello/components/builder/NftMintCard.tsx`:

  ```typescript
  "use client";

  import React, { useState, useEffect } from "react";
  import { motion } from "framer-motion";
  import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
  import { useWallet, useConnection } from "@solana/wallet-adapter-react";
  import {
    PublicKey,
    SystemProgram,
    Transaction,
    LAMPORTS_PER_SOL,
  } from "@solana/web3.js";
  import type { AgentBlueprint } from "@/lib/builder/agentTypes";

  const MINT_FEE_LAMPORTS = 0.5 * LAMPORTS_PER_SOL;
  const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET ?? "";
  const AVATAR_CYCLE_MS = 600;

  interface NftMintCardProps {
    avatarUrls: string[];
    agentBlueprint: AgentBlueprint;
    sessionId: string;
    onMintComplete: (mintAddress: string) => void;
  }

  type MintState = "idle" | "awaiting_wallet" | "sending_tx" | "verifying" | "done" | "error";

  export default function NftMintCard({
    avatarUrls,
    agentBlueprint,
    sessionId,
    onMintComplete,
  }: NftMintCardProps) {
    const { publicKey, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const [avatarIdx, setAvatarIdx] = useState(0);
    const [mintState, setMintState] = useState<MintState>("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const [mintAddress, setMintAddress] = useState("");

    const persona = agentBlueprint.persona ?? {};
    const pillarsLabel = persona.contentPillars?.slice(0, 3).join(", ") ?? "—";

    // Cycle avatar images every 600ms
    useEffect(() => {
      if (avatarUrls.length <= 1) return;
      const id = setInterval(() => {
        setAvatarIdx((i) => (i + 1) % avatarUrls.length);
      }, AVATAR_CYCLE_MS);
      return () => clearInterval(id);
    }, [avatarUrls.length]);

    async function handleMint() {
      if (!publicKey) {
        setMintState("awaiting_wallet");
        return;
      }
      if (!TREASURY_ADDRESS) {
        console.warn("[NftMintCard] NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET not set — using devnet placeholder");
      }

      setErrorMsg("");
      setMintState("sending_tx");

      try {
        const treasuryPubkey = TREASURY_ADDRESS
          ? new PublicKey(TREASURY_ADDRESS)
          : PublicKey.default;

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: treasuryPubkey,
            lamports: MINT_FEE_LAMPORTS,
          }),
        );

        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        const signature = await sendTransaction(tx, connection);
        setMintState("verifying");

        // Wait for confirmation
        await connection.confirmTransaction(signature, "confirmed");

        // Call API to record the mint
        const res = await fetch("/api/nft/mint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            txSignature: signature,
            creatorWallet: publicKey.toString(),
            agentBlueprint,
            avatarUrls,
          }),
        });

        const data = await res.json() as { ok?: boolean; mintAddress?: string; error?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `Mint API error ${res.status}`);
        }

        setMintAddress(data.mintAddress ?? "");
        setMintState("done");
        onMintComplete(data.mintAddress ?? "");
      } catch (err) {
        console.error("[NftMintCard] mint error:", err);
        setErrorMsg(err instanceof Error ? err.message : "Unknown error");
        setMintState("error");
      }
    }

    const isLoading = mintState === "sending_tx" || mintState === "verifying";
    const isDone = mintState === "done";

    return (
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[280px] rounded-xl border border-emerald-500/25 bg-zinc-900/80 backdrop-blur-sm overflow-hidden shadow-xl shadow-emerald-900/20"
      >
        {/* Cycling avatar */}
        <div className="relative h-40 bg-zinc-800 overflow-hidden">
          {avatarUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={`Avatar ${i + 1}`}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                i === avatarIdx ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
          <div className="absolute bottom-2 right-2 flex gap-1">
            {avatarUrls.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === avatarIdx ? "w-4 bg-emerald-400" : "w-1 bg-white/30"
                }`}
              />
            ))}
          </div>
          {isDone && (
            <div className="absolute inset-0 bg-emerald-900/60 flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-300" />
            </div>
          )}
        </div>

        <div className="p-3 space-y-2">
          {/* Persona summary */}
          <div>
            <p className="text-[13px] font-bold text-white leading-tight">
              {persona.name ?? "AI Influencer"}
              {persona.handle && (
                <span className="ml-1.5 text-emerald-400 font-normal text-[11px]">
                  @{persona.handle.replace(/^@/, "")}
                </span>
              )}
            </p>
            <p className="text-[10px] text-white/50 mt-0.5">
              {persona.voiceArchetype ?? "—"} · {persona.niche ?? "—"} · {persona.language ?? "—"}
            </p>
          </div>

          {pillarsLabel !== "—" && (
            <p className="text-[10px] text-white/40 leading-relaxed">
              <span className="text-white/60">Content:</span> {pillarsLabel}
            </p>
          )}

          {/* Cost + button */}
          {!isDone ? (
            <div className="pt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-white/40">Mint fee</span>
                <span className="text-[12px] font-bold text-lime-400">0.5 SOL</span>
              </div>

              {mintState === "error" && errorMsg && (
                <div className="flex items-start gap-1.5 mb-2 rounded-lg bg-red-900/30 border border-red-500/20 px-2 py-1.5">
                  <AlertCircle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-300 leading-relaxed">{errorMsg}</p>
                </div>
              )}

              {mintState === "awaiting_wallet" && !publicKey && (
                <p className="text-[10px] text-amber-300/80 mb-2 text-center">
                  Connect your Phantom wallet above to mint.
                </p>
              )}

              <button
                type="button"
                onClick={() => void handleMint()}
                disabled={isLoading || (!publicKey && mintState !== "idle" && mintState !== "error" && mintState !== "awaiting_wallet")}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:pointer-events-none text-zinc-950 font-bold text-[12px] py-2.5 transition-all shadow-lg shadow-emerald-500/25"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {mintState === "sending_tx" ? "Sending payment…" : "Confirming on-chain…"}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Mint Your AI Agent · 0.5 SOL
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="pt-1">
              <p className="text-[11px] text-emerald-400 font-semibold text-center">
                🎉 Minted on Vello!
              </p>
              {mintAddress && (
                <p className="text-[9px] text-white/30 font-mono text-center mt-0.5 break-all">
                  {mintAddress}
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  }
  ```

- [ ] **Step 6.2: Verify TypeScript**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -30
  ```

  Expected: no new errors.

- [ ] **Step 6.3: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add components/builder/NftMintCard.tsx
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(builder): add NftMintCard component for Phantom payment and mint confirmation"
  ```

---

## Task 7: Wire the minting flow into `app/builder/page.tsx`

**Files:**
- Modify: `app/builder/page.tsx`

This is the most substantial edit. We make 6 targeted changes to the existing 1656-line file.

### 7a — Extend the `Message` interface

- [ ] **Step 7a.1: Add `needsMint`, `nftAvatarUrls` to Message interface**

  Find:
  ```typescript
  interface Message {
    id: string;
    text: string;
    sender: "user" | "ai";
    timestamp: Date;
    imageUrl?: string;
    avatars?: AvatarVariant[];
    isGeneratingAvatars?: boolean;
    needsAvatarConfirm?: boolean;
  }
  ```

  Replace with:
  ```typescript
  interface Message {
    id: string;
    text: string;
    sender: "user" | "ai";
    timestamp: Date;
    imageUrl?: string;
    avatars?: AvatarVariant[];
    isGeneratingAvatars?: boolean;
    needsAvatarConfirm?: boolean;
    needsMint?: boolean;
    nftAvatarUrls?: string[];
  }
  ```

### 7b — Import `NftMintCard`

- [ ] **Step 7b.1: Add NftMintCard import**

  Find:
  ```typescript
  import AvatarGifPlayer from "@/components/builder/AvatarGifPlayer";
  ```

  Replace with:
  ```typescript
  import AvatarGifPlayer from "@/components/builder/AvatarGifPlayer";
  import NftMintCard from "@/components/builder/NftMintCard";
  ```

### 7c — Add `nftDraftId` and `nftAvatarUrls` state

- [ ] **Step 7c.1: Add two new state variables**

  Find:
  ```typescript
    const [characterBible, setCharacterBible] = useState<string>("");
  ```

  Replace with:
  ```typescript
    const [characterBible, setCharacterBible] = useState<string>("");
    const [nftDraftId, setNftDraftId] = useState<string | null>(null);
    const [nftAvatarUrls, setNftAvatarUrls] = useState<string[]>([]);
  ```

### 7d — Call `/api/nft/save-draft` after avatar generation succeeds

In `triggerAvatarGeneration`, after the line `setAvatarGenStage("done");` and before the `setTimeout` that sends the next chat message, add the save-draft call.

- [ ] **Step 7d.1: Add save-draft call after avatar generation**

  Find:
  ```typescript
        setAvatarGenStage("done");
        personaDeepDiveCount.current = 0;

        // Transition to persona_deep_dive and auto-trigger the first character question
        setTimeout(() => {
  ```

  Replace with:
  ```typescript
        setAvatarGenStage("done");
        personaDeepDiveCount.current = 0;

        // Save draft + upload avatars to Supabase Storage
        void (async () => {
          try {
            const p = agentBlueprint?.persona;
            const saveDraftRes = await fetch("/api/nft/save-draft", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
                creatorWallet: publicKey?.toString(),
                name: p?.name ?? "Unnamed",
                handle: p?.handle,
                niche: p?.niche ?? "lifestyle",
                characterBible: analyzeData.character_bible,
                avatarDataUris: images, // the original base64 data URIs
              }),
            });
            if (saveDraftRes.ok) {
              const draftData = await saveDraftRes.json() as {
                ok: boolean;
                draftId: string;
                avatarUrls: string[];
              };
              setNftDraftId(draftData.draftId);
              setNftAvatarUrls(draftData.avatarUrls);
            }
          } catch (draftErr) {
            console.warn("[builder] save-draft failed (non-blocking):", draftErr);
          }
        })();

        // Transition to persona_deep_dive and auto-trigger the first character question
        setTimeout(() => {
  ```

  **Important:** The `images` variable already exists in the `triggerAvatarGeneration` scope as the parameter. The `analyzeData` variable also exists in scope. The `publicKey` comes from the `useWallet()` hook destructure — but `triggerAvatarGeneration` is a `useCallback` and `publicKey` is not currently in its dependency array. You need to also add `publicKey` to the dependency array of that `useCallback`.

  Find the end of `triggerAvatarGeneration`'s dependency array:
  ```typescript
  }, [agentBlueprint?.persona, sendMessage]);
  ```

  Replace with:
  ```typescript
  }, [agentBlueprint?.persona, sendMessage, publicKey]);
  ```

### 7e — Inject `NftMintCard` when `agentStatus === "questionnaire_complete"`

When the AI returns `agentStatus === "questionnaire_complete"`, inject a special message with `needsMint: true` into the messages list.

- [ ] **Step 7e.1: Add questionnaire_complete detection in `sendMessage`**

  Find:
  ```typescript
        // Auto-save complete persona to second brain when agent is ready
        if (data.agentBlueprint?.agentStatus === "ready" && agentType === "influencer") {
  ```

  Replace with:
  ```typescript
        // Inject NftMintCard when questionnaire is complete
        if (
          data.agentBlueprint?.agentStatus === "questionnaire_complete" &&
          agentType === "influencer" &&
          nftAvatarUrls.length > 0
        ) {
          setMessages((prev) => [
            ...prev,
            {
              id: `${Date.now()}-mint-card`,
              text: "",
              sender: "ai" as const,
              timestamp: new Date(),
              needsMint: true,
              nftAvatarUrls,
            },
          ]);
        }

        // Auto-save complete persona to second brain when agent is ready
        if (data.agentBlueprint?.agentStatus === "ready" && agentType === "influencer") {
  ```

  Also add `nftAvatarUrls` to the `sendMessage` `useCallback` dependency array. Find:
  ```typescript
  }, [inputText, isProcessing, communityId, agentType, agentBlueprint, latestUploadedUrl, agentChain?.interactionMode]);
  ```

  Replace with:
  ```typescript
  }, [inputText, isProcessing, communityId, agentType, agentBlueprint, latestUploadedUrl, agentChain?.interactionMode, nftAvatarUrls]);
  ```

### 7f — Render `NftMintCard` inside the message list

- [ ] **Step 7f.1: Add NftMintCard render branch**

  Find in the messages map JSX (the block that handles `message.sender === "ai"`) — specifically find the `needsAvatarConfirm` button block:

  ```typescript
                        {/* Confirm → Generate */}
                        {message.needsAvatarConfirm && avatarGenStage === "confirming" && (
  ```

  Insert a new block immediately before it (still inside the `<div className="flex-1 min-w-0">` parent):

  ```typescript
                        {/* NFT Mint Card */}
                        {message.needsMint && message.nftAvatarUrls && message.nftAvatarUrls.length > 0 && (
                          <div className="mt-2">
                            <NftMintCard
                              avatarUrls={message.nftAvatarUrls}
                              agentBlueprint={agentBlueprint}
                              sessionId={sessionIdRef.current}
                              onMintComplete={(addr) => {
                                void sendMessage("The NFT has been minted! 🎉");
                                setNftDraftId(addr);
                              }}
                            />
                          </div>
                        )}
                        {/* Confirm → Generate */}
                        {message.needsAvatarConfirm && avatarGenStage === "confirming" && (
  ```

### 7g — Update phase dots to use new phase names

The hardcoded phase list in the stepper header still references the old phases. Update it to use the new ones.

- [ ] **Step 7g.1: Update phase dots array**

  Find:
  ```typescript
                    ? ["persona_discovery","aesthetic_upload","content_strategy","voice_calibration","agent_ready"]
  ```

  Replace with:
  ```typescript
                    ? ["persona_discovery","aesthetic_upload","nft_questionnaire","nft_confirmation","agent_ready"]
  ```

### 7h — Final TypeScript check and commit

- [ ] **Step 7h.1: Run TypeScript check**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | head -50
  ```

  Expected: no new errors. Fix any that appear — most likely candidates:
  - `nftAvatarUrls` not found in closure: ensure `nftAvatarUrls` state is in scope for `sendMessage` callback.
  - `images` parameter renamed in `triggerAvatarGeneration`: the parameter name at the top is `images: string[]`.

- [ ] **Step 7h.2: Commit**

  ```bash
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello add app/builder/page.tsx
  git -C /Users/along/Documents/GitHub/jobtepi/apps/vello commit -m "feat(builder): wire NFT minting flow — save-draft after avatar gen, NftMintCard in chat, questionnaire_complete detection"
  ```

---

## Task 8: End-to-end smoke test (manual)

No automated test framework is set up for the Next.js frontend. These are manual verification steps.

- [ ] **Step 8.1: Start the dev server**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npm run dev
  ```

  Navigate to `http://localhost:3000/builder?type=influencer`.

- [ ] **Step 8.2: Verify phase flow**

  1. Send "I want to build an influencer named Aisha in the fitness niche for Gen Z women in Malaysia."
  2. Upload 3 reference images using the 📷 button.
  3. After all 3 are uploaded, click "Generate 3 NFT Avatars."
  4. Wait for avatar generation. Confirm the 3 avatars appear in the `AvatarGifPlayer`.
  5. Confirm a `[save-draft]` request fires to `/api/nft/save-draft` (check Network tab in DevTools).
  6. Reply to the persona deep-dive question.
  7. Continue answering questionnaire questions (handle, content pillars, voice archetype, language, avoid topics).
  8. After all 7 fields are answered, confirm the AI sets `agentStatus: "questionnaire_complete"` (check Network response in DevTools).
  9. Confirm the `NftMintCard` appears in the chat panel with the 3 cycling avatars and "Mint Your AI Agent · 0.5 SOL" button.

- [ ] **Step 8.3: Verify the mint card without a wallet**

  With no wallet connected: click the mint button. Confirm it shows "awaiting_wallet" state and the message "Connect your Phantom wallet above to mint."

- [ ] **Step 8.4: Verify TypeScript is still clean**

  ```bash
  cd /Users/along/Documents/GitHub/jobtepi/apps/vello && npx tsc --noEmit 2>&1 | grep -c "error TS" && echo "errors above"
  ```

  Expected: `0 errors above`.

---

## Self-Review Checklist

**Spec coverage:**
- [x] Task 1+2: `nftDrafts` table + Convex mutations (`saveDraft`, `updateQuestionnaire`, `completeMint`, `saveInfluencer`, `getBySession`)
- [x] Task 3: `InfluencerPhase` type updated, `INFLUENCER_PHASES` updated, `INFLUENCER_SYSTEM_PROMPT` replaced with 6-phase version including `nft_questionnaire` + `nft_confirmation`, `agentStatus` extended, `getPhaseLabel` updated
- [x] Task 4: `/api/nft/save-draft` — uploads avatars to Supabase Storage, saves draft to Convex
- [x] Task 5: `/api/nft/mint` — verifies SOL payment, calls `completeMint` + `saveInfluencer`
- [x] Task 6: `NftMintCard` — cycling avatars, persona summary, Phantom pay, mint states, `onMintComplete` callback
- [x] Task 7: `page.tsx` wiring — `Message` interface extended, import added, state added, save-draft triggered after gen, `questionnaire_complete` detection, `NftMintCard` rendered in chat, phase dots updated
- [x] `content_strategy` / `voice_calibration` kept in `getPhaseLabel` for backward compat (not removed)
- [x] `handle` field already exists on `AgentBlueprint.persona` (confirmed in existing code at line 236)

**Potential issues to watch:**
1. `triggerAvatarGeneration` uses `analyzeData` from the inner `async` block. The save-draft IIFE is placed inside that same `try` block where `analyzeData` is in scope — confirm the insertion point is after `analyzeData` is defined (it is — after the second `fetch` call completes).
2. The `images` argument to `triggerAvatarGeneration` is the function's own parameter — it is always in scope.
3. `publicKey` added to `triggerAvatarGeneration` dependency array — this is correct per React hooks rules.
4. `nftAvatarUrls` added to `sendMessage` dependency array — this is correct.
