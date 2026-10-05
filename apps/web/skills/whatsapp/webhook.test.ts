// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAndParse, verifySignature, type WebhookEnv } from "./webhook";

const APP_SECRET = "test-app-secret";

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const SAMPLE_PAYLOAD = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              { from: "60123456789", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "hi" } },
            ],
          },
        },
      ],
    },
  ],
});

describe("verifySignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifySignature(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD), APP_SECRET)).toBe(true);
  });

  it("rejects a body signed with the wrong secret", () => {
    expect(verifySignature(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD, "attacker-secret"), APP_SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const goodSig = sign(SAMPLE_PAYLOAD);
    const tampered = SAMPLE_PAYLOAD.replace("hi", "send money");
    expect(verifySignature(tampered, goodSig, APP_SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature(SAMPLE_PAYLOAD, undefined, APP_SECRET)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(verifySignature(SAMPLE_PAYLOAD, "not-a-sha256-header", APP_SECRET)).toBe(false);
  });

  it("fails closed when no app secret is configured", () => {
    expect(verifySignature(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD), undefined)).toBe(false);
  });
});

describe("verifyAndParse", () => {
  const env: WebhookEnv = { appSecret: APP_SECRET, verifyToken: "vt" };

  it("returns parsed messages for a valid signature", () => {
    const result = verifyAndParse(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD), env);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ from: "60123456789", text: "hi", type: "text" });
  });

  it("returns null (and does not parse) for an invalid signature", () => {
    const result = verifyAndParse(SAMPLE_PAYLOAD, "sha256=deadbeef", env);
    expect(result).toBeNull();
  });
});
