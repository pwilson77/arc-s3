import "./index.css";
import { Composition } from "remotion";
import {
  Main,
  MAIN_FPS,
  MAIN_HEIGHT,
  MAIN_WIDTH,
  MAIN_DURATION_FRAMES,
} from "./Main";
import {
  TechDemo,
  TECH_DEMO_DURATION_FRAMES,
  TECH_DEMO_FPS,
  TECH_DEMO_HEIGHT,
  TECH_DEMO_WIDTH,
} from "./TechDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TechDemo"
        component={TechDemo}
        durationInFrames={TECH_DEMO_DURATION_FRAMES}
        fps={TECH_DEMO_FPS}
        width={TECH_DEMO_WIDTH}
        height={TECH_DEMO_HEIGHT}
      />
      <Composition
        id="Main"
        component={Main}
        durationInFrames={MAIN_DURATION_FRAMES}
        fps={MAIN_FPS}
        width={MAIN_WIDTH}
        height={MAIN_HEIGHT}
      />
    </>
  );
};
