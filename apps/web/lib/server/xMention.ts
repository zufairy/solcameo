import type { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/** "@handle" for an X account if the handle is valid, else "". */
export function xHandle(account: { handle?: string; id?: string } | null | undefined): string {
  const raw = (account?.handle || account?.id || "").trim().replace(/^@+/, "");
  return /^\w{1,15}$/.test(raw) ? `@${raw}` : "";
}

/** The connected X handle of an agent document (connectedSocialAccounts.x, or the legacy twitter key). */
export function agentXHandle(agent: { connectedSocialAccounts?: Record<string, { handle?: string; id?: string } | undefined> } | null | undefined): string {
  const accounts = agent?.connectedSocialAccounts;
  return xHandle(accounts?.x ?? accounts?.twitter);
}

/** X handles to @mention for these agents. Skips agents with no connected X and the posting account itself. */
export async function xMentions(convex: ConvexHttpClient, authSecret: string, mints: (string | undefined)[], skip = ""): Promise<string[]> {
  const out: string[] = [];
  for (const mintAddress of [...new Set(mints.filter((m): m is string => !!m))].slice(0, 5)) {
    const handle = agentXHandle(await convex.query(api.influencers.getByMintServer, { authSecret, mintAddress }));
    if (handle && handle.toLowerCase() !== skip.toLowerCase() && !out.includes(handle)) out.push(handle);
  }
  return out;
}

/** Appends mentions that are not already in the caption. */
export function withMentions(caption: string, handles: string[]): string {
  const missing = handles.filter((h) => !caption.toLowerCase().includes(h.toLowerCase()));
  return missing.length ? `${caption.trimEnd()} ${missing.join(" ")}` : caption;
}
