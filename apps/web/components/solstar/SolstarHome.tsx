"use client";

import { useSyncExternalStore } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HomeCallouts } from "./HomeCallouts";
import { LaunchpadFeed } from "./LaunchpadFeed";

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsDesktop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia("(min-width: 1024px)").matches, () => false);
}
export function SolstarHome() {
  const desktop = useIsDesktop();
  return <main className="w-full">
    {desktop ? <div className="grid min-h-[calc(100dvh-136px)] grid-cols-[minmax(0,450px)_minmax(0,1fr)]">
      <section aria-label="Character launchpad feed" className="flex min-w-0 flex-col border-r border-white/[0.09]">
        <LaunchpadFeed />
      </section>
      <section aria-label="Callouts" className="min-w-0 bg-[linear-gradient(110deg,transparent_25%,rgba(110,231,183,0.035))]">
        <HomeCallouts />
      </section>
    </div> : <Tabs defaultValue="feed" className="gap-0">
      <TabsList className="h-12 w-full rounded-none border-b border-white/10 bg-transparent p-1">
        <TabsTrigger value="feed">Characters</TabsTrigger>
        <TabsTrigger value="trending">Callouts</TabsTrigger>
      </TabsList>
      <TabsContent value="feed" className="mt-0"><LaunchpadFeed /></TabsContent>
      <TabsContent value="trending" className="mt-0"><HomeCallouts /></TabsContent>
    </Tabs>}
  </main>;
}
