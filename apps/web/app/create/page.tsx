import { dbcReadiness } from "@/lib/server/meteoraLaunch";
import { higgsfieldConfigured } from "@/lib/server/higgsfield";
import type { Metadata } from "next";
import { InfluencerOnboarding } from "@/components/solcameo/InfluencerOnboarding";
import { connection } from "next/server";
export const metadata: Metadata = { title: "Create AI Influencer", description: "Build your AI character, generate its portrait, and create its coin." };
export default async function CreatePage() {
  // Runtime credentials must never be frozen into the prerendered Docker build.
  await connection();
  return <InfluencerOnboarding generationConfigured={higgsfieldConfigured()} liveReadiness={dbcReadiness()} />;
}
