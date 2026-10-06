import { afterEach, describe, expect, it, vi } from "vitest";
import { HIGGSFIELD_PAYMENT_WALLET, generationCollectionWallet } from "./generationCollectionWallet";

afterEach(() => vi.unstubAllEnvs());
describe("generation payment recipient", () => {
  it("is the Higgsfield top-up wallet by default and ignores the old treasury and token-launch wallets", () => {
    vi.stubEnv("NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET", "DuE7yRKcbbSAzu6mPK6gLhZ8BPsfc5NFid3b7i6pFzx2");
    vi.stubEnv("SOLCAMEO_PLATFORM_LAUNCH_WALLET", "ABiPJkc3oZACHgnLdAR6UYjXCHjnSG7ueaimZGy3DUMa");
    expect(generationCollectionWallet()).toBe("EhXTsbTMTgkGhBdUGAWx5JL78Jmu1dZgDCVUFWJp3pSa");
    expect(HIGGSFIELD_PAYMENT_WALLET).toBe("EhXTsbTMTgkGhBdUGAWx5JL78Jmu1dZgDCVUFWJp3pSa");
  });
  it("only moves when the collection wallet is set on purpose", () => {
    vi.stubEnv("SOLCAMEO_GENERATION_COLLECTION_WALLET", "ABiPJkc3oZACHgnLdAR6UYjXCHjnSG7ueaimZGy3DUMa");
    expect(generationCollectionWallet()).toBe("ABiPJkc3oZACHgnLdAR6UYjXCHjnSG7ueaimZGy3DUMa");
  });
  it("rejects an invalid configured recipient rather than silently charging another wallet", () => {
    vi.stubEnv("SOLCAMEO_GENERATION_COLLECTION_WALLET", "invalid");
    expect(() => generationCollectionWallet()).toThrow();
  });
});
