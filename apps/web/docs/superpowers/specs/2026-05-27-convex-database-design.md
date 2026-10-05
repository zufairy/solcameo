# Vello 2.0 — Convex Database Integration

## Goal

Replace all mock data with a real Convex database. Campaigns are created by wallet-connected users, each with a treasury. Influencers are stored in Convex after Solana mint. Market and Stage pages read live data.

## Architecture

```
Convex (primary database)
  ├── influencers table  ← written after Solana NFT mint
  ├── campaigns table    ← created by wallet-connected brands
  └── submissions table  ← which influencer submitted to which campaign

Auth: wallet address passed as mutation argument (no JWT/Clerk)
Reads: public (no auth required)
Writes: require walletAddress argument; mutations enforce ownership
```

## Convex Schema

```ts
// convex/schema.ts
influencers: defineTable({
  mintAddress: v.string(),       // Solana mint address (unique)
  creatorWallet: v.string(),     // wallet that minted
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
}).index("by_mint", ["mintAddress"])
  .index("by_creator", ["creatorWallet"]),

campaigns: defineTable({
  creatorWallet: v.string(),     // wallet that created = treasury authority
  brandName: v.string(),
  brandLogoUrl: v.string(),
  title: v.string(),
  brief: v.string(),
  budget: v.number(),            // USDC — treasury balance
  ratePerThousandViews: v.number(),
  targetNiche: v.array(v.string()),
  targetLanguage: v.array(v.string()),
  isHalalOnly: v.boolean(),
  status: v.string(),            // "open" | "in_progress" | "completed" | "cancelled"
  submissionsCount: v.number(),
  deadline: v.string(),
}).index("by_creator", ["creatorWallet"])
  .index("by_status", ["status"]),

submissions: defineTable({
  campaignId: v.id("campaigns"),
  influencerId: v.string(),      // Convex _id of influencer
  submitterWallet: v.string(),
  status: v.string(),            // "pending" | "approved" | "rejected"
}).index("by_campaign", ["campaignId"])
  .index("by_influencer", ["influencerId"]),
```

## Data Flow

### Influencer creation
1. User completes Studio wizard → clicks Launch
2. NFT minted on Solana (existing flow)
3. After mint success → call Convex `createInfluencer` mutation with mint address + wizard state
4. Market page reads from Convex `listInfluencers` query
5. Wallet page reads from `listInfluencersByCreator(walletAddress)` query

### Campaign creation
1. Brand connects wallet → goes to `/stage/create`
2. Fills form (brand name, title, brief, budget, deadline, etc.)
3. Submit calls `createCampaign({ creatorWallet, ...fields })` mutation
4. Campaign appears in `/stage` list immediately (Convex reactive)
5. `/stage/[id]` shows live campaign data + treasury info

### Campaign submission
1. Influencer owner visits `/stage/[id]`
2. Clicks "Submit for Campaign" → selects their influencer
3. Calls `submitToCampaign({ campaignId, influencerId, walletAddress })` mutation
4. `submissionsCount` incremented on campaign

## Files Changed

| File | Change |
|------|--------|
| `convex/schema.ts` | CREATE — table definitions |
| `convex/influencers.ts` | CREATE — queries + mutations |
| `convex/campaigns.ts` | CREATE — queries + mutations |
| `convex/submissions.ts` | CREATE — queries + mutations |
| `app/layout.tsx` | MODIFY — add ConvexProvider |
| `lib/convex-client.ts` | CREATE — typed client + CONVEX_URL config |
| `components/studio/step-launch.tsx` | MODIFY — call createInfluencer after mint |
| `app/market/page.tsx` | MODIFY — read from Convex instead of localStorage/Helius |
| `app/market/[id]/page.tsx` | MODIFY — read influencer from Convex |
| `app/stage/page.tsx` | MODIFY — read campaigns from Convex |
| `app/stage/[id]/page.tsx` | MODIFY — read campaign from Convex, submit button wired |
| `app/stage/create/page.tsx` | MODIFY — createCampaign mutation on submit |
| `app/wallet/page.tsx` | MODIFY — read user's influencers from Convex |
| `lib/mock-data.ts` | KEEP — but no longer imported anywhere |

## Environment Variables

```
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

Set in `.env.local`. Get from Convex dashboard after `npx convex dev`.

## New Packages

```
convex
```

## Success Criteria

- [ ] `npx convex dev` runs without errors
- [ ] Campaign form at `/stage/create` (wallet required) creates real campaign in Convex
- [ ] `/stage` lists all campaigns from Convex (not mock)
- [ ] `/stage/[id]` shows real campaign + treasury balance
- [ ] After Studio mint → influencer appears in Market (from Convex)
- [ ] `/market` shows all Convex influencers with filters
- [ ] Wallet page shows influencers created by connected wallet
- [ ] Submit for Campaign button calls Convex mutation
- [ ] TypeScript clean, build passes
