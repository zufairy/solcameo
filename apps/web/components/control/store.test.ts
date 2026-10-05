import { describe, it, expect, vi, afterEach } from "vitest";
import { announceReadyVideos, historyFor, sendToTeam, getThread, teamKey, type Agent, type ChatMessage, type FeedItem, type Team } from "./store";

const agent = (mint: string, name: string, agentType?: string) => ({ mintAddress: mint, name, handle: name.toLowerCase(), agentType }) as unknown as Agent;

describe("historyFor", () => {
  it("frames the chat from one agent's view: own lines assistant, teammates prefixed + merged into user turns", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", content: "plan the week", at: 1 },
      { id: "2", role: "assistant", content: "I'll clip the podcast", at: 2, speaker: "A" },
      { id: "3", role: "assistant", content: "I'll film a reaction", at: 3, speaker: "B", showVideos: { count: 2, filter: "all" } },
    ];
    const names = new Map([["A", "Ann"], ["B", "Bo"]]);
    expect(historyFor(msgs, "B", names)).toEqual([
      { role: "user", content: "plan the week\n\n[Ann]: I'll clip the podcast" },
      { role: "assistant", content: "I'll film a reaction\n(showed the operator 2 latest videos as cards)" },
    ]);
  });
});

describe("sendToTeam", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mentioned member answers alone; each reply sees teammates and carries its speaker", async () => {
    const bodies: Array<{ mintAddress: string; operatorMessage?: string; team?: { name: string }; messages: Array<{ role: string; content: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      return new Response(JSON.stringify({ message: `[${b.mintAddress === "A" ? "Ann" : "Bo"}]: hi from ${b.mintAddress}` }), { status: 200 });
    }));
    const team: Team = { id: "t1", name: "Squad", memberMints: ["A", "B"], createdAt: 0 };
    const members = [agent("A", "Ann", "clipping"), agent("B", "Bo")];

    await sendToTeam(team, members, "Bo, show me your videos");
    expect(bodies.map((b) => b.mintAddress)).toEqual(["B"]);
    expect(bodies[0].operatorMessage).toBe("Bo, show me your videos");
    expect(bodies[0].team?.name).toBe("Squad");

    await sendToTeam(team, members, "everyone intro");
    expect(bodies.slice(1).map((b) => b.mintAddress)).toEqual(["A", "B"]);
    // Bo (second) sees Ann's fresh reply as a teammate line.
    expect(bodies[2].messages.at(-1)?.content).toContain("[Ann]: hi from A");

    const t = getThread(teamKey("t1"));
    expect(t.sending).toBe(false);
    expect(t.messages.filter((m) => m.role === "assistant").map((m) => [m.speaker, m.content])).toEqual([
      ["B", "hi from B"], ["A", "hi from A"], ["B", "hi from B"],
    ]);
  });
});

describe("announceReadyVideos", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("announces a fresh completed video in its owner's thread only once", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    const item = { id: "render:new", mint: "ready-agent", state: "generated", title: "Fresh edit", createdAt: Date.now() } as FeedItem;
    announceReadyVideos([item], [agent("ready-agent", "Director")]);
    announceReadyVideos([item], [agent("ready-agent", "Director")]);
    expect(getThread("ready-agent").messages.filter((message) => message.id === "video-ready:render:new")).toHaveLength(1);
    expect(getThread("ready-agent").messages.at(-1)?.showVideos?.filter).toBe("ready");
  });
});
