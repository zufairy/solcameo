// @vitest-environment node
//
// PDA-derivation parity test — the ONLY runtime-testable part of escrow.ts
// before the user runs `anchor build` + regenerates the IDL. It locks the TS
// seed bytes to the Rust seed constants in programs/vello-escrow/src/lib.rs so a
// drift on either side is caught immediately. It does NOT exercise the typed
// account readers / tx builders (those need the regenerated IDL + a live chain).
//
// Rust seeds (lib.rs):
//   PLATFORM_CONFIG_SEED = b"vello:config"
//   CAMPAIGN_SEED        = b"campaign"   -> [seed, creator.key(), campaign_id]
//   CLAIM_SEED           = b"claim"      -> [seed, campaign.key(), submission_id]
//   AGENT_WALLET_SEED    = b"vello:agent"-> [seed, creator.key(), sha256(sessionId)]
import { beforeAll, describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";

const PROGRAM_ID = "4qyfe9phDNJDAUYzt4xQh7453F1zSFQLSs5aubfcoYci";

// escrow.ts reads NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID lazily inside each helper
// (getProgramId()), but set it before any import touches it to be safe.
beforeAll(() => {
  process.env.NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID = PROGRAM_ID;
});

// Imported AFTER the env is staged (dynamic import inside the test would also
// work; a top-level import is fine since getProgramId is lazy).
import {
  getCampaignPda,
  getClaimPda,
  getPlatformConfigPda,
  getAgentWalletPda,
  CAMPAIGN_SEED,
  CLAIM_SEED,
  PLATFORM_CONFIG_SEED,
  AGENT_WALLET_SEED,
} from "./escrow";

const PROGRAM = new PublicKey(PROGRAM_ID);

// A deterministic, valid creator pubkey (system program id — any valid pubkey works).
const CREATOR = "11111111111111111111111111111112";
const CAMPAIGN_ID = "campaign_abc";
const SUBMISSION_ID = "sub_xyz";
const SESSION_ID = "session-123";

describe("escrow PDA seed constants match the Rust program", () => {
  it("uses the exact seed byte strings from lib.rs", () => {
    expect(CAMPAIGN_SEED.toString("utf8")).toBe("campaign");
    expect(CLAIM_SEED.toString("utf8")).toBe("claim");
    expect(PLATFORM_CONFIG_SEED.toString("utf8")).toBe("vello:config");
    expect(AGENT_WALLET_SEED.toString("utf8")).toBe("vello:agent");
  });
});

describe("getCampaignPda — [b\"campaign\", creator, campaign_id]", () => {
  it("matches an independent findProgramAddressSync derivation", () => {
    const creator = new PublicKey(CREATOR);
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), creator.toBuffer(), Buffer.from(CAMPAIGN_ID)],
      PROGRAM
    );

    const [pda, bump] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  it("accepts a PublicKey creator and a string creator interchangeably", () => {
    const [fromString] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    const [fromKey] = getCampaignPda(CAMPAIGN_ID, new PublicKey(CREATOR));
    expect(fromString.toBase58()).toBe(fromKey.toBase58());
  });

  it("binds the creator into the seed (different creator => different PDA)", () => {
    const [a] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    const [b] = getCampaignPda(
      CAMPAIGN_ID,
      "So11111111111111111111111111111111111111112"
    );
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it("is stable (regression lock on the literal address)", () => {
    const [pda] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    expect(pda.toBase58()).toBe("8T6SmF4fhaSUCvEN5jQJMvZsY9rKBL1yRpuTGN1Fgvvx");
  });
});

describe("getClaimPda — [b\"claim\", campaignPda, submission_id]", () => {
  it("matches an independent derivation off the campaign PDA", () => {
    const [campaignPda] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), campaignPda.toBuffer(), Buffer.from(SUBMISSION_ID)],
      PROGRAM
    );

    const [pda, bump] = getClaimPda(campaignPda, SUBMISSION_ID);
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  it("accepts a string campaignPda equivalently to a PublicKey", () => {
    const [campaignPda] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    const [fromKey] = getClaimPda(campaignPda, SUBMISSION_ID);
    const [fromString] = getClaimPda(campaignPda.toBase58(), SUBMISSION_ID);
    expect(fromKey.toBase58()).toBe(fromString.toBase58());
  });

  it("is stable (regression lock on the literal address)", () => {
    const [campaignPda] = getCampaignPda(CAMPAIGN_ID, CREATOR);
    const [pda] = getClaimPda(campaignPda, SUBMISSION_ID);
    expect(pda.toBase58()).toBe("5XgAu4rBZPTmicKiztkFZgfFNwxBLYeMBt2JHBn2WUw6");
  });
});

describe("getPlatformConfigPda — [b\"vello:config\"]", () => {
  it("matches an independent single-seed derivation", () => {
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vello:config")],
      PROGRAM
    );
    const [pda, bump] = getPlatformConfigPda();
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  it("is stable (regression lock on the literal address)", () => {
    const [pda] = getPlatformConfigPda();
    expect(pda.toBase58()).toBe("Gd68sAQwBW3qPwQFDJUNVRvijj935ttw7S8tABZyT6Eo");
  });
});

describe("getAgentWalletPda — [b\"vello:agent\", creator, sha256(sessionId)]", () => {
  it("matches an independent derivation using the sha256 session hash", () => {
    const creator = new PublicKey(CREATOR);
    const sessionHash = createHash("sha256").update(SESSION_ID).digest();
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vello:agent"), creator.toBuffer(), sessionHash],
      PROGRAM
    );

    const [pda, bump] = getAgentWalletPda(CREATOR, SESSION_ID);
    expect(pda.toBase58()).toBe(expected.toBase58());
    expect(bump).toBe(expectedBump);
  });

  it("differs per sessionId", () => {
    const [a] = getAgentWalletPda(CREATOR, "session-a");
    const [b] = getAgentWalletPda(CREATOR, "session-b");
    expect(a.toBase58()).not.toBe(b.toBase58());
  });
});
