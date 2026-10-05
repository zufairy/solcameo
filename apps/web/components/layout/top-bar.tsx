"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "./wallet-button";
import { AccountButton } from "./account-button";
import { Separator } from "@/components/ui/separator";

const ROUTE_LABELS: Record<string, string> = {
  "/market": "Market",
  "/studio": "Studio",
  "/studio/build": "Agent Builder",
  "/studio/create": "Create Agent",
  "/stage": "Stage",
  "/stage/create": "New Campaign",
  "/wallet": "Wallet",
};

function getRouteLabel(pathname: string): string {
  // Exact match first
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  // Prefix match for dynamic routes
  for (const [key, label] of Object.entries(ROUTE_LABELS)) {
    if (pathname.startsWith(key + "/")) return label;
  }
  return "Vello";
}

export function TopBar() {
  const pathname = usePathname();
  const label = getRouteLabel(pathname);

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border/60 px-4 bg-background/95 backdrop-blur-sm sticky top-0 z-40">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" className="h-5" />
      <span className="text-sm font-medium text-muted-foreground">{label}</span>

      <div className="flex-1" />

      <Badge
        variant="outline"
        className="text-[10px] font-mono px-2 py-0.5 border-amber-500/40 text-amber-400 bg-amber-500/5"
      >
        ◉ DEVNET
      </Badge>
      <WalletButton />
      <AccountButton />
    </header>
  );
}
