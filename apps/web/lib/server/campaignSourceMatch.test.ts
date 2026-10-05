// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/content-rewards", () => ({ getContentRewards: vi.fn() }));
vi.mock("@/lib/server/campaignSources", () => ({ resolveCampaignSources: vi.fn() }));

import { getContentRewards } from "@/lib/content-rewards";
import { resolveCampaignSources } from "@/lib/server/campaignSources";
import { matchSourceToContentReward, clearCampaignSourceMatchCache } from "./campaignSourceMatch";

const FILE = "https://drive.google.com/file/d/ABC123FILEID/view";   // sourceKey gdrive:ABC123FILEID
const OTHER = "https://drive.google.com/file/d/OTHERFILEID/view";   // only in a UGC campaign
const ORPHAN = "https://drive.google.com/file/d/NOTINANY/view";     // in no campaign

const getRewards = getContentRewards as unknown as ReturnType<typeof vi.fn>;
const resolve = resolveCampaignSources as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearCampaignSourceMatchCache();
  vi.clearAllMocks();
  getRewards.mockResolvedValue([
    { id: "cr1", type: "clipping" },
    { id: "cr2", type: "ugc" }, // NOT a clipping campaign — must be ignored
  ]);
  resolve.mockImplementation(async (id: string) =>
    id === "cr1"
      ? { contentRewardId: "cr1", title: "Clip me", videos: [{ url: FILE, name: "v1" }] }
      : { contentRewardId: id, title: "UGC", videos: [{ url: OTHER, name: "v2" }] },
  );
});

describe("matchSourceToContentReward", () => {
  it("matches a source that's within an active CLIPPING campaign", async () => {
    expect(await matchSourceToContentReward(FILE)).toBe("cr1");
  });

  it("matches by drive FILE identity, tolerating a different URL shape for the same file", async () => {
    // open?id= form of the SAME file id → same sourceKey → still matches
    expect(await matchSourceToContentReward("https://drive.google.com/open?id=ABC123FILEID")).toBe("cr1");
  });

  it("ignores non-clipping (UGC) campaigns — their sources never match", async () => {
    expect(await matchSourceToContentReward(OTHER)).toBeNull();
    // the UGC campaign must not even be resolved
    expect(resolve).not.toHaveBeenCalledWith("cr2");
  });

  it("returns null for a source in no campaign (organic — left untracked)", async () => {
    expect(await matchSourceToContentReward(ORPHAN)).toBeNull();
  });

  it("returns null (no Supabase hit) for a non-http input", async () => {
    expect(await matchSourceToContentReward("")).toBeNull();
    expect(getRewards).not.toHaveBeenCalled();
  });

  it("caches the reverse index — rebuilds only after clear", async () => {
    await matchSourceToContentReward(FILE);
    await matchSourceToContentReward(FILE);
    expect(getRewards).toHaveBeenCalledTimes(1); // 2 lookups, 1 build
    clearCampaignSourceMatchCache();
    await matchSourceToContentReward(FILE);
    expect(getRewards).toHaveBeenCalledTimes(2);
  });

  it("degrades to null when Supabase/getContentRewards throws", async () => {
    clearCampaignSourceMatchCache();
    getRewards.mockRejectedValueOnce(new Error("supabase down"));
    expect(await matchSourceToContentReward(FILE)).toBeNull();
  });
});
