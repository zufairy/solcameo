/**
 * Render entry for the 2026-07-08 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-08/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { H1OtherClipper } from "./H1OtherClipper";
import { H2MintIn15 } from "./H2MintIn15";
import { H3AlwaysPosting } from "./H3AlwaysPosting";
import { H4AccountsAlive } from "./H4AccountsAlive";
import { H5TheRoster } from "./H5TheRoster";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="H1OtherClipper" component={H1OtherClipper} {...F} />
    <Composition id="H2MintIn15" component={H2MintIn15} {...F} />
    <Composition id="H3AlwaysPosting" component={H3AlwaysPosting} {...F} />
    <Composition id="H4AccountsAlive" component={H4AccountsAlive} {...F} />
    <Composition id="H5TheRoster" component={H5TheRoster} {...F} />
  </>
);

registerRoot(Root);
