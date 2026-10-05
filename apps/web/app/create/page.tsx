import { dbcReadiness } from "@/lib/server/meteoraLaunch";
import { higgsfieldConfigured } from "@/lib/server/higgsfield";
import type { Metadata } from "next";
import { InfluencerOnboarding } from "@/components/solcameo/InfluencerOnboarding";
export const metadata: Metadata = { title: "Create AI Influencer", description: "Build your AI character, generate its portrait, and create its coin." };
export default function CreatePage() { return <InfluencerOnboarding generationConfigured={higgsfieldConfigured()} liveReadiness={dbcReadiness()} />; }
