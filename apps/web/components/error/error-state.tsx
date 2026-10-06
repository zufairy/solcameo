"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

interface ErrorStateProps {
  /** Short, human-readable headline. */
  title?: string;
  /** Optional sub-message. Falls back to the error message in dev. */
  description?: string;
  /** The caught error (used to surface a digest/message in non-prod). */
  error?: Error & { digest?: string };
  /** Retry callback — wired to Next.js `reset()` at the route level. */
  onRetry?: () => void;
  /** Show a "Back to home" link. */
  showHome?: boolean;
  className?: string;
  /** Compact variant for in-page panel boundaries. */
  compact?: boolean;
}

/**
 * Shared error presentation used by every route-level `error.tsx`, the global
 * error handler, and the in-page <ErrorBoundary>. Keeps the recovery UX
 * consistent across the whole app so a crash never white-screens the user.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  error,
  onRetry,
  showHome = false,
  className,
  compact = false,
}: ErrorStateProps) {
  // Only leak raw error text outside production — keeps prod UX clean while
  // staying debuggable locally.
  const isDev = process.env.NODE_ENV !== "production";
  const detail = description ?? (isDev ? error?.message : undefined);
  // Production keeps the headline friendly, but the short technical reason stays one click away so a crash can be reported and fixed.
  const technical = error ? [error.name, error.message].filter(Boolean).join(": ").slice(0, 300) + (error.digest ? ` (digest ${error.digest})` : "") : "";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6" : "gap-4 p-10 min-h-[40vh]",
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-red-500/10 text-red-400",
          compact ? "size-9" : "size-12",
        )}
      >
        <AlertTriangle className={compact ? "size-5" : "size-6"} />
      </div>
      <div className="space-y-1">
        <h2 className={cn("font-semibold text-zinc-100", compact ? "text-sm" : "text-lg")}>
          {title}
        </h2>
        {detail && (
          <p className={cn("text-zinc-400 max-w-md", compact ? "text-xs" : "text-sm")}>
            {detail}
          </p>
        )}
        {error?.digest && (
          <p className="text-[10px] font-mono text-zinc-600">ref: {error.digest}</p>
        )}
        {technical && (
          <details className="mx-auto max-w-md pt-1 text-left">
            <summary className="cursor-pointer text-center text-[11px] text-zinc-600 hover:text-zinc-400">Technical details</summary>
            <p className="mt-1 break-words rounded-md bg-black/30 p-2 font-mono text-[10px] leading-4 text-zinc-500">{technical}</p>
          </details>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="secondary" size={compact ? "sm" : "default"} onClick={onRetry}>
            <RotateCcw className="size-4 mr-1.5" />
            Try again
          </Button>
        )}
        {showHome && (
          <Button variant="ghost" size={compact ? "sm" : "default"} render={<Link href="/" />}>
            <Home className="size-4 mr-1.5" />
            Home
          </Button>
        )}
      </div>
    </div>
  );
}
