import { describe, it, expect, vi, beforeAll } from "vitest";

// Browser-ish globals BEFORE the store module loads.
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
vi.stubGlobal("window", {});
vi.stubGlobal("localStorage", storage);

// Pre-existing browser-only data (from before account sync).
mem.set("vello_control_teams", JSON.stringify([{ id: "old", name: "Old team", memberMints: ["A", "B"], createdAt: 1 }]));
mem.set("vello_control_chat_CACHED", JSON.stringify([{ id: "c1", role: "user", content: "old chat", at: 1 }]));

type Store = typeof import("./store");
let store: Store;
beforeAll(async () => { store = await import("./store"); });

function fakeServer() {
  const server = {
    teams: [{ teamId: "srv", name: "From phone", memberMints: ["A", "C"], createdAt: 9 }],
    threads: [{ key: "MINT", messages: [{ id: "s1", role: "user" as const, content: "from phone", at: 2 }], updatedAt: 2 }],
  };
  const api = {
    getToken: async () => "tok",
    bootstrap: vi.fn(async () => structuredClone(server)),
    saveThread: vi.fn(async (_a: { key: string; messages: unknown[] }) => ({ updatedAt: 3 })),
    saveTeam: vi.fn(async () => null),
    deleteTeam: vi.fn(async () => null),
  };
  return { server, api };
}

describe("account sync", () => {
  it("first sync pulls the account's data AND uploads browser-only teams + chats once", async () => {
    vi.useFakeTimers();
    const { api } = fakeServer();
    store.configureSync(api);
    await store.hydrate();

    expect(store.getThread("MINT").messages.map((m) => m.content)).toEqual(["from phone"]);
    expect(store.getTeams().map((t) => t.id).sort()).toEqual(["old", "srv"]);
    expect(api.saveTeam).toHaveBeenCalledWith(expect.objectContaining({ teamId: "old" }));

    await vi.advanceTimersByTimeAsync(800);
    expect(api.saveThread.mock.calls.map((c) => c[0].key)).toContain("CACHED");
    expect(storage.getItem("vello_control_migrated_v1")).toBe("1");
    vi.useRealTimers();
  });

  it("local edits save (debounced) and are never clobbered by a refresh before they land", async () => {
    vi.useFakeTimers();
    const { api } = fakeServer();
    store.configureSync(api);
    store.updateThread("MINT", (t) => ({ ...t, messages: [...t.messages, { id: "l1", role: "user", content: "typed here", at: 5 }] }));

    await store.hydrate(); // server still has the old copy — must NOT overwrite the dirty thread
    expect(store.getThread("MINT").messages.map((m) => m.content)).toEqual(["from phone", "typed here"]);

    await vi.advanceTimersByTimeAsync(800);
    const saved = api.saveThread.mock.calls.find((c) => c[0].key === "MINT")![0];
    expect((saved.messages as Array<{ content: string }>).map((m) => m.content)).toEqual(["from phone", "typed here"]);
    vi.useRealTimers();
  });

  it("after migration, a team deleted on another device disappears here", async () => {
    const { server, api } = fakeServer();
    server.teams = [];
    store.configureSync(api);
    await store.hydrate();
    expect(store.getTeams().map((t) => t.id)).not.toContain("srv");
  });
});
