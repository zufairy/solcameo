import type { Metadata } from "next";
import { HomeDashboard } from "@/components/home/home-dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Drop a video, get clips, and see everything your agents have generated.",
  // Logged-in dashboard — keep it from competing with `/` for brand queries.
  robots: { index: false, follow: true },
};

export default function HomePage() {
  return <HomeDashboard />;
}
