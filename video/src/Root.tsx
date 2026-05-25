import "./index.css";
import { Composition } from "remotion";
import {
  Main,
  MAIN_FPS,
  MAIN_HEIGHT,
  MAIN_WIDTH,
  MAIN_DURATION_FRAMES,
} from "./Main";

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
