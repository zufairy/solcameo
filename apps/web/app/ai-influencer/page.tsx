import { pumpReadiness } from "@/lib/server/pumpLaunch";
import { higgsfieldConfigured } from "@/lib/server/higgsfield";
import type { Metadata } from "next";
import { InfluencerOnboarding } from "@/components/solcameo/InfluencerOnboarding";
export const metadata: Metadata = { title: "Create AI Influencer", description: "Build your character, generate its portrait, and create its Solcameo coin." };
export default function AiInfluencerPage() { return <InfluencerOnboarding generationConfigured={higgsfieldConfigured()} liveReadiness={pumpReadiness()} />; }
