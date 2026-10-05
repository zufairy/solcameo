import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
vi.mock("./xApi", () => ({ xConfigured: vi.fn(() => false), readX: vi.fn(), removeX: vi.fn(), postX: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { results: { x: { url: "https://x.com/user/status/123" } } }, postIds: { x: "123" } }) }));
import { postX, readX, xConfigured } from "./xApi";
beforeEach(() => { vi.mocked(xConfigured).mockReturnValue(false); vi.mocked(postX).mockResolvedValue({ ok: true, status: 200, data: { results: { x: { url: "https://x.com/user/status/123" } } }, postIds: { x: "123" } }); });
import {
  resolveUsername,
  extractPostIds,
  extractFailedPlatforms,
  formatPlatformFailures,
  isReconnectError,
  getPostAnalytics,
  uploadVideo,
  xTweetText,
  uploadPhotos,
  pickCorrelatedPermalink,
  sanitizeYoutubeTitle,
  ensureProfile,
  generateConnectUrl,
  getProfile,
  RateLimitError,
} from "./uploadPost";

describe("resolveUsername — per-agent profile isolation", () => {
  const orig = process.env.UPLOAD_POST_USERNAME_PREFIX;
  afterEach(() => {
    if (orig === undefined) delete process.env.UPLOAD_POST_USERNAME_PREFIX;
    else process.env.UPLOAD_POST_USERNAME_PREFIX = orig;
  });

  it("gives a DISTINCT profile id per agent (no shared-profile collapse)", () => {
    delete process.env.UPLOAD_POST_USERNAME_PREFIX;
    const a = resolveUsername("MintAAA111");
    const b = resolveUsername("MintBBB222");
    expect(a).toBe("MintAAA111");
    expect(b).toBe("MintBBB222");
    expect(a).not.toBe(b);
  });

  it("sanitizes characters upload-post disallows", () => {
    delete process.env.UPLOAD_POST_USERNAME_PREFIX;
    expect(resolveUsername("sess:12/34 56")).toBe("sess123456");
  });

  it("namespaces with a prefix yet stays unique per agent", () => {
    process.env.UPLOAD_POST_USERNAME_PREFIX = "vello";
    expect(resolveUsername("MintAAA")).toBe("vello_MintAAA");
    expect(resolveUsername("MintBBB")).toBe("vello_MintBBB");
  });

  it("returns empty string for empty input", () => {
    delete process.env.UPLOAD_POST_USERNAME_PREFIX;
    expect(resolveUsername("")).toBe("");
  });
});

describe("social connect rate-limit protection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the connected account's platform ID and public handle, not the agent handle", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      profile: { social_accounts: {
        tiktok: { username: "opaque-open-id", handle: "@real.creator", display_name: "Real Creator" },
        youtube: { username: "UCabcdefghijklmnopqrstuv", handle: "creator-channel" },
      } },
    }), { status: 200 })));

    const profile = await getProfile("vello_agent_1");
    expect(profile.connected.tiktok).toMatchObject({ id: "opaque-open-id", handle: "@real.creator", displayName: "Real Creator" });
    expect(profile.connected.youtube).toMatchObject({ id: "UCabcdefghijklmnopqrstuv", handle: "creator-channel" });
  });

  it("does not report a transient provider rate limit as a disconnected account", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 429 })));
    await expect(getProfile("vello_agent_2")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("does not recreate a profile that the Schedule status request already found", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const username = "connect_known_profile_1";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { social_accounts: {} } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_url: "https://connect.example/known" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await getProfile(username)).exists).toBe(true);
    await expect(generateConnectUrl(username, { platforms: ["instagram"] })).resolves.toBe("https://connect.example/known");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/users/generate-jwt");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/uploadposts/users"))).toBe(false);
  });

  // ensureProfile used to fire an existence-check GET before the create POST —
  // 2 calls per profile setup, on top of the generate-jwt call every connect
  // click also makes. upload-post's rate limit is a shared bucket across every
  // agent on this account, so that extra call made a brand-new agent's very
  // FIRST connect attempt trip the limit far more easily than it needed to
  // (surfacing as "Preparing the secure connect link. Retrying in Ns"). The
  // create endpoint already treats "already exists" (400/409) as success, so
  // a single create call now both confirms AND creates in one round trip.
  it("confirms or creates a profile in a single call (no existence-check GET)", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const username = "connect_existing_profile_0";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 409 })); // already exists
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureProfile(username)).resolves.toMatchObject({ ok: true, created: false, limitReached: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/uploadposts\/users$/);
  });

  it("coalesces simultaneous connect clicks into one provider request", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const username = "connect_single_flight_2";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { social_accounts: {} } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_url: "https://connect.example/one" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getProfile(username);

    const [a, b] = await Promise.all([
      generateConnectUrl(username, { platforms: ["tiktok"] }),
      generateConnectUrl(username, { platforms: ["tiktok"] }),
    ]);
    expect(a).toBe("https://connect.example/one");
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not mistake a profile-creation 429 for a usable profile", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { "Retry-After": "17" } },
    )));

    await expect(ensureProfile("connect_rate_limited_3")).rejects.toMatchObject({
      name: "RateLimitError",
      retryAfterSeconds: 17,
    } satisfies Partial<RateLimitError>);
  });

  it("can still generate a connect URL when profile creation is rate-limited but the profile already exists", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const username = "connect_profile_check_429_but_exists_5";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": "23" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_url: "https://connect.example/after-check-429" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateConnectUrl(username, { platforms: ["instagram"] })).resolves.toBe("https://connect.example/after-check-429");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/uploadposts\/users$/);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/users/generate-jwt");
  });

  it("reuses a fresh agent connect URL instead of blocking a repeat platform click on provider cooldown", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const username = "connect_reuse_after_429_4";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { social_accounts: {} } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_url: "https://connect.example/reusable" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": "56" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await getProfile(username)).exists).toBe(true);
    await expect(generateConnectUrl(username, { platforms: ["instagram"] })).resolves.toBe("https://connect.example/reusable");
    await expect(generateConnectUrl(username, { platforms: ["tiktok"] })).resolves.toBe("https://connect.example/reusable");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("/users/generate-jwt");
  });
});

// ─── extractPostIds ──────────────────────────────────────────────────────────

describe("extractPostIds", () => {
  it("pulls platform_post_id per requested platform and the top-level request_id", () => {
    const body = {
      request_id: "req_1",
      results: {
        tiktok: { success: true, platform_post_id: "vid123" },
        instagram: { success: true, platform_post_id: "ig456" },
      },
    };
    const out = extractPostIds(body, ["tiktok", "instagram"]);
    expect(out.requestId).toBe("req_1");
    expect(out.postIds).toEqual({ tiktok: "vid123", instagram: "ig456" });
  });

  it("falls back through publish_id / post_id / id / video_id / post_ids[0]", () => {
    const body = {
      platforms: {
        tiktok: { publish_id: "pub1" },
        instagram: { post_id: "p2" },
        youtube: { id: "yt3" },
        facebook: { video_id: "fb4" },
        linkedin: { post_ids: ["li5", "li5b"] },
      },
    };
    const out = extractPostIds(body, ["tiktok", "instagram", "youtube", "facebook", "linkedin"]);
    expect(out.postIds).toEqual({
      tiktok: "pub1",
      instagram: "p2",
      youtube: "yt3",
      facebook: "fb4",
      linkedin: "li5",
    });
  });

  it("prefers platform_post_id over the fallbacks", () => {
    const body = { results: { tiktok: { platform_post_id: "primary", id: "fallback" } } };
    expect(extractPostIds(body, ["tiktok"]).postIds).toEqual({ tiktok: "primary" });
  });

  it("resolves X via its 'twitter' alias key", () => {
    const body = { results: { twitter: { platform_post_id: "tw99" } } };
    const out = extractPostIds(body, ["x"]);
    expect(out.postIds).toEqual({ x: "tw99" });
  });

  it("reads requestId from a camelCase requestId field too", () => {
    const body = { requestId: "req_camel", results: {} };
    expect(extractPostIds(body, []).requestId).toBe("req_camel");
  });

  it("only includes platforms where an id was found", () => {
    const body = { results: { tiktok: { platform_post_id: "vid123" }, instagram: { success: true } } };
    const out = extractPostIds(body, ["tiktok", "instagram"]);
    expect(out.postIds).toEqual({ tiktok: "vid123" });
  });

  it("ignores empty-string ids", () => {
    const body = { results: { tiktok: { platform_post_id: "", id: "" } } };
    expect(extractPostIds(body, ["tiktok"]).postIds).toEqual({});
  });

  it("returns { postIds: {} } and no throw for unknown / empty shapes", () => {
    expect(extractPostIds(undefined, ["tiktok"])).toEqual({ postIds: {} });
    expect(extractPostIds(null, ["tiktok"])).toEqual({ postIds: {} });
    expect(extractPostIds("a string", ["tiktok"])).toEqual({ postIds: {} });
    expect(extractPostIds(42, ["tiktok"])).toEqual({ postIds: {} });
    expect(extractPostIds({}, ["tiktok"])).toEqual({ postIds: {} });
    expect(extractPostIds({ results: "not-an-object" }, ["tiktok"])).toEqual({ postIds: {} });
  });

  it("omits requestId when it is not a non-empty string", () => {
    expect(extractPostIds({ request_id: "", results: {} }, []).requestId).toBeUndefined();
    expect(extractPostIds({ request_id: 123, results: {} }, []).requestId).toBeUndefined();
  });
});

// ─── pickCorrelatedPermalink (Bug A: never submit an unrelated post's URL) ────

describe("pickCorrelatedPermalink", () => {
  it("returns the permalink of the item whose platform_post_id matches THIS post", () => {
    const items = [
      { permalink: "https://www.instagram.com/reel/OLDER/", platform_post_id: "ig_old" },
      { permalink: "https://www.instagram.com/reel/MINE/", platform_post_id: "ig_mine" },
    ];
    expect(pickCorrelatedPermalink(items, { platformPostId: "ig_mine" })).toBe("https://www.instagram.com/reel/MINE/");
  });

  it("does NOT return the newest/unrelated post when nothing matches (the core bug)", () => {
    // The media list's FIRST (newest) item is an unrelated reel; our post isn't
    // indexed yet. Must resolve null, not the stale reel.
    const items = [
      { permalink: "https://www.instagram.com/reel/UNRELATED1/", platform_post_id: "ig_other1" },
      { permalink: "https://www.instagram.com/reel/UNRELATED2/", platform_post_id: "ig_other2" },
    ];
    expect(pickCorrelatedPermalink(items, { platformPostId: "ig_mine" })).toBeNull();
    expect(pickCorrelatedPermalink(items, { requestId: "req_mine" })).toBeNull();
  });

  it("returns null when no correlation key is supplied (never guess the newest)", () => {
    const items = [{ permalink: "https://www.instagram.com/reel/NEWEST/", platform_post_id: "whatever" }];
    expect(pickCorrelatedPermalink(items, {})).toBeNull();
  });

  it("correlates via the upload-post request_id when the item echoes it", () => {
    const items = [
      { permalink: "https://www.tiktok.com/@x/video/1", request_id: "req_other" },
      { permalink: "https://www.tiktok.com/@x/video/2", request_id: "req_mine" },
    ];
    expect(pickCorrelatedPermalink(items, { requestId: "req_mine" })).toBe("https://www.tiktok.com/@x/video/2");
  });

  it("matches across the fallback id fields (post_id / publish_id / id / video_id / media_id)", () => {
    expect(pickCorrelatedPermalink([{ permalink: "https://x/1", post_id: "a" }], { platformPostId: "a" })).toBe("https://x/1");
    expect(pickCorrelatedPermalink([{ permalink: "https://x/2", publish_id: "b" }], { platformPostId: "b" })).toBe("https://x/2");
    expect(pickCorrelatedPermalink([{ permalink: "https://x/3", id: "c" }], { platformPostId: "c" })).toBe("https://x/3");
    expect(pickCorrelatedPermalink([{ permalink: "https://x/4", video_id: "d" }], { platformPostId: "d" })).toBe("https://x/4");
    expect(pickCorrelatedPermalink([{ permalink: "https://x/5", media_id: "e" }], { platformPostId: "e" })).toBe("https://x/5");
  });

  it("ignores a matching item that has no usable http permalink", () => {
    const items = [
      { permalink: "not-a-url", platform_post_id: "ig_mine" },
      { media_url: "https://cdn/v.mp4", platform_post_id: "ig_mine" },
    ];
    expect(pickCorrelatedPermalink(items, { platformPostId: "ig_mine" })).toBeNull();
  });

  it("is defensive against junk shapes (non-array, nulls, non-objects, empty ids)", () => {
    expect(pickCorrelatedPermalink(undefined, { platformPostId: "x" })).toBeNull();
    expect(pickCorrelatedPermalink(null, { platformPostId: "x" })).toBeNull();
    expect(pickCorrelatedPermalink("string", { platformPostId: "x" })).toBeNull();
    expect(pickCorrelatedPermalink([null, 42, "s"], { platformPostId: "x" })).toBeNull();
    // Empty-string ids on the item must not match an empty-string / trimmed key.
    expect(pickCorrelatedPermalink([{ permalink: "https://x/1", platform_post_id: "" }], { platformPostId: "  " })).toBeNull();
  });
});

// ─── send() surfacing ids (via uploadVideo) ──────────────────────────────────

describe("send() surfaces requestId + postIds", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uploadVideo returns requestId + postIds when the response carries them", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            request_id: "req_1",
            results: {
              tiktok: { success: true, platform_post_id: "vid123" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await uploadVideo({
      username: "u",
      platforms: ["tiktok"],
      videoUrl: "https://cdn/v.mp4",
      title: "t",
    });
    expect(out.ok).toBe(true);
    expect(out.requestId).toBe("req_1");
    expect(out.postIds).toEqual({ tiktok: "vid123" });
  });

  it("leaves postIds undefined when none are present", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const out = await uploadVideo({
      username: "u",
      platforms: ["tiktok"],
      videoUrl: "https://cdn/v.mp4",
      title: "t",
    });
    expect(out.requestId).toBeUndefined();
    expect(out.postIds).toBeUndefined();
  });
});

// ─── sanitizeYoutubeTitle + uploadVideo youtube_title cap ────────────────────

describe("sanitizeYoutubeTitle", () => {
  it("passes a short clean title through unchanged", () => {
    expect(sanitizeYoutubeTitle("How I grew 10x in 30 days")).toBe("How I grew 10x in 30 days");
  });

  it("caps a >100-char title to <=100 chars at a word boundary", () => {
    const long = "This is an extremely long YouTube title that clearly exceeds the one hundred character maximum limit allowed by the platform";
    const out = sanitizeYoutubeTitle(long);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(" ")).toBe(false);
    expect(long.startsWith(out)).toBe(true); // it's a clean prefix, not mangled
  });

  it("removes em/en dashes (operator never wants them)", () => {
    expect(sanitizeYoutubeTitle("Focus on growth — not just noise")).not.toMatch(/[—–]/);
    expect(sanitizeYoutubeTitle("A – B")).not.toMatch(/[—–]/);
  });

  it("never shears off most of the title just to hit a word boundary", () => {
    const oneLongWord = "x".repeat(130);
    const out = sanitizeYoutubeTitle(oneLongWord);
    expect(out.length).toBe(100); // hard cut, since there's no usable space
  });
});

describe("uploadVideo — youtube_title is always <=100 chars (no 400)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("caps a long caption title before sending youtube_title", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    let sentYoutubeTitle: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: FormData }) => {
        sentYoutubeTitle = init.body.get("youtube_title") as string;
        return new Response(JSON.stringify({ results: { youtube: { success: true } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const longTitle = "A ".repeat(80).trim(); // ~158 chars
    await uploadVideo({ username: "u", platforms: ["youtube"], videoUrl: "https://cdn/v.mp4", title: longTitle });
    expect(sentYoutubeTitle).not.toBeNull();
    expect((sentYoutubeTitle as unknown as string).length).toBeLessThanOrEqual(100);
  });

  it("prefers an explicit youtubeTitle over the caption", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    let sent: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: FormData }) => {
        sent = init.body.get("youtube_title") as string;
        return new Response(JSON.stringify({ results: { youtube: { success: true } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await uploadVideo({
      username: "u",
      platforms: ["youtube"],
      videoUrl: "https://cdn/v.mp4",
      title: "the long caption body used as the post description everywhere else",
      youtubeTitle: "Short punchy title",
    });
    expect(sent).toBe("Short punchy title");
  });
});

// ─── extractFailedPlatforms (sent-vs-read X/twitter alias) ───────────────────

describe("extractFailedPlatforms — alias-aware X (twitter) failure detection", () => {
  it("flags a failed X post keyed under the 'twitter' alias (the video-endpoint key)", () => {
    // The video endpoint SENDS X as platform[]=twitter, so upload-post keys the
    // result under "twitter". Requested is our canonical "x". Must still detect it.
    const body = { results: { twitter: { success: false, error: "Token expired, please reconnect" } } };
    expect(extractFailedPlatforms(body, ["x"])).toEqual([
      { platform: "x", error: "Token expired, please reconnect" },
    ]);
  });

  it("flags a failed X post keyed under the canonical 'x' too", () => {
    const body = { results: { x: { status: "error", error: "rate limited" } } };
    expect(extractFailedPlatforms(body, ["x"])).toEqual([{ platform: "x", error: "rate limited" }]);
  });

  it("does NOT flag a successful X post keyed under 'twitter' (no false failure)", () => {
    const body = { results: { twitter: { success: true, platform_post_id: "tw1" } } };
    expect(extractFailedPlatforms(body, ["x"])).toEqual([]);
  });

  it("reports only the platforms the body says failed", () => {
    const body = {
      results: {
        twitter: { success: false, error: "auth expired" },
        instagram: { success: true, platform_post_id: "ig1" },
      },
    };
    expect(extractFailedPlatforms(body, ["x", "instagram"])).toEqual([
      { platform: "x", error: "auth expired" },
    ]);
  });

  it("is defensive against unknown / empty shapes", () => {
    expect(extractFailedPlatforms(undefined, ["x"])).toEqual([]);
    expect(extractFailedPlatforms({}, ["x"])).toEqual([]);
    expect(extractFailedPlatforms({ results: "nope" }, ["x"])).toEqual([]);
  });
});

// uploadVideo end-to-end: a failed X post keyed under "twitter" now makes ok=false
describe("uploadVideo — a failed X (twitter-keyed) post is NOT reported as success", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns ok:false + the per-platform failure for a stale-token X post", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ results: { twitter: { success: false, error: "Token expired, please reconnect" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.mocked(postX).mockResolvedValueOnce({ ok: false, status: 401, data: { error: "Token expired, please reconnect" }, failed: [{ platform: "x", error: "Token expired, please reconnect" }] });
    const out = await uploadVideo({ username: "u", platforms: ["x"], videoUrl: "https://cdn/v.mp4", title: "t" });
    expect(out.ok).toBe(false);
    expect(out.failed).toEqual([{ platform: "x", error: "Token expired, please reconnect" }]);
  });
});

// ─── formatPlatformFailures / isReconnectError (surfaced, actionable reason) ──

describe("formatPlatformFailures", () => {
  it("returns empty string for no failures", () => {
    expect(formatPlatformFailures(undefined)).toBe("");
    expect(formatPlatformFailures([])).toBe("");
  });

  it("names the platform with its UI label", () => {
    expect(formatPlatformFailures([{ platform: "x", error: "boom" }])).toBe("X: boom");
  });

  it("appends a reconnect hint for a stale-token / auth error", () => {
    const s = formatPlatformFailures([{ platform: "x", error: "OAuth token expired" }]);
    expect(s).toContain("X: OAuth token expired");
    expect(s).toMatch(/reconnect X in the builder's Connections panel/i);
  });

  it("does NOT add a reconnect hint for an unrelated (non-auth) error", () => {
    expect(formatPlatformFailures([{ platform: "tiktok", error: "video too long" }])).toBe(
      "TikTok: video too long",
    );
  });

  it("falls back to 'post failed' for an empty error string", () => {
    expect(formatPlatformFailures([{ platform: "instagram", error: "  " }])).toBe("Instagram: post failed");
  });

  it("joins multiple platform failures with a semicolon", () => {
    const s = formatPlatformFailures([
      { platform: "x", error: "revoked access" },
      { platform: "instagram", error: "media invalid" },
    ]);
    expect(s).toContain("X: revoked access");
    expect(s).toContain("Instagram: media invalid");
    expect(s).toContain(";");
  });
});

describe("isReconnectError", () => {
  it("detects auth-class messages", () => {
    for (const m of ["token expired", "401 Unauthorized", "403 Forbidden", "please re-connect your account", "consent required", "access revoked"]) {
      expect(isReconnectError(m)).toBe(true);
    }
  });
  it("does NOT flag generic media/encoding errors", () => {
    for (const m of ["video too long", "media invalid", "video encoding failed", "rate limited"]) {
      expect(isReconnectError(m)).toBe(false);
    }
  });
});

// ─── getPostAnalytics ────────────────────────────────────────────────────────

const SUCCESS_BODY = {
  request_id: "req_1",
  platforms: {
    tiktok: {
      success: true,
      platform_post_id: "vid123",
      post_url: "https://www.tiktok.com/@x/video/vid123",
      post_metrics: { views: 1234, likes: 56, comments: 7, shares: 2 },
      post_metrics_source: "platform_api",
    },
  },
};

describe("getPostAnalytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("request_id mode: parses metrics, returns platformPostId + postUrl, hits the right URL with auth header", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out).toEqual({
      ok: true,
      metrics: { views: 1234, likes: 56, comments: 7, shares: 2 },
      platformPostId: "vid123",
      postUrl: "https://www.tiktok.com/@x/video/vid123",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/uploadposts/post-analytics/req_1");
    expect(String(url)).toContain("platform=tiktok");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Apikey k");
  });

  it("request_id mode without a platform: takes the first platforms entry, no ?platform query", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await getPostAnalytics({ requestId: "req_1" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.metrics).toEqual({ views: 1234, likes: 56, comments: 7, shares: 2 });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/uploadposts/post-analytics/req_1");
    expect(String(url)).not.toContain("platform=");
  });

  it("platform_post_id mode: builds ?platform_post_id=&platform=&user= and parses metrics", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await getPostAnalytics({ platformPostId: "vid123", platform: "tiktok", username: "u@1" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.metrics).toEqual({ views: 1234, likes: 56, comments: 7, shares: 2 });
      expect(out.platformPostId).toBe("vid123");
    }
    const [url] = fetchMock.mock.calls[0];
    const s = String(url);
    expect(s).toContain("/uploadposts/post-analytics?");
    expect(s).toContain("platform_post_id=vid123");
    expect(s).toContain("platform=tiktok");
    expect(s).toContain("user=u%401"); // encoded
  });

  it("uses a flat top-level post_metrics object when there is no platforms map", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ platform_post_id: "flat1", post_url: "https://x/y", post_metrics: { views: 9 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.metrics).toEqual({ views: 9 });
      expect(out.platformPostId).toBe("flat1");
      expect(out.postUrl).toBe("https://x/y");
    }
  });

  it("post_metrics_error present (no post_metrics) → not_ready", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ platforms: { tiktok: { post_metrics_error: "still processing" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out).toEqual({ ok: false, reason: "not_ready" });
  });

  it("missing post_metrics → not_ready", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ platforms: { tiktok: { success: true, platform_post_id: "vid123" } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out).toEqual({ ok: false, reason: "not_ready" });
  });

  it("HTTP 404 → not_found", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out).toEqual({ ok: false, reason: "not_found", status: 404 });
  });

  it("unsupported platform (not in PLATFORM_IDS) → unsupported, no fetch", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await getPostAnalytics({ platformPostId: "p", platform: "snapchat", username: "u" });
    expect(out).toEqual({ ok: false, reason: "unsupported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the 'twitter' alias as a supported platform", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ platforms: { twitter: { post_metrics: { views: 3 } } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1", platform: "twitter" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.metrics).toEqual({ views: 3 });
  });

  it("fetch throws → error", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("error");
  });

  it("HTTP 500 → error with status", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out).toEqual({ ok: false, reason: "error", status: 500 });
  });

  it("drops non-numeric metric values, keeps numeric ones", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ platforms: { tiktok: { post_metrics: { views: "n/a", likes: 5, score: "12" } } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out.ok).toBe(true);
    // "n/a" → NaN (dropped); 5 kept; "12" → 12 kept (Number coercion of numeric strings).
    if (out.ok) expect(out.metrics).toEqual({ likes: 5, score: 12 });
  });

  it("drops null / empty-string / boolean metric values (does NOT coerce to 0)", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            platforms: { tiktok: { post_metrics: { views: 30000, likes: null, comments: "", shares: false, saves: 5 } } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1", platform: "tiktok" });
    expect(out.ok).toBe(true);
    // null / "" / false MUST be absent (NEVER coerced to 0); only genuine numbers survive.
    if (out.ok) expect(out.metrics).toEqual({ views: 30000, saves: 5 });
  });

  it("resolves an X ('twitter'-keyed) entry when queried by canonical platform 'x'", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            platforms: {
              twitter: {
                platform_post_id: "tw_abc",
                post_url: "https://x.com/i/web/status/tw_abc",
                post_metrics: { views: 80000, likes: 1200 },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ platformPostId: "tw_abc", platform: "x", username: "u" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.metrics).toEqual({ views: 80000, likes: 1200 });
      expect(out.platformPostId).toBe("tw_abc");
    }
  });

  it("no-platform query with TWO platform entries → not_ready (ambiguous, never guess the wrong post)", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            platforms: {
              tiktok: { platform_post_id: "tt_1", post_metrics: { views: 10 } },
              instagram: { platform_post_id: "ig_2", post_metrics: { views: 999999 } },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    // requestId mode + no platform → cannot disambiguate two entries → defer.
    const out = await getPostAnalytics({ requestId: "req_1" });
    expect(out).toEqual({ ok: false, reason: "not_ready" });
  });

  it("no-platform query with ONE platform entry → still resolves ok:true", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ platforms: { tiktok: { platform_post_id: "tt_1", post_metrics: { views: 42 } } } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ requestId: "req_1" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.metrics).toEqual({ views: 42 });
  });

  it("does NOT settle on a single foreign-platform entry whose post id does not match (money-path hazard)", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            // The map's only entry belongs to a DIFFERENT platform & post than queried.
            platforms: { instagram: { platform_post_id: "ig_OTHER", post_metrics: { views: 999999 } } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ platformPostId: "tt_MY", platform: "tiktok", username: "u" });
    // Must NOT mis-measure the foreign instagram post (999,999 views) — defer instead.
    expect(out).toEqual({ ok: false, reason: "not_ready" });
  });

  it("recovers via the single-entry fallback ONLY when its platform_post_id matches the queried post", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            // Unmapped key, but the entry's id provably matches the queried post.
            platforms: { someunmappedkey: { platform_post_id: "tt_MY", post_metrics: { views: 50 } } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const out = await getPostAnalytics({ platformPostId: "tt_MY", platform: "tiktok", username: "u" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.metrics).toEqual({ views: 50 });
  });
});

// ─── uploadPhotos (Photo Carousel Builder → TikTok) ─────────────────────────

describe("uploadPhotos — TikTok carousel knobs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("appends the TikTok photo params + ordered photos[] to /upload_photos", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await uploadPhotos({
      username: "mintAAA",
      platforms: ["tiktok"],
      photoUrls: ["https://a/img1.jpg", "https://a/img2.jpg"],
      title: "Carousel",
      description: "desc",
      tiktokTitle: "TikTok caption",
      postMode: "DIRECT_POST",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      autoAddMusic: true,
      disableComment: false,
      brandContentToggle: false,
      brandOrganicToggle: false,
      photoCoverIndex: 1,
    });

    expect(out.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/upload_photos");
    const form = init?.body as FormData;
    expect(form.getAll("photos[]")).toEqual(["https://a/img1.jpg", "https://a/img2.jpg"]);
    expect(form.get("user")).toBe("mintAAA");
    expect(form.get("platform[]")).toBe("tiktok");
    expect(form.get("title")).toBe("Carousel");
    expect(form.get("description")).toBe("desc");
    expect(form.get("tiktok_title")).toBe("TikTok caption");
    expect(form.get("post_mode")).toBe("DIRECT_POST");
    expect(form.get("privacy_level")).toBe("PUBLIC_TO_EVERYONE");
    expect(form.get("auto_add_music")).toBe("true");
    expect(form.get("disable_comment")).toBe("false");
    expect(form.get("brand_content_toggle")).toBe("false");
    expect(form.get("brand_organic_toggle")).toBe("false");
    expect(form.get("photo_cover_index")).toBe("1");
  });

  it("omits TikTok knobs it wasn't given (other platforms ignore them)", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadPhotos({
      username: "mintAAA",
      platforms: ["instagram"],
      photoUrls: ["https://a/img1.jpg"],
      title: "IG post",
    });

    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(form.get("tiktok_title")).toBeNull();
    expect(form.get("post_mode")).toBeNull();
    expect(form.get("auto_add_music")).toBeNull();
    expect(form.get("photo_cover_index")).toBeNull();
    expect(form.get("title")).toBe("IG post");
  });

  it("MEDIA_UPLOAD (trending-audio draft) drops title/caption/privacy knobs the API ignores", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadPhotos({
      username: "mintAAA",
      platforms: ["tiktok"],
      photoUrls: ["https://a/img1.jpg", "https://a/img2.jpg"],
      title: "Caption",
      description: "desc",
      tiktokTitle: "TT caption",
      postMode: "MEDIA_UPLOAD",
      privacyLevel: "SELF_ONLY",
      autoAddMusic: true,
      disableComment: true,
      brandContentToggle: true,
      brandOrganicToggle: true,
      photoCoverIndex: 0,
    });

    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(form.get("post_mode")).toBe("MEDIA_UPLOAD");
    expect(form.get("auto_add_music")).toBe("true");
    // Draft mode → the operator finishes editing in-app; no metadata is sent.
    expect(form.get("title")).toBeNull();
    expect(form.get("description")).toBeNull();
    expect(form.get("tiktok_title")).toBeNull();
    expect(form.get("privacy_level")).toBeNull();
    expect(form.get("disable_comment")).toBeNull();
    expect(form.get("brand_content_toggle")).toBeNull();
    expect(form.get("brand_organic_toggle")).toBeNull();
    expect(form.get("photo_cover_index")).toBeNull();
    // The ordered photos still go.
    expect(form.getAll("photos[]")).toEqual(["https://a/img1.jpg", "https://a/img2.jpg"]);
  });

  it("DIRECT_POST keeps metadata but omits an unset Instagram media_type", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadPhotos({
      username: "mintAAA",
      platforms: ["tiktok"],
      photoUrls: ["https://a/img1.jpg"],
      title: "Carousel",
      postMode: "DIRECT_POST",
      privacyLevel: "PUBLIC_TO_EVERYONE",
    });

    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(form.get("post_mode")).toBe("DIRECT_POST");
    expect(form.get("title")).toBe("Carousel");
    expect(form.get("privacy_level")).toBe("PUBLIC_TO_EVERYONE");
    expect(form.get("media_type")).toBeNull();
  });

  it("forwards Instagram media_type (IMAGE) when provided", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(SUCCESS_BODY), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadPhotos({
      username: "mintAAA",
      platforms: ["instagram", "tiktok"],
      photoUrls: ["https://a/img1.jpg"],
      title: "IG carousel",
      postMode: "DIRECT_POST",
      instagramMediaType: "IMAGE",
    });

    const [, init] = fetchMock.mock.calls[0];
    const form = init?.body as FormData;
    expect(form.get("media_type")).toBe("IMAGE");
    expect(form.get("title")).toBe("IG carousel");
  });
});

// ─── X tweet text on video posts ─────────────────────────────────────────────
describe("uploadVideo — X gets its own tweet text (x_title)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const capture = () => {
    const sent: { form?: FormData } = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: FormData }) => {
      sent.form = init.body;
      return new Response(JSON.stringify({ results: { x: { success: true }, tiktok: { success: true } } }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    return sent;
  };

  it("sends the clip title as x_title for a bare scheduled clip instead of the shared 'New video'", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const sent = capture();
    await uploadVideo({ username: "u", platforms: ["tiktok", "x"], videoUrl: "https://cdn/v.mp4", title: "", xTitle: "Why Anger is Renewable Energy" });
    expect(sent.form!.get("x_title")).toBe("Why Anger is Renewable Energy");
    expect(sent.form!.get("x_long_text_as_post")).toBe("true");
    expect(sent.form!.getAll("platform[]")).toEqual(["tiktok"]);
    expect(postX).toHaveBeenLastCalledWith("u", "Why Anger is Renewable Energy", ["https://cdn/v.mp4"], true);
  });

  it("caps a long caption to X's tweet limit on a word boundary", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const sent = capture();
    const caption = "word ".repeat(120).trim(); // ~600 chars
    await uploadVideo({ username: "u", platforms: ["x"], videoUrl: "https://cdn/v.mp4", title: caption, description: caption });
    expect(sent.form).toBeUndefined(); // X-only posts never call Upload-Post.
    const tweet = vi.mocked(postX).mock.calls.at(-1)![1];
    expect(tweet.length).toBeLessThanOrEqual(275);
    expect(tweet.endsWith("…")).toBe(true);
    expect(tweet).not.toMatch(/wor…$/);
  });

  it("sends no X fields when X isn't a target", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "k");
    const sent = capture();
    await uploadVideo({ username: "u", platforms: ["tiktok"], videoUrl: "https://cdn/v.mp4", title: "hi", xTitle: "hi" });
    expect(sent.form!.get("x_title")).toBeNull();
  });

  it("xTweetText leaves short text untouched", () => {
    expect(xTweetText("  hello  ")).toBe("hello");
    expect(xTweetText(undefined)).toBe("");
  });
});

describe("direct X connection status", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("exposes account identity without tokens when Upload-Post is absent", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", ""); vi.mocked(xConfigured).mockReturnValue(true);
    vi.mocked(readX).mockResolvedValue({ id: "42", handle: "owner", displayName: "Owner", access_token: "secret-access", refresh_token: "secret-refresh", expiresAt: 123 });
    const profile = await getProfile("agent"); expect(profile.connected.x).toEqual({ id: "42", handle: "owner", displayName: "Owner" });
    expect(JSON.stringify(profile)).not.toContain("secret"); expect(JSON.stringify(profile)).not.toContain("expiresAt");
  });
});
