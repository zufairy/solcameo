/** One-off: move the 5 agents to asri19271927@gmail.com's wallet.
 *  Run: npx tsx scripts/transfer-agents.ts  (re-run after any snapshot import) */
import { config } from "dotenv";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: resolve(__dirname, "../.env.local") });

const WALLET = "9zt7s2CxSXCp4tKaZ8tufTyqEQduVp1CuLSE4Y6MF7kp"; // asri19271927@gmail.com
const MINTS = [
  "4dPdvJPhaNiy34xiLeE4dDqKwtKY1vR3v4tZyrnR4Bnh", // Arvin Zheng
  "DBNfz3yzAsYMAv76XySnAdayAynXzBNFCCKREwn411E4", // May
  "Hq1PsH4DiFuJU83F43Xqg6bhVCAKsiWk2qZXcJqHqg87", // Morty Smith
  "vello_e8c5dde2_1785999091766",                 // Rick Sanchez
  "vello_293be7bd_1785730429064",                 // Jonas
];

(async () => {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  for (const mintAddress of MINTS) {
    const r = await convex.mutation(api.influencers.adminTransferOwnership, {
      mintAddress, newCreatorWallet: WALLET, authSecret: process.env.INTERNAL_CRON_SECRET!,
    });
    console.log(mintAddress, JSON.stringify(r));
  }

  // mattwillvello@gmail.com
  const WALLET2 = "9XmNmRDkEFCarNVh3nfCXb12MWMQpG1R6CQYXZL9Dooy";
  const MINTS2: string[] = [
    "9x94BztLD8AUdYJC4vesKfnGZTE4UbQyi4hjuYLdJ6M8", // ViralEdge
    "CEoJEu1ZrD7w1gAFM51QJYB4pEFS1vHwji6ctxyfhgt5", // CryptoDaily
    "6Y6cNQkskFRn9FSUhkadTMKQnPySCaRzN6CVkeE6cBJt", // Yumelyn
    "8xxharGjxUJpaojtDghZGvXQUcf6XMooBtKRC9U2BNBe", // Jax Turner
  ];
  for (const mintAddress of MINTS2) {
    const r = await convex.mutation(api.influencers.adminTransferOwnership, {
      mintAddress, newCreatorWallet: WALLET2, authSecret: process.env.INTERNAL_CRON_SECRET!,
    });
    console.log(mintAddress, JSON.stringify(r));
  }
})();
