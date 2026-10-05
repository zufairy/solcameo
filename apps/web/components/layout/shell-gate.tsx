"use client";

import { usePathname } from "next/navigation";
import { legacyUiEnabled } from "@/lib/flags";
import { shouldUseShell } from "@/lib/solstar/navVisibility";
import { SolstarShell } from "./solstar-shell";

/** Client wrapper so the (server) root layout can pick shell vs full-screen by pathname. */
export function ShellGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (shouldUseShell(pathname, legacyUiEnabled())) {
    return <SolstarShell>{children}</SolstarShell>;
  }
  return <main className="flex-1">{children}</main>;
}
