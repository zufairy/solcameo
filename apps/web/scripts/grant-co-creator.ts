/** Grant co-creator access to the "Dr Roket" agent for digitalteamvid.3@gmail.com's wallet.
 *  Run: npx tsx scripts/grant-co-creator.ts */
import { config } from "dotenv";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: resolve(__dirname, "../.env.local") });

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const SECRET = process.env.INTERNAL_CRON_SECRET!;

// Step 1: Find Dr Roket's mint address by name
async function findDrRoket() {
  const agents = await convex.query(api.influencers.listAll, {});
  const found = agents.filter((a) =>
    a.name.toLowerCase().includes("dr roket") ||
    a.name.toLowerCase().includes("dr. roket") ||
    a.name.toLowerCase().includes("roket")
  );
  console.log("\n=== Agents matching 'roket' ===");
  for (const a of found) {
    console.log(`  name: ${a.name}`);
    console.log(`  mintAddress: ${a.mintAddress}`);
    console.log(`  creatorWallet: ${a.creatorWallet}`);
    console.log(`  coCreatorWallets: ${JSON.stringify(a.coCreatorWallets ?? [])}`);
    console.log();
  }
  return found;
}

// Step 2: Find the wallet linked to digitalteamvid.3@gmail.com
async function findDigitalTeamWallet() {
  const wallets = await convex.query(api.users.walletsForEmail, {
    email: "digitalteamvid.3@gmail.com",
  });
  console.log("=== Wallets for digitalteamvid.3@gmail.com ===");
  console.log(wallets.length ? wallets : "  (no wallets found — user may not have signed up yet)");
  return wallets;
}

(async () => {
  const [agents, wallets] = await Promise.all([findDrRoket(), findDigitalTeamWallet()]);

  if (agents.length === 0) {
    console.error("\n❌  No agent matching 'Dr Roket' found. Check the name spelling in the Convex dashboard.");
    process.exit(1);
  }

  if (wallets.length === 0) {
    console.error("\n❌  digitalteamvid.3@gmail.com has no linked wallet yet.");
    console.error("    They need to sign up on Vello and link a wallet first, then re-run this script.");
    process.exit(1);
  }

  // Grant access for every matched agent + every linked wallet
  for (const agent of agents) {
    for (const wallet of wallets) {
      console.log(`\n→ Granting co-creator access to "${agent.name}" (${agent.mintAddress}) for wallet ${wallet}...`);
      const result = await convex.mutation(api.influencers.adminAddCoCreator, {
        mintAddress: agent.mintAddress,
        coCreatorWallet: wallet,
        action: "add",
        authSecret: SECRET,
      });
      console.log("  Result:", JSON.stringify(result));
    }
  }

  console.log("\n✅  Done! digitalteamvid.3@gmail.com can now manage Dr Roket.");
})();
