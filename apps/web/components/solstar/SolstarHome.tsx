"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Radio, Sprout, ArrowUpRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedPanel } from "./FeedPanel";
import { LaunchpadFeed } from "./LaunchpadFeed";

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsDesktop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia("(min-width: 1024px)").matches, () => false);
}
function PanelHeading({ trending = false }: { trending?: boolean }) {
  const Icon = trending ? Sprout : Radio;
  return <div className="flex h-[58px] items-center gap-2.5 border-b border-white/[0.09] px-5">
    <GripVertical className="size-4 text-zinc-600" />
    <Icon className="size-4 text-zinc-400" />
    <h1 className="text-sm font-semibold text-zinc-200">{trending ? "Callouts" : "Character feed"}</h1>
    {trending ? <Button nativeButton={false} render={<Link href="/market" />} variant="ghost" size="sm" className="ml-auto text-xs text-zinc-500">View market <ArrowUpRight className="size-3" /></Button> : <Badge variant="outline" className="ml-auto gap-1.5 border-emerald-300/15 bg-emerald-300/5 text-[10px] font-normal text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-300" /> LIVE</Badge>}
  </div>;
}
export function SolstarHome() {
  const desktop = useIsDesktop();
  return <main className="w-full">
    {desktop ? <div className="grid min-h-[calc(100dvh-136px)] grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section aria-label="Character launchpad feed" className="flex min-w-0 flex-col border-r border-white/[0.09]">
        <PanelHeading />
        <LaunchpadFeed />
      </section>
      <section aria-label="Callouts" className="min-w-0 bg-[linear-gradient(110deg,transparent_25%,rgba(110,231,183,0.035))]">
        <PanelHeading trending />
        <FeedPanel />
        <p className="border-t border-white/[0.06] px-6 py-4 text-[11px] leading-relaxed text-zinc-500">Meteora DBC launchpad · Confirmed devnet launches and unminted previews are separated. Paper activity is simulated.</p>
      </section>
    </div> : <Tabs defaultValue="feed" className="gap-0">
      <TabsList className="h-12 w-full rounded-none border-b border-white/10 bg-transparent p-1">
        <TabsTrigger value="feed">Characters</TabsTrigger>
        <TabsTrigger value="trending">Callouts</TabsTrigger>
      </TabsList>
      <TabsContent value="feed" className="mt-0"><LaunchpadFeed /></TabsContent>
      <TabsContent value="trending" className="mt-0"><FeedPanel /><p className="px-5 py-4 text-xs text-zinc-500">Community posts and activity · Paper trades are simulated.</p></TabsContent>
    </Tabs>}
  </main>;
}
