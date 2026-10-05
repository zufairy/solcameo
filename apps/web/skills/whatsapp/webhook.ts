import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, WebhookPayload } from "./client";

/**
 * Vello WhatsApp webhook handler. Verifies Meta handshake (GET), verifies the
 * X-Hub-Signature-256 HMAC on inbound POSTs, and parses inbound messages.
 */

export interface WebhookEnv {
  appSecret?: string;
  verifyToken: string;
}

export function verifyHandshake(query: Record<string, string>, env: WebhookEnv): { status: number; body: string } {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === env.verifyToken) {
    return { status: 200, body: challenge ?? "" };
  }
  return { status: 403, body: "Forbidden" };
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body.
 *
 * Meta signs the *raw* (pre-JSON-parse) request body with the app secret using
 * HMAC-SHA256 and sends it as `X-Hub-Signature-256: sha256=<hex>`. We must
 * verify this before trusting/processing any inbound payload — otherwise anyone
 * who knows the public webhook URL can POST forged customer messages, which
 * would poison a client's conversation history and learned facts.
 *
 * Fails closed: a missing app secret or missing/malformed header is rejected.
 * Uses a constant-time comparison to avoid leaking the signature via timing.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) {
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const received = Buffer.from(signatureHeader, "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (received.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(received, computed);
}

/**
 * Verify the signature and parse inbound messages in one step. Returns null when
 * the signature is invalid so callers can respond 403 without processing.
 */
export function verifyAndParse(
  rawBody: string,
  signatureHeader: string | undefined,
  env: WebhookEnv,
): IncomingMessage[] | null {
  if (!verifySignature(rawBody, signatureHeader, env.appSecret)) {
    return null;
  }
  const payload = JSON.parse(rawBody) as WebhookPayload;
  return parseInbound(payload);
}

export function parseInbound(payload: WebhookPayload): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const msg of value.messages ?? []) {
        out.push({
          from: msg.from,
          id: msg.id,
          timestamp: msg.timestamp,
          text: msg.text?.body ?? "",
          type: msg.type,
        });
      }
    }
  }
  return out;
}
