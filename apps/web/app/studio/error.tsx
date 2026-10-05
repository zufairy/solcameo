"use client";

import { ErrorState } from "@/components/error/error-state";

export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} onRetry={reset} showHome />;
}
