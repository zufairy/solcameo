import type { Metadata } from "next";
import { ExplorePage } from "@/components/explore/explore-page";
import references from "@/lib/explore/references.json";
export const metadata: Metadata = { title: "Explore motion references | Solcameo", description: "Discover video references and recreate their motion with your AI influencer using Higgsfield Genjutsu." };
export default function Page() { return <ExplorePage initial={references} />; }
