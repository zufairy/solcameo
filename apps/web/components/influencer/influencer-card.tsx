import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { AIInfluencer } from "@/lib/types";

interface InfluencerCardProps {
  influencer: AIInfluencer;
}

export function InfluencerCard({ influencer }: InfluencerCardProps) {
  return (
    <Link href={`/market/${influencer.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarImage src={influencer.avatarUrl} alt={influencer.name} />
              <AvatarFallback>{influencer.name[0]}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold truncate">{influencer.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {influencer.handle}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-3">
          <div className="flex gap-1.5 flex-wrap mb-3">
            <Badge variant="secondary" className="capitalize text-xs">
              {influencer.niche}
            </Badge>
            <Badge variant="outline" className="uppercase text-xs">
              {influencer.language}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {influencer.description}
          </p>
        </CardContent>

        <CardFooter className="border-t border-border pt-3 grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">TVL</p>
            <p className="font-mono font-semibold text-sm">
              ${influencer.tvl.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="size-3" />
              Monthly
            </p>
            <p className="font-mono font-semibold text-sm text-emerald-400">
              ${influencer.monthlyEarnings.toLocaleString()}
            </p>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
