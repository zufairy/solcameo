import { describe, it, expect } from "vitest";
import {
  postIdentityKey,
  hasRealPost,
  submissionMatchesIncomingPost,
  decideSubmission,
  type SubmissionIdentityRow,
} from "./submissionIdentity";

describe("postIdentityKey", () => {
  it("prefers uploadPostRequestId, then platformPostId, then postUrl", () => {
    expect(postIdentityKey({ uploadPostRequestId: "req", platformPostId: "pid", postUrl: "url" })).toBe("req");
    expect(postIdentityKey({ platformPostId: "pid", postUrl: "url" })).toBe("pid");
    expect(postIdentityKey({ postUrl: "url" })).toBe("url");
  });

  it("is null for a bare join (no identity) and treats whitespace/empty as absent", () => {
    expect(postIdentityKey({})).toBeNull();
    expect(postIdentityKey({ uploadPostRequestId: "", platformPostId: "  ", postUrl: null })).toBeNull();
    expect(hasRealPost({})).toBe(false);
    expect(hasRealPost({ platformPostId: "pid" })).toBe(true);
  });
});

describe("submissionMatchesIncomingPost", () => {
  it("matches on any shared non-empty identity field", () => {
    expect(submissionMatchesIncomingPost({ uploadPostRequestId: "r1" }, { uploadPostRequestId: "r1" })).toBe(true);
    expect(submissionMatchesIncomingPost({ platformPostId: "p1" }, { platformPostId: "p1" })).toBe(true);
    expect(submissionMatchesIncomingPost({ postUrl: "u1" }, { postUrl: "u1" })).toBe(true);
    // shared platformPostId even though requestIds differ → same post
    expect(
      submissionMatchesIncomingPost(
        { uploadPostRequestId: "rA", platformPostId: "p1" },
        { uploadPostRequestId: "rB", platformPostId: "p1" },
      ),
    ).toBe(true);
  });

  it("does not match different posts, and never matches on empty", () => {
    expect(submissionMatchesIncomingPost({ uploadPostRequestId: "r1" }, { uploadPostRequestId: "r2" })).toBe(false);
    expect(submissionMatchesIncomingPost({ platformPostId: "p1" }, { postUrl: "u1" })).toBe(false);
    // two rows that both merely LACK a field must not collide
    expect(submissionMatchesIncomingPost({ postUrl: "" }, { postUrl: "" })).toBe(false);
    expect(submissionMatchesIncomingPost({}, {})).toBe(false);
  });
});

describe("decideSubmission", () => {
  const row = (over: Partial<SubmissionIdentityRow> & { _id: string; status: string }): SubmissionIdentityRow =>
    ({ ...over });

  it("bare join with no existing rows → create-pending", () => {
    expect(decideSubmission([], {})).toEqual({ action: "create-pending" });
  });

  it("bare join with an existing pending row → reuse-pending (no row spam)", () => {
    const rows = [row({ _id: "p", status: "pending" })];
    expect(decideSubmission(rows, {})).toEqual({ action: "reuse-pending", id: "p" });
  });

  it("first real post with no rows → create-new (post #1 is its own row)", () => {
    expect(decideSubmission([], { uploadPostRequestId: "r1" })).toEqual({ action: "create-new" });
  });

  it("first real post when a pending join exists → attach-to-pending", () => {
    const rows = [row({ _id: "p", status: "pending" })];
    expect(decideSubmission(rows, { platformPostId: "p1" })).toEqual({ action: "attach-to-pending", id: "p" });
  });

  it("re-send of the SAME post → patch-duplicate (no duplicate row)", () => {
    const rows = [row({ _id: "s1", status: "submitted", uploadPostRequestId: "r1" })];
    expect(decideSubmission(rows, { uploadPostRequestId: "r1" })).toEqual({ action: "patch-duplicate", id: "s1" });
  });

  it("two DIFFERENT posts → the second resolves to create-new (its own submission)", () => {
    const rows = [row({ _id: "s1", status: "submitted", uploadPostRequestId: "r1" })];
    // post #2 has a different id and no pending row remains → new row
    expect(decideSubmission(rows, { uploadPostRequestId: "r2" })).toEqual({ action: "create-new" });
  });

  it("a SETTLED post #1 does not block post #2 (still create-new)", () => {
    const rows = [row({ _id: "s1", status: "verified", uploadPostRequestId: "r1", postUrl: "u1" })];
    expect(decideSubmission(rows, { platformPostId: "p2" })).toEqual({ action: "create-new" });
  });

  it("a settled post is still a valid dedupe target for its own re-send", () => {
    const rows = [row({ _id: "s1", status: "verified", platformPostId: "p1" })];
    expect(decideSubmission(rows, { platformPostId: "p1" })).toEqual({ action: "patch-duplicate", id: "s1" });
  });

  it("full lifecycle: join → post#1 attaches → post#2 new → post#1 re-send dedupes", () => {
    // join
    let rows: SubmissionIdentityRow[] = [];
    expect(decideSubmission(rows, {})).toEqual({ action: "create-pending" });
    rows = [row({ _id: "p", status: "pending" })];
    // post #1 fills the pending join
    expect(decideSubmission(rows, { uploadPostRequestId: "r1" })).toEqual({ action: "attach-to-pending", id: "p" });
    rows = [row({ _id: "p", status: "submitted", uploadPostRequestId: "r1" })];
    // post #2 → its own new row
    expect(decideSubmission(rows, { uploadPostRequestId: "r2" })).toEqual({ action: "create-new" });
    rows = [
      row({ _id: "p", status: "submitted", uploadPostRequestId: "r1" }),
      row({ _id: "s2", status: "submitted", uploadPostRequestId: "r2" }),
    ];
    // re-send of post #1 → dedupes to its row
    expect(decideSubmission(rows, { uploadPostRequestId: "r1" })).toEqual({ action: "patch-duplicate", id: "p" });
  });
});
