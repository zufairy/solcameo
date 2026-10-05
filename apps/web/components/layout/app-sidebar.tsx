"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Sparkles, LayoutGrid, Megaphone, Wallet, MessageSquare, BotMessageSquare } from "lucide-react";

const NAV_ITEMS = [
  { label: "Market", href: "/market", icon: LayoutGrid },
  { label: "Workers", href: "/workers", icon: BotMessageSquare },
  { label: "Studio", href: "/studio", icon: Sparkles },
  { label: "Builder", href: "/studio/build", icon: MessageSquare },
  { label: "Stage", href: "/stage", icon: Megaphone },
  { label: "Wallet", href: "/wallet", icon: Wallet },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Image
            src="/vello-logo.svg"
            alt="Vello"
            width={32}
            height={32}
            className="shrink-0"
          />
          <div>
            <span className="text-xl font-black tracking-tight bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              VELLO
            </span>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
              AI Influencer Protocol
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
                const isActive = label === "Builder"
                  ? pathname.startsWith("/studio/build")
                  : label === "Studio"
                  ? pathname.startsWith("/studio") && !pathname.startsWith("/studio/build")
                  : label === "Workers"
                  ? pathname.startsWith("/workers")
                  : pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={isActive}
                      className="gap-3"
                    >
                      <Icon className="size-4" />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">v2.0 · Devnet</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400">
            BETA
          </Badge>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
