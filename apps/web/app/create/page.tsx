import { dbcReadiness } from "@/lib/server/meteoraLaunch";
import { higgsfieldConfigured } from "@/lib/server/higgsfield";
import { InfluencerOnboarding } from "@/components/solcameo/InfluencerOnboarding";
import { connection } from "next/server";
export default async function CreatePage() {
  // Runtime credentials must never be frozen into the prerendered Docker build.
  await connection();
  return <InfluencerOnboarding generationConfigured={higgsfieldConfigured()} liveReadiness={dbcReadiness()} />;
}
