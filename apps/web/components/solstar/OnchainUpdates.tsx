"use client";
import { useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PublicKey } from "@solana/web3.js";

/** One shared subscription; mounted pages retain polling as reconnect fallback. */
export function OnchainUpdates() {
  const { connection } = useConnection();
  const rows = useQuery(api.solstarMarket.listMarket, { sort: "new", network: "devnet", liveOnly: true });
  const pools = (rows ?? []).map(row => row.dbcPool).filter(Boolean).slice(0, 30).join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const notify = () => {
      if (stopped || timer || document.hidden) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!stopped) window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      }, 750);
    };
    const subscriptions = pools.split(",").filter(Boolean).map(pool => connection.onLogs(new PublicKey(pool), result => {
      if (!result.err) notify();
    }, "confirmed"));
    window.addEventListener("focus", notify);
    return () => { stopped = true; if (timer) clearTimeout(timer); subscriptions.forEach(subscription => { void connection.removeOnLogsListener(subscription); }); window.removeEventListener("focus", notify); };
  }, [connection, pools]);
  return null;
}
