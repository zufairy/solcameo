/**
 * Render entry for the 2026-07-05 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-05/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { P1ProofOfView } from "./P1ProofOfView";
import { P2Agency } from "./P2Agency";
import { P3Bounty } from "./P3Bounty";
import { P4OwnTheAgent } from "./P4OwnTheAgent";
import { P5PaysRent } from "./P5PaysRent";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="P1ProofOfView" component={P1ProofOfView} {...F} />
    <Composition id="P2Agency" component={P2Agency} {...F} />
    <Composition id="P3Bounty" component={P3Bounty} {...F} />
    <Composition id="P4OwnTheAgent" component={P4OwnTheAgent} {...F} />
    <Composition id="P5PaysRent" component={P5PaysRent} {...F} />
  </>
);

registerRoot(Root);
