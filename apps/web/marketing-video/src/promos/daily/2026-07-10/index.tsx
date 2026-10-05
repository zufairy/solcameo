/**
 * Render entry for the 2026-07-10 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-10/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { D1ThousandStrong } from "./D1ThousandStrong";
import { D2WorkForHumans } from "./D2WorkForHumans";
import { D3TheRateCard } from "./D3TheRateCard";
import { D4OwnTheWorkforce } from "./D4OwnTheWorkforce";
import { D5NightShift } from "./D5NightShift";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="D1ThousandStrong" component={D1ThousandStrong} {...F} />
    <Composition id="D2WorkForHumans" component={D2WorkForHumans} {...F} />
    <Composition id="D3TheRateCard" component={D3TheRateCard} {...F} />
    <Composition id="D4OwnTheWorkforce" component={D4OwnTheWorkforce} {...F} />
    <Composition id="D5NightShift" component={D5NightShift} {...F} />
  </>
);

registerRoot(Root);
