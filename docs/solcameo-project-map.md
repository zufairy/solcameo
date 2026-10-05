# Solcameo project map

Solcameo adapts the Vello agent and video creation foundation into a Solana character and token launchpad. Existing code still uses `solstar` and some `Vello` names. Those names are implementation history; the current app navigation and homepage use Solcameo.

## Application architecture

- `apps/web`: Next.js 16 App Router, React 19, Tailwind 4. Shared UI primitives in `components/ui` use shadcn/ui with Base UI. `components.json` already configures the shadcn CLI.
- Authentication: Privy in `providers/supabase-auth-provider.tsx` (historical filename). The frontend uses a public app ID; Next.js and Convex verify access tokens and hydrate linked accounts using server credentials.
- Wallets: external and embedded Solana wallets, wallet adapter bridging, and signed wallet sessions in `providers/wallet-provider.tsx` and `lib/solana`.
- Backend: Convex functions and schema for users, agents, generations, campaigns, characters, markets, and activity. Next API routes handle integrations and server workflows.
- Video foundation: Builder, character management, generation providers including Higgsfield, clipping, carousels, recreation, and content swarms. These workflows have their own credentials and account requirements.

## Product surfaces

| Area | Routes | Role |
| --- | --- | --- |
| Launchpad | `/`, `/market`, `/market/[id]` | Character discovery, activity, market and character detail |
| Character creation | `/ai-influencer` | Existing creator onboarding |
| Agents | `/control`, `/agents`, `/studio` | Agent conversations, agent discovery, owned-agent dashboard |
| Video tools | `/builder`, `/clipping`, `/recreate`, `/carousel`, `/swarm`, `/documentary` | Existing AI content workflows |
| Generated content | `/generations` | Account-wide generated media |
| Growth | `/stage`, `/tournament`, `/arena`, `/analytics` | Campaigns, competitions, metrics |
| Research | `/intelligence` | Solana research and x402 integration |
| Account | `/wallet`, `/earnings`, `/profile`, `/billing` | Wallet, revenue, profile, credits |

The global sidebar focuses on AI influencers. The former Create tool group and Arena/Profile/Wallet/Billing sidebar links are hidden. Their underlying data and routes remain intact. The Create button opens `/create`, reusing the Builder Character tab without requiring a minted agent. New `/builder` visits use this same onboarding; existing minted agents retain their workspace.

## Current launchpad boundary

The homepage currently reads sample characters and simulated market data from Convex. Its interface is a launchpad preview; styling changes do not implement live token launches or on-chain trading. The live feed shows real available activity and an empty-state introduction when no activity exists. No invented trades, posts, or profit figures are added for visual density.

## Local development

Run `npm run dev -- --port 3001` from `apps/web`, or `npm run dev:web -- --port 3001` from the repository root. Local credentials live in ignored `apps/web/.env.local`; the root env file refers to a different historical Convex project, so backend commands should run from `apps/web`.

## Character-first creation

The flow is Character → Coin details → Review & create. Character generation is authenticated and uses owner-scoped draft storage with expiring signed job tickets. Only the selected generated portrait advances to coin creation. The final action requires a signed Solana wallet session, validates character metadata and image rights, and invokes the existing idempotent `solstarCreate.createCharacter` mutation. It creates a simulated coin in the preview market; it does not mint a live Solana token.

Soul/Soul 2 image generation requires server-side Higgsfield credentials. Storage and Convex are configured locally, and Higgsfield credentials are configured locally.

## Reference edits and Pump launch integration

Uploaded character references use Higgsfield `alibaba/qwen-image-3/edit` with the image in `image_urls`, selected traits as edit instructions, and prompt expansion disabled. Soul/Soul 2 remain the text-generation choices without a photo. Reference jobs return one tile each; selecting four produces four independent edits, not eight. The edit prompt preserves identity, composition, medium, background and all unselected traits. Generative outputs can still drift; provider results have not been visually certified for a real uploaded character.

The Coin step uses shadcn controls for SOL/USDC/custom pair planning, permanent holder rewards, creator fee shares, and optional USDC posting funds. Proposed creator-reward default: **10% Solcameo / 35% AI operations / 55% creator**. This divides earned creator fees only; it is not an additional percentage of trade principal. Holder mode allocates all creator rewards to Pump's holder system. No platform token or buy-and-burn is configured. The preview market retains its existing simulated economic rules; the new fields are stored as a future live-launch plan, not applied to paper trades.

`@pump-fun/pump-sdk` 2.0.0 prepares `createV2Instruction`, `createFeeSharingConfig`, and `updateFeeSharesV2`. The second wallet transaction atomically configures the permanent split and, if selected, transfers USDC to the operations wallet. An operations-wallet transfer does **not** link the existing influencer worker, provide server signing access, connect social accounts, or activate daily posting. That agent integration remains required before automatic paid posting can operate.

The live route at `/api/pump/launch` requires authenticated SIWS ownership, signed server receipts, mainnet confirmation of the exact reviewed message, and a mint reservation to prevent two parallel launches for one character. Browser progress stores signed transaction bytes and receipts, never the generated mint's private key. Resume is limited to the same browser session; expired blockhashes and lost browser storage need explicit recovery. No real token launch or transfer has been executed during implementation.

Required server setup before live launches:

- `SOLCAMEO_PUMP_LIVE_ENABLED=true`
- `SOLCAMEO_PUMP_RPC_URL` pointing to a mainnet RPC
- `SOLCAMEO_PLATFORM_WALLET` for the platform's 10% share
- `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta` for correct wallet signing (the existing app's other mainnet systems must be ready before changing this global setting)
- Valid influencer operations wallet for AI revenue/funding; no automatic worker key is inferred from a public address

Custom mints remain planning-only pending on-chain quote support and custom fee validation. Creator fees accumulate in Pump vaults; the creator can use the live coin page’s Distribute creator fees action to prepare `distribute_creator_fees_v2` and, after graduation, the AMM sweep. Fee sharing alone does not create automatic withdrawals or guaranteed revenue.

Primary references checked 5 October 2026:

- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md
- https://pump.fun/docs/fees
- https://open.higgsfield.ai/models/alibaba/qwen-image-3/edit/api-reference
