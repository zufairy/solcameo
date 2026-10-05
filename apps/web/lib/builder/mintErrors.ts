/**
 * Classify a raw mint-flow error into a small, UI-friendly shape. Pure — no React
 * imports — so it's unit-testable in isolation and reusable by any mint surface.
 *
 * `kind` drives presentation (declined → calm amber "tap to retry"; everything
 * else → red), and `message` is the copy to show. Declined always gets the calm
 * canonical line (a raw wallet-provider string like "User rejected the request."
 * reads as scarier than it is); funds/network/server keep the specific message
 * when one is present because it carries useful detail, falling back to a clear
 * default otherwise.
 */
export type MintErrorKind = "declined" | "network" | "funds" | "server";

export interface ClassifiedMintError {
  kind: MintErrorKind;
  message: string;
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

function errorCode(err: unknown): unknown {
  if (err && typeof err === "object" && "code" in err) return (err as { code?: unknown }).code;
  return undefined;
}

export function classifyMintError(err: unknown): ClassifiedMintError {
  const msg = rawMessage(err).trim();
  const low = msg.toLowerCase();
  const code = errorCode(err);

  // Wallet-provider user rejection: EIP-1193-style 4001, or any decline/cancel text.
  if (
    code === 4001 ||
    code === "4001" ||
    /\b4001\b|reject|declin|denied|cancel|dismiss|user closed|closed the|not approved/.test(low)
  ) {
    return { kind: "declined", message: "You cancelled the wallet prompt. Tap to try again." };
  }

  if (/insufficient|not enough|add funds|too little|balance too low/.test(low)) {
    return { kind: "funds", message: msg || "Your wallet doesn't have enough to cover the mint." };
  }

  if (
    /block ?height exceeded|expired|blockhash not found|timed? ?out|timeout|network|failed to fetch|fetch failed|rpc|\b50[234]\b|econn|socket hang/.test(
      low,
    )
  ) {
    return { kind: "network", message: msg || "Network hiccup — please try again." };
  }

  return { kind: "server", message: msg || "Something went wrong. Please try again." };
}
