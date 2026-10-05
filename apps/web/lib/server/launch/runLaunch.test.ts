import { describe, it, expect, vi } from "vitest";
import { runLaunch, type LaunchDeps } from "./runLaunch";

const analysis = {
  productSummary: "A habit tracker for founders.",
  concepts: [
    { format: "reaction" as const, title: "R", idea: "reaction idea", hookText: "she really did that" },
    { format: "cartoon" as const, title: "C", idea: "cartoon idea", hookText: "" },
    { format: "review" as const, title: "V", idea: "review idea", hookText: "" },
  ],
  screenshotUrl: "https://img/shot.png",
  productImageUrl: "https://img/p1.png",
  productImageUrls: ["https://img/p1.png"],
  websiteText: "Habitloop helps you build habits.",
  identity: { agentName: "Habit Hana", handle: "habit_hana", niche: "productivity", language: "English", audience: "founders", pillars: ["streaks"] },
};

function makeDeps(over: Partial<LaunchDeps> = {}): { deps: LaunchDeps; patches: Record<string, unknown>[] } {
  const patches: Record<string, unknown>[] = [];
  const deps: LaunchDeps = {
    analyze: vi.fn(async () => analysis),
    makePresenter: vi.fn(async () => "https://img/presenter.png"),
    mint: vi.fn(async () => ({ mintAddress: "MINT123" })),
    startUgc: vi.fn(async () => "ugc_run_1"),
    renderClips: vi.fn(async () => [{ templateId: "podcast", templateLabel: "Podcast Clean", ok: true, clipUrl: "https://v/1.mp4", title: "t" }]),
    patch: vi.fn(async (fields) => { patches.push(fields); }),
    ...over,
  };
  return { deps, patches };
}

const input = { runId: "run1", websiteUrl: "https://habitloop.app/", creatorWallet: "Wa11et" };

describe("runLaunch", () => {
  it("drives analyzing → naming → minting → rendering → done and records identity + mint", async () => {
    const { deps, patches } = makeDeps();
    await runLaunch(deps, input);
    const stages = patches.map((p) => p.stage).filter(Boolean);
    expect(stages).toEqual(["naming", "minting", "rendering", "done"]);
    expect(patches.some((p) => p.agentName === "Habit Hana" && p.handle === "habit_hana")).toBe(true);
    expect(patches.some((p) => p.mintAddress === "MINT123")).toBe(true);
    expect(patches.some((p) => p.ugcRunId === "ugc_run_1")).toBe(true);
    expect(deps.renderClips).not.toHaveBeenCalled(); // no sourceUrl
    expect(deps.mint).toHaveBeenCalledWith(expect.objectContaining({
      creatorWallet: "Wa11et", avatarUrl: "https://img/presenter.png",
      identity: expect.objectContaining({ agentName: "Habit Hana" }),
    }));
  });

  it("renders clips too when a long-form link was given, and still finishes if clips fail", async () => {
    const { deps, patches } = makeDeps({ renderClips: vi.fn(async () => { throw new Error("yt-dlp exploded"); }) });
    await runLaunch(deps, { ...input, sourceUrl: "https://youtu.be/abc" });
    expect(deps.renderClips).toHaveBeenCalled();
    expect(patches.some((p) => typeof p.clipsError === "string" && /yt-dlp/.test(p.clipsError as string))).toBe(true);
    expect(patches[patches.length - 1].stage).toBe("done");
  });

  it("analysis failure → stage failed with the error, nothing minted", async () => {
    const { deps, patches } = makeDeps({ analyze: vi.fn(async () => { throw new Error("Couldn't read that site"); }) });
    await runLaunch(deps, input);
    expect(patches[patches.length - 1]).toMatchObject({ stage: "failed", error: expect.stringMatching(/read that site/) });
    expect(deps.mint).not.toHaveBeenCalled();
  });

  it("presenter failure → mints with a dicebear avatar and skips UGC samples", async () => {
    const { deps, patches } = makeDeps({ makePresenter: vi.fn(async () => { throw new Error("kie down"); }) });
    await runLaunch(deps, input);
    expect(deps.mint).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: expect.stringMatching(/dicebear/) }));
    expect(deps.startUgc).not.toHaveBeenCalled();
    expect(patches.some((p) => p.samplesSkipped === true)).toBe(true);
    expect(patches[patches.length - 1].stage).toBe("done");
  });

  it("mint failure → stage failed (samples never start)", async () => {
    const { deps, patches } = makeDeps({ mint: vi.fn(async () => { throw new Error("mint 500"); }) });
    await runLaunch(deps, input);
    expect(patches[patches.length - 1]).toMatchObject({ stage: "failed", error: expect.stringMatching(/mint 500/) });
    expect(deps.startUgc).not.toHaveBeenCalled();
  });
});
