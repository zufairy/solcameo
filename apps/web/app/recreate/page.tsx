import { Suspense } from "react";
import { RecreateApp } from "@/components/recreate-app/RecreateApp";

// Suspense: RecreateApp reads useSearchParams (the Ads Library ?src= hand-off),
// which requires a boundary for static/streamed rendering.
export default function RecreatePage() {
  return (
    <Suspense>
      <RecreateApp />
    </Suspense>
  );
}
