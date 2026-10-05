/**
 * Render entry for the 2026-07-13 Daybreak Pro daily batch (5 films).
 * Render with:  npx remotion render src/promos/daily/2026-07-13/index.tsx <CompId> out.mp4
 */
import React from "react";
import { Composition, registerRoot } from "remotion";
import { G1TheFirstHour } from "./G1TheFirstHour";
import { G2DistributionAge } from "./G2DistributionAge";
import { G3SupplySide } from "./G3SupplySide";
import { G4DayWithJuno } from "./G4DayWithJuno";
import { G5VolumeBeatsViral } from "./G5VolumeBeatsViral";

const F = { fps: 30, width: 1920, height: 1080, durationInFrames: 900 } as const;

const Root: React.FC = () => (
  <>
    <Composition id="G1TheFirstHour" component={G1TheFirstHour} {...F} />
    <Composition id="G2DistributionAge" component={G2DistributionAge} {...F} />
    <Composition id="G3SupplySide" component={G3SupplySide} {...F} />
    <Composition id="G4DayWithJuno" component={G4DayWithJuno} {...F} />
    <Composition id="G5VolumeBeatsViral" component={G5VolumeBeatsViral} {...F} />
  </>
);

registerRoot(Root);
