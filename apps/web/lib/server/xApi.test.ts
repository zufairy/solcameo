// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = db.query;
    mutation = db.mutation;
  },
}));
vi.mock("./downloader", () => ({ safeFetchToBuffer: vi.fn() }));
import { pkce, seal, unseal, xConfigured, xToken, postX } from "./xApi";
import { safeFetchToBuffer } from "./downloader";
beforeEach(() => {
  db.query.mockReset();
  db.mutation.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("X OAuth security", () => {
  it("uses the RFC PKCE S256 vector", () => {
    expect(pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("encrypts credentials and rejects tampering", () => {
    vi.stubEnv(
      "X_TOKEN_ENCRYPTION_KEY",
      Buffer.alloc(32, 7).toString("base64"),
    );
    const encoded = seal({ access_token: "private-token" });
    expect(encoded).not.toContain("private-token");
    expect(unseal(encoded)).toEqual({ access_token: "private-token" });
    const b = Buffer.from(encoded, "base64url");
    b[30] ^= 1;
    expect(() => unseal(b.toString("base64url"))).toThrow();
  });
  it("fails closed without a valid encryption key", () => {
    vi.stubEnv("X_TOKEN_ENCRYPTION_KEY", "");
    expect(xConfigured()).toBe(false);
    expect(() => seal({})).toThrow();
  });
  it("never exposes provider credentials on authorization errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("secret-provider-body", { status: 403 }),
        ),
    );
    await expect(
      xToken({ grant_type: "refresh_token", refresh_token: "private" }),
    ).rejects.toThrow("X authorization failed (403)");
  });
});

describe("X posting", () => {
  const account = {
    access_token: "access",
    refresh_token: "refresh",
    expiresAt: Date.now() + 3600000,
    id: "42",
    handle: "owner",
    displayName: "Owner",
  };
  beforeEach(() => {
    vi.stubEnv(
      "X_TOKEN_ENCRYPTION_KEY",
      Buffer.alloc(32, 7).toString("base64"),
    );
  });
  it("uploads video in chunks and finalizes before publishing, accepting an empty append response", async () => {
    db.query.mockResolvedValue({ encrypted: seal(account) });
    vi.mocked(safeFetchToBuffer).mockResolvedValue({ buffer: Buffer.alloc(5 * 1024 * 1024), mime: "video/mp4" } as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "media1" } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "media1", processing_info: { state: "succeeded" } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "tweet1" } })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await postX("agent", "caption $COIN", ["https://videos.test/clip.mp4"], true)).ok).toBe(true);
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      "https://api.x.com/2/media/upload/initialize",
      "https://api.x.com/2/media/upload/media1/append",
      "https://api.x.com/2/media/upload/media1/append",
      "https://api.x.com/2/media/upload/media1/finalize",
      "https://api.x.com/2/tweets",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).segment_index).toBe(0);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).segment_index).toBe(1);
    expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBe("application/json");
    expect(Buffer.from(JSON.parse(fetchMock.mock.calls[1][1].body).media, "base64")).toHaveLength(4 * 1024 * 1024);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).media.media_ids).toEqual(["media1"]);
  });
  it("never creates a post when X video processing fails", async () => {
    db.query.mockResolvedValue({ encrypted: seal(account) });
    vi.mocked(safeFetchToBuffer).mockResolvedValue({ buffer: Buffer.alloc(10), mime: "video/mp4" } as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "media1" } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "media1", processing_info: { state: "failed" } } })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await postX("agent", "caption", ["https://videos.test/clip.mp4"], true)).ok).toBe(false);
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/tweets"))).toBe(false);
  });
  it("posts as the connected account and returns its permalink", async () => {
    db.query.mockResolvedValue({ encrypted: seal(account) });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: "123" } }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await postX("agent", "hello", []);
    expect(result.ok).toBe(true);
    expect(result.postIds).toEqual({ x: "123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.com/2/tweets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
        headers: expect.objectContaining({ Authorization: "Bearer access" }),
      }),
    );
    expect(JSON.stringify(result)).toContain("https://x.com/owner/status/123");
    expect(JSON.stringify(result)).not.toContain("refresh");
  });
  it("refreshes expired access and saves the rotated token before posting", async () => {
    db.query.mockResolvedValue({
      encrypted: seal({ ...account, expiresAt: 0 }),
    });
    db.mutation.mockResolvedValue(null);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 7200,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "124" } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await postX("agent", "hello", []);
    expect(result.ok).toBe(true);
    const saved = unseal<{ refresh_token: string }>(
      db.mutation.mock.calls[0][1].encrypted,
    );
    expect(saved.refresh_token).toBe("new-refresh");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer new-access",
    );
  });
  it("fails without an account and makes no publish request", async () => {
    db.query.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await postX("agent", "hello", []);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("surfaces API rejection as an X platform failure", async () => {
    db.query.mockResolvedValue({ encrypted: seal(account) });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Credits exhausted" }), {
            status: 402,
          }),
        ),
    );
    const result = await postX("agent", "hello", []);
    expect(result.ok).toBe(false);
    expect(result.failed?.[0].error).toContain("Credits exhausted");
  });
});
