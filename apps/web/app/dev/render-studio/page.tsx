"use client";

// Dev harness for the Render Studio tab (the real one lives in the builder's
// AI Clipper workspace). Hidden in production.
import { notFound } from "next/navigation";
import RenderStudioTab from "@/components/builder/render-studio/RenderStudioTab";

export default function RenderStudioDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="h-[calc(100vh-64px)] min-h-[640px]">
      <RenderStudioTab mintAddress="dev-render-studio" agentName="Nova" />
    </div>
  );
}
