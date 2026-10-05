import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MOCK_INFLUENCERS } from "@/lib/mock-data";
import type { UserInvestment } from "@/lib/types";
import Link from "next/link";

interface InvestmentRowProps {
  investment: UserInvestment;
}

export function InvestmentRow({ investment }: InvestmentRowProps) {
  const influencer = MOCK_INFLUENCERS.find(
    (i) => i.id === investment.influencerId
  );
  if (!influencer) return null;

  const pnl = investment.currentValue - investment.shares * investment.avgBuyPrice;
  const pnlPct =
    ((investment.currentValue - investment.shares * investment.avgBuyPrice) /
      (investment.shares * investment.avgBuyPrice)) *
    100;

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      <Avatar className="size-10">
        <AvatarImage src={influencer.avatarUrl} alt={influencer.name} />
        <AvatarFallback>{influencer.name[0]}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{influencer.name}</p>
        <p className="text-xs text-muted-foreground">
          {investment.shares} shares @ ${investment.avgBuyPrice.toFixed(2)} avg
        </p>
      </div>

      <div className="text-right">
        <p className="font-mono font-semibold">
          ${investment.currentValue.toLocaleString()}
        </p>
        <p
          className={`text-xs font-mono ${
            pnl >= 0 ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(0)} ({pnlPct.toFixed(1)}%)
        </p>
      </div>

      <div className="text-right hidden sm:block">
        <p className="text-xs text-muted-foreground">Earned</p>
        <p className="font-mono text-sm text-emerald-400">
          +${investment.totalEarned.toLocaleString()}
        </p>
      </div>

      <Button render={<Link href={`/market/${investment.influencerId}`} />} variant="ghost" size="sm">
        View
      </Button>
    </div>
  );
}
