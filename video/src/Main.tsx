import React from "react";
import { AbsoluteFill, Series, staticFile, Audio } from "remotion";
import { ProblemStatement } from "./scenes/ProblemStatement";
import { SolutionReveal } from "./scenes/SolutionReveal";
import { Architecture } from "./scenes/Architecture";
import { RFB5InAction } from "./scenes/RFB5InAction";
import { RFB6InAction } from "./scenes/RFB6InAction";
import { DashboardSnapshot } from "./scenes/DashboardSnapshot";
import { Outro } from "./scenes/Outro";

export const MAIN_FPS = 30;
export const MAIN_WIDTH = 1920;
export const MAIN_HEIGHT = 1080;

export const SCENE_SECONDS = {
  problem: 18,
  stack: 21,
  architecture: 17,
  rfb5: 17,
  rfb6: 16,
  dashboard: 14,
  outro: 21,
};

const s = (sec: number) => Math.round(sec * MAIN_FPS);

export const MAIN_DURATION_FRAMES = s(
  SCENE_SECONDS.problem +
    SCENE_SECONDS.stack +
    SCENE_SECONDS.architecture +
    SCENE_SECONDS.rfb5 +
    SCENE_SECONDS.rfb6 +
    SCENE_SECONDS.dashboard +
    SCENE_SECONDS.outro,
);

const vo = (id: string) => staticFile(`vo/${id}.mp3`);

export const Main: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <Series>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.problem)}>
          <ProblemStatement />
          <Audio src={vo("scene-1-problem")} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.stack)}>
          <SolutionReveal />
          <Audio src={vo("scene-2-stack")} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.architecture)}>
          <Architecture />
          <Audio src={vo("scene-3-architecture")} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.rfb5)}>
          <RFB5InAction />
          <Audio src={vo("scene-4-rfb5")} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.rfb6)}>
          <RFB6InAction />
          <Audio src={vo("scene-5-rfb6")} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.dashboard)}>
          <DashboardSnapshot />
          <Audio src={vo("scene-6-dashboard")} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={s(SCENE_SECONDS.outro)}>
          <Outro />
          <Audio src={vo("scene-7-outro")} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
