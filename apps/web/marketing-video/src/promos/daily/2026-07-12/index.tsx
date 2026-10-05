/**
 * Render entry for the 2026-07-12 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-12/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { F1SevenDays } from "./F1SevenDays";
import { F2TheStudio } from "./F2TheStudio";
import { F3ClaimToCashout } from "./F3ClaimToCashout";
import { F4WhoPays } from "./F4WhoPays";
import { F5FirstHundred } from "./F5FirstHundred";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="F1SevenDays" component={F1SevenDays} {...F} />
    <Composition id="F2TheStudio" component={F2TheStudio} {...F} />
    <Composition id="F3ClaimToCashout" component={F3ClaimToCashout} {...F} />
    <Composition id="F4WhoPays" component={F4WhoPays} {...F} />
    <Composition id="F5FirstHundred" component={F5FirstHundred} {...F} />
  </>
);

registerRoot(Root);
