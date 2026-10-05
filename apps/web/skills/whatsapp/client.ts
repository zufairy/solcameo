/**
 * WhatsApp Business (Meta Cloud API / 360dialog) wire types + a thin send client.
 *
 * Only the subset of the Meta webhook payload we actually consume is modeled.
 * The shapes follow the Meta Cloud API "messages" webhook and the Cloud API
 * send-message endpoint.
 */

/** A single inbound message after parsing the webhook envelope. */
export interface IncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  text: string;
  type: string;
}

/** Raw Meta webhook payload (the envelope we receive on POST). */
export interface WebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
        statuses?: Array<{ id: string; status: string }>;
      };
    }>;
  }>;
}

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/** Config for sending a reply back through the Cloud API. */
export interface SendConfig {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Send a plain-text reply to a WhatsApp user via the Meta Cloud API.
 * Returns the provider message id on success; throws on a non-2xx response.
 */
export async function sendText(
  config: SendConfig,
  to: string,
  body: string
): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { messages?: Array<{ id: string }> };
  return data.messages?.[0]?.id ?? "";
}
