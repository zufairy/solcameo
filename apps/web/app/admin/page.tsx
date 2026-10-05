"use client";

import { OverviewSection } from "@/components/admin/overview-section";
import { AnalyticsSection } from "@/components/admin/analytics-section";

export default function AdminOverviewPage() {
  return (
    <div className="space-y-10">
      <OverviewSection />
      <AnalyticsSection />
    </div>
  );
}
