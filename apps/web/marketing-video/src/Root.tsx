import React from "react";
import { Composition } from "remotion";
import { Master } from "./Master";
import { TOTAL_FRAMES } from "./timeline";
import { FPS } from "./theme";
import { AgentLeaderboard, LB_TOTAL, LB_FPS } from "./leaderboard/AgentLeaderboard";
import { TokenizedHarvest } from "./bounty/TokenizedHarvest";
import { BreakpointLondon } from "./breakpoint/BreakpointLondon";

/**
 * Two compositions, one responsive Master:
 *  - VelloPromo          1920×1080 master (Twitter/X, YouTube, landing)
 *  - VelloPromoVertical  1080×1920 vertical (TikTok / Reels / Shorts)
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="BreakpointLondon" component={BreakpointLondon} durationInFrames={670} fps={30} width={1080} height={1920} />
      <Composition
        id="TokenizedHarvest"
        component={TokenizedHarvest}
        durationInFrames={1980}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VelloPromo"
        component={Master}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="VelloPromoVertical"
        component={Master}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="AgentLeaderboard"
        component={AgentLeaderboard}
        durationInFrames={LB_TOTAL}
        fps={LB_FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
