/**
 * Render entry for the 2026-07-15 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-15/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { J1TheGroupChat } from "./J1TheGroupChat";
import { J2FourTabs } from "./J2FourTabs";
import { J3TheClipper } from "./J3TheClipper";
import { J4PaperTrail } from "./J4PaperTrail";
import { J5ZeroFollowers } from "./J5ZeroFollowers";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="J1TheGroupChat" component={J1TheGroupChat} {...F} />
    <Composition id="J2FourTabs" component={J2FourTabs} {...F} />
    <Composition id="J3TheClipper" component={J3TheClipper} {...F} />
    <Composition id="J4PaperTrail" component={J4PaperTrail} {...F} />
    <Composition id="J5ZeroFollowers" component={J5ZeroFollowers} {...F} />
  </>
);

registerRoot(Root);
