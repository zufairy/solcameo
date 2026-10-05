/** Pure mapping from a `solstarFeed.listFeed` row to a UI view model. */

export type FeedRowInput = {
  id: string;
  kind: "chat" | "event";
  eventType?: "character_created" | "trade" | "follow";
  wallet?: string;
  body: string;
  characterId?: string;
  side?: "buy" | "sell";
  network: "paper" | "devnet" | "mainnet";
  createdAt: number;
};

type Common = { id: string; body: string; createdAt: number };
export type FeedView =
  | (Common & { kind: "chat"; author: string; initials: string })
  | (Common & { kind: "character_created"; characterId?: string })
  | (Common & { kind: "trade"; side: "buy" | "sell" | null; characterId?: string; simulated: boolean })
  | (Common & { kind: "follow"; characterId?: string });

export function initialsOf(wallet?: string): string {
  const letters = (wallet ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
}

/** Returns null for malformed rows so the UI can skip them. */
export function toFeedView(row: FeedRowInput): FeedView | null {
  if (typeof row.body !== "string" || row.body.length === 0) return null;
  const c: Common = { id: row.id, body: row.body, createdAt: row.createdAt };
  if (row.kind === "chat") {
    return { ...c, kind: "chat", author: row.wallet || "Anonymous", initials: initialsOf(row.wallet) };
  }
  if (row.kind !== "event") return null;
  switch (row.eventType) {
    case "character_created":
      return { ...c, kind: "character_created", characterId: row.characterId };
    case "trade":
      return { ...c, kind: "trade", side: row.side === "buy" || row.side === "sell" ? row.side : null, characterId: row.characterId, simulated: row.network === "paper" };
    case "follow":
      return { ...c, kind: "follow", characterId: row.characterId };
    default:
      return null;
  }
}

export const CHAT_MAX = 280;

/** Maps POST /api/solstar/feed failures to inline copy. */
export function chatErrorMessage(status: number, code?: string): string {
  if (status === 429 || code === "rate_limited") return "You're sending messages too fast. Wait a few seconds.";
  if (status === 409 || code === "duplicate_message") return "You already sent that.";
  if (code === "invalid_body") return "Message can't be empty or longer than 280 characters.";
  if (status === 401) return "Sign-in expired. Reconnect your wallet to chat.";
  return "Couldn't send. Try again.";
}

/** Chips/marquee: fewer items than this render statically (no gappy loop). */
export const MARQUEE_MIN_ITEMS = 6;
