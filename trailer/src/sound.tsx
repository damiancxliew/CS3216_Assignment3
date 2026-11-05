import { createContext, useContext } from "react";
import { Audio, Sequence, staticFile } from "remotion";

/** True inside a preview window, where scenes render silently. */
export const PreviewContext = createContext(false);

/** A one-shot sound effect from public/audio, played at frame `at` of the current scene. */
export const Sound = ({ src, at, volume = 0.6 }: { src: string; at: number; volume?: number }) =>
  useContext(PreviewContext) ? null : (
    <Sequence from={Math.round(at)} durationInFrames={60} layout="none">
      <Audio src={staticFile(`audio/sfx-${src}.wav`)} volume={volume} />
    </Sequence>
  );
