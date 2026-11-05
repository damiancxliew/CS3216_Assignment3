import { Composition } from "remotion";
import { TOTAL_FRAMES, Trailer } from "./Trailer";
import { FPS } from "./theme";

export const Root = () => (
  <Composition id="Trailer" component={Trailer} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
