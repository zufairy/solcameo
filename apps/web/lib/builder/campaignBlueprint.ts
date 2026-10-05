import { z } from "zod";

/** Platform fee on floating-wallet / campaign treasury top-ups (matches checkout UI). */
export const CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT = 20;

export const clientNavigateActionSchema = z.object({
  type: z.literal("NAVIGATE"),
  payload: z.object({
    href: z.string().min(1),
    label: z.string().min(1),
    external: z.boolean().optional(),
  }),
});

export const clientActionSchema = z.discriminatedUnion("type", [clientNavigateActionSchema]);

export type ClientAction = z.infer<typeof clientActionSchema>;

export const campaignBlueprintSchema = z.object({
  role: z.enum(["brand", "creator", "ambiguous"]).optional(),
  summary: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  community: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      audience: z.string().optional(),
      imageUrl: z.string().optional(),
      imageDirection: z.string().optional(),
      keyFeatures: z.array(z.string()).optional(),
    })
    .optional(),
  product: z
    .object({
      name: z.string().optional(),
      headline: z.string().optional(),
      description: z.string().optional(),
      pricingIdea: z.string().optional(),
      features: z.array(z.string()).optional(),
    })
    .optional(),
  campaign: z
    .object({
      name: z.string().optional(),
      angle: z.string().optional(),
      imageUrl: z.string().optional(),
      creatorBrief: z.string().optional(),
      deliverables: z.array(z.string()).optional(),
      contentInputsNeeded: z.array(z.string()).optional(),
    })
    .optional(),
  budgetTiersUsd: z
    .array(
      z.object({
        name: z.string(),
        min: z.number().optional(),
        max: z.number().optional(),
        summary: z.string(),
      }),
    )
    .optional(),
  funding: z
    .object({
      /** User-facing stage of treasury funding. */
      status: z.enum(["not_applicable", "not_started", "recommended", "user_ready_to_pay"]),
      /** Amount credited to the community floating wallet (campaign treasury) after successful top-up. */
      exampleTreasuryCreditUsd: z.number().optional(),
      /** Total charged at checkout (matches product: credit + platform fee on top). */
      exampleTotalChargedUsd: z.number().optional(),
      platformFeePercent: z.literal(CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT).optional(),
      solanaTreasuryNote: z.string().optional(),
    })
    .optional(),
});

export type CampaignBlueprint = z.infer<typeof campaignBlueprintSchema>;

export function safeParseCampaignBlueprint(raw: unknown): CampaignBlueprint | undefined {
  const r = campaignBlueprintSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

export function safeParseClientActions(raw: unknown): ClientAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientAction[] = [];
  for (const item of raw) {
    const p = clientActionSchema.safeParse(item);
    if (p.success) out.push(p.data);
  }
  return out;
}

export function fundingGuidanceBlock(_feePercent: number): string {
  return [
    `Treasury funding (product truth):`,
    `- Campaign payouts are funded from the community treasury inside Vello.`,
    `- Default funding flow: connect Phantom, deposit **USDC** on Solana devnet, and send it straight into the configured Vello treasury wallet for that campaign flow.`,
    `- Keep funding copy simple: use phrases like "deposit USDC", "top up treasury", and "activate campaign" instead of asking the user for raw treasury-wallet setup details.`,
    `- When giving an example, treat **T** as the treasury credit in USDC that lands in Vello’s treasury. If you mention a fee concept, keep it high-level unless the UI explicitly shows it.`,
    `- After budget / treasury sizing, set \`campaignBlueprint.funding.status\` to \`recommended\` and include **exampleTreasuryCreditUsd** + **exampleTotalChargedUsd** for one worked example.`,
    `- When \`communityId\` is present in ORCHESTRATION_JSON, add \`clientActions\` that move the user toward treasury deposit and campaign activation.`,
  ].join("\n");
}
