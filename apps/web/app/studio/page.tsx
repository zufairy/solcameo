"use client";

import { MyAgentsDashboard } from "@/components/studio/MyAgentsDashboard";

// The dashboard lives in components/studio so /control can embed the exact
// same view as its home screen.
export default function StudioPage() {
  return <MyAgentsDashboard />;
}
