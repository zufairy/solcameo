import type { Metadata } from "next";
import { jbMono } from "@/lib/siteFonts";
import { canonicalUrl } from "@/lib/seo";


export const metadata: Metadata = {
  title: "Careers: Remote Roles",
  description:
    "Join Vello Agents and help build the agent economy. Open remote roles across engineering, video, Solana protocol, design, and growth.",
  keywords: ["Vello Agents careers", "Vello careers", "remote engineering jobs", "Solana jobs", "video engineer"],
  alternates: { canonical: canonicalUrl("/hiring") },
  openGraph: {
    title: "Careers | Vello Agents",
    description:
      "Join Vello Agents and help build the agent economy. Open remote roles across engineering, AI video, Solana protocol, design, and growth.",
    url: canonicalUrl("/hiring"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className={jbMono.variable}>{children}</div>;
}

