"use client";

import { ErrorState } from "@/components/error/error-state";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="bg-black min-h-screen">
        <ErrorState error={error} onRetry={reset} showHome />
      </body>
    </html>
  );
}
