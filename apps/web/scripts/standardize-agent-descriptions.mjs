import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { formatAgentDescription } from "../lib/agentDescription.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (key) => {
  const line = env.split("\n").find((value) => value.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
};

const url = get("NEXT_PUBLIC_CONVEX_URL");
const authSecret = get("INTERNAL_CRON_SECRET");
if (!url || !authSecret) throw new Error("NEXT_PUBLIC_CONVEX_URL and INTERNAL_CRON_SECRET are required");

const convex = new ConvexHttpClient(url);
const result = await convex.mutation("influencers:standardizeAllDescriptions", { authSecret });
console.log(`Standardized ${result.updated} of ${result.total} agent descriptions.`);

const agents = await convex.query("influencers:listAll", {});
const invalid = agents.filter((agent) =>
  agent.description !== formatAgentDescription(agent) ||
  /[\u2013\u2014]/.test(agent.description) ||
  (agent.description.match(/\./g) ?? []).length !== 2
);
if (invalid.length > 0) {
  for (const agent of invalid) console.error(`${agent.name}: ${agent.description}`);
  throw new Error(`${invalid.length} agent descriptions failed verification`);
}
console.log(`Verified ${agents.length} descriptions against the canonical format.`);
