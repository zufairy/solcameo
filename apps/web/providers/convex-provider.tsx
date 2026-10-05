"use client";

import { useEffect, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";
const missingConvexUrl = convexUrl.length === 0;

function ConfigWarning() {
  if (!missingConvexUrl) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[100] border border-amber-500/40 bg-amber-500/12 px-3 py-2 text-[11px] text-amber-100 shadow-lg backdrop-blur-sm sm:left-auto sm:right-3 sm:max-w-sm">
      Missing <code>NEXT_PUBLIC_CONVEX_URL</code>. Convex queries will not load until Railway is rebuilt with the production Convex URL.
    </div>
  );
}

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const convex = useMemo(() => {
    const url = convexUrl || "https://placeholder.convex.cloud";
    return new ConvexReactClient(url);
  }, []);

  useEffect(() => {
    if (missingConvexUrl) {
      console.error(
        "Missing NEXT_PUBLIC_CONVEX_URL. Set it in Railway before building so live Convex data can load.",
      );
    }
  }, []);

  return (
    <>
      <ConvexProvider client={convex}>{children}</ConvexProvider>
      <ConfigWarning />
    </>
  );
}
