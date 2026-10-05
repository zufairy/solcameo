import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { uniqueHandleLower } from "../influencers";
import { ensureAgentAccount } from "../agentAccount";

/** Character identity stays stable when a paper coin receives its on-chain mint. */
export async function ensureCharacterAgent(ctx: MutationCtx, character: Doc<"ssCharacters">, token: Doc<"ssTokens">) {
  const mintAddress = String(character._id);
  const existing = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", mintAddress)).unique();
  if (existing) {
    if (existing.creatorWallet !== character.ownerWallet) throw new Error("agent_owner_conflict");
    await ctx.db.patch(existing._id, { solstarCharacterId: character._id, solstarTokenId: token._id });
  } else {
    const handleLower = await uniqueHandleLower(ctx, token.ticker.toLowerCase());
    await ctx.db.insert("influencers", {
      mintAddress, solstarCharacterId: character._id, solstarTokenId: token._id,
      creatorWallet: character.ownerWallet, name: character.name, handle: handleLower, handleLower,
      avatarUrl: character.referenceImageUrl, avatarStills: [character.referenceImageUrl],
      agentType: "influencer", installedSkills: ["kie.video.generate", "ai.reasoning"], updatedAt: Date.now(), niche: character.category, language: "English", archetype: "creator",
      description: character.bio, personality: { warmth: 70, humor: 60, authority: 65, boldness: 70 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 0, totalShares: 0, availableShares: 0,
    });
  }
  await ensureAgentAccount(ctx, mintAddress);
  return mintAddress;
}
