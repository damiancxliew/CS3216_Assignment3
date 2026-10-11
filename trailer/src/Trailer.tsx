import { AbsoluteFill, Audio, Sequence, Series, interpolate, staticFile } from "remotion";
import { SceneFade, WipTag } from "./components";
import { BigIdea, Choice, EndCard, Explain, Outcomes, People, Problem, Schools, Share, Sources } from "./scenes";
import { s } from "./theme";

/** Scene order and lengths (seconds). Trim here to change the cut. */
export const CUT = [
  { name: "Problem", seconds: 10, Scene: Problem },
  { name: "BigIdea", seconds: 8, Scene: BigIdea },
  { name: "Outcomes", seconds: 6, Scene: Outcomes },
  { name: "People", seconds: 6, Scene: People },
  { name: "Sources", seconds: 6, Scene: Sources },
  { name: "Share", seconds: 6, Scene: Share },
  { name: "Choice", seconds: 6, Scene: Choice },
  { name: "Explain", seconds: 6, Scene: Explain },
  { name: "Schools", seconds: 10, Scene: Schools },
  { name: "EndCard", seconds: 11, Scene: EndCard },
] as const;

export const TOTAL_FRAMES = CUT.reduce((sum, scene) => sum + s(scene.seconds), 0);
const startOf = (name: string) => {
  let frames = 0;
  for (const scene of CUT) {
    if (scene.name === name) return frames;
    frames += s(scene.seconds);
  }
  return frames;
};

const Music = ({ src, from, to, volume, loop = false }: { src: string; from: number; to: number; volume: number; loop?: boolean }) => (
  <Sequence from={from} durationInFrames={to - from} layout="none">
    <Audio
      src={staticFile(`audio/${src}.ogg`)}
      loop={loop}
      volume={(f) => interpolate(f, [0, 20, to - from - 25, to - from], [0, volume, volume, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
    />
  </Sequence>
);

export const Trailer = () => {
  const tension = startOf("BigIdea");
  const finale = startOf("Schools");
  return (
    <AbsoluteFill style={{ background: "#fff8e9" }}>
      <Series>
        {CUT.map(({ name, seconds, Scene }) => (
          <Series.Sequence key={name} name={name} durationInFrames={s(seconds)}>
            <SceneFade duration={s(seconds)} fadeIn={name === "Problem" ? 20 : 8} fadeOut={name === "EndCard" ? 30 : 8}>
              <Scene />
            </SceneFade>
          </Series.Sequence>
        ))}
      </Series>
      <Sequence from={0} durationInFrames={startOf("EndCard")} layout="none">
        <WipTag />
      </Sequence>
      <Music src="quiet" from={0} to={tension + 10} volume={0.45} />
      <Music src="tension" from={tension} to={finale + 10} volume={0.5} loop />
      <Music src="end-theme" from={finale} to={TOTAL_FRAMES} volume={0.55} />
    </AbsoluteFill>
  );
};
