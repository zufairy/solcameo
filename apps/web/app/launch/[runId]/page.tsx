import type { Metadata } from "next";
import { LaunchProgress } from "@/components/launch/LaunchProgress";

export const metadata: Metadata = {
  title: "Launching your agent · Vello",
  robots: { index: false, follow: false },
};

export default async function LaunchRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <LaunchProgress runId={runId} />;
}
