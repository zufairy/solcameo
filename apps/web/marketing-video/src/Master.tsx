/**
 * Master.tsx — assembles the 8 scenes into one film via TransitionSeries.
 *
 * Scenes are responsive (they read useVideoConfig), so this exact component
 * renders both the 1920×1080 master and the 1080×1920 vertical cut. Each
 * join uses a different presentation to keep the pacing kinetic — fades,
 * slides, a wipe, and a clock-wipe morph — never the same cut twice in a row.
 */
import React from "react";
import { AbsoluteFill, Audio, staticFile, Easing } from "remotion";
import {
  TransitionSeries,
  linearTiming,
  springTiming,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";

import { Scene1Hook } from "./scenes/Scene1Hook";
import { Scene2Problem } from "./scenes/Scene2Problem";
import { Scene3Reveal } from "./scenes/Scene3Reveal";
import { Scene4HowItWorks } from "./scenes/Scene4HowItWorks";
import { Scene5Magic } from "./scenes/Scene5Magic";
import { Scene6Earns } from "./scenes/Scene6Earns";
import { Scene7Vision } from "./scenes/Scene7Vision";
import { Scene8End } from "./scenes/Scene8End";

import { SCENE_DUR, TRANSITIONS } from "./timeline";
import { HAS_AUDIO, AUDIO_SRC, AUDIO_OFFSET_FRAMES } from "./audio";
import { COLORS } from "./theme";
import { useVideoConfig } from "remotion";

export const Master: React.FC = () => {
  const { width, height } = useVideoConfig();
  // wipe direction adapts to orientation so the morph reads naturally
  const wipeDir = height > width ? "from-bottom" : "from-left";
  const slideDir = height > width ? "from-bottom" : "from-right";

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.hook}>
          <Scene1Hook />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITIONS[0] })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.problem}>
          <Scene2Problem />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: wipeDir })}
          timing={linearTiming({
            durationInFrames: TRANSITIONS[1],
            easing: Easing.inOut(Easing.cubic),
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.reveal}>
          <Scene3Reveal />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: slideDir })}
          timing={springTiming({
            config: { damping: 200 },
            durationInFrames: TRANSITIONS[2],
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.howItWorks}>
          <Scene4HowItWorks />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITIONS[3] })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.magic}>
          <Scene5Magic />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={clockWipe({ width, height })}
          timing={linearTiming({
            durationInFrames: TRANSITIONS[4],
            easing: Easing.inOut(Easing.cubic),
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.earns}>
          <Scene6Earns />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: slideDir })}
          timing={springTiming({
            config: { damping: 200 },
            durationInFrames: TRANSITIONS[5],
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.vision}>
          <Scene7Vision />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITIONS[6] })}
        />
        <TransitionSeries.Sequence durationInFrames={SCENE_DUR.end}>
          <Scene8End />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Music — drop public/audio/track.mp3 and flip HAS_AUDIO in audio.ts */}
      {HAS_AUDIO && (
        <Audio
          src={staticFile(AUDIO_SRC)}
          startFrom={Math.max(0, -AUDIO_OFFSET_FRAMES)}
          volume={(f) =>
            // gentle fade-in over first 18f, fade-out over last 30f
            Math.min(1, f / 18)
          }
        />
      )}
    </AbsoluteFill>
  );
};
