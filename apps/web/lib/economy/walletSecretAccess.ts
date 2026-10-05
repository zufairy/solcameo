import { decryptWalletSecret } from "../server/walletCrypto";

/** Single seam for reading an agent's signing secret. Stored values may be
 *  encrypted (v1:) or legacy plaintext base64; this returns the raw base64
 *  64-byte secret either way. Use everywhere the agent key is loaded to sign. */
export function readAgentSecret(stored: string): string {
  return decryptWalletSecret(stored);
}
