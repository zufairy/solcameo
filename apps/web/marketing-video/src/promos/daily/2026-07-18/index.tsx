/**
 * Render entry for the 2026-07-18 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-18/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { K1ThreeMinutes } from "./K1ThreeMinutes";
import { K2TheOracle } from "./K2TheOracle";
import { K3ProofStack } from "./K3ProofStack";
import { K4Reallocation } from "./K4Reallocation";
import { K5MeetRhea } from "./K5MeetRhea";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="K1ThreeMinutes" component={K1ThreeMinutes} {...F} />
    <Composition id="K2TheOracle" component={K2TheOracle} {...F} />
    <Composition id="K3ProofStack" component={K3ProofStack} {...F} />
    <Composition id="K4Reallocation" component={K4Reallocation} {...F} />
    <Composition id="K5MeetRhea" component={K5MeetRhea} {...F} />
  </>
);

registerRoot(Root);
