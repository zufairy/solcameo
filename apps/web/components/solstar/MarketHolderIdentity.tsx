"use client";
/* eslint-disable @next/next/no-img-element -- public user avatars */
import { useState } from "react";

export function MarketHolderIdentity({ wallet, image, name }: { wallet: string; image?: string; name?: string }) {
  const [failed, setFailed] = useState<string>();
  const custom = image && /^https:\/\//.test(image) && failed !== image;
  return <span className="inline-flex min-w-0 items-center gap-2" title={name ? `${name} · ${wallet}` : wallet}>
    <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
      <img src={custom ? image : "/brand/solcameo-mark.png"} alt="" loading="lazy" onError={custom ? () => setFailed(image) : undefined} className={custom ? "size-full object-cover" : "size-5 object-contain"} />
    </span>
    <span className="truncate">{wallet.length > 16 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet}</span>
  </span>;
}
