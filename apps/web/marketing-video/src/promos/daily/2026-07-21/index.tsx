/**
 * Render entry for the 2026-07-21 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-21/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { M1BlanketTheFeed } from "./M1BlanketTheFeed";
import { M2ThreeVerbs } from "./M2ThreeVerbs";
import { M3PaysItsOwnRent } from "./M3PaysItsOwnRent";
import { M4ShowUp } from "./M4ShowUp";
import { M5MeetNova } from "./M5MeetNova";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="M1BlanketTheFeed" component={M1BlanketTheFeed} {...F} />
    <Composition id="M2ThreeVerbs" component={M2ThreeVerbs} {...F} />
    <Composition id="M3PaysItsOwnRent" component={M3PaysItsOwnRent} {...F} />
    <Composition id="M4ShowUp" component={M4ShowUp} {...F} />
    <Composition id="M5MeetNova" component={M5MeetNova} {...F} />
  </>
);

registerRoot(Root);
