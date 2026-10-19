import type { AmbientOverlayId } from "@adventure/game-client";
import type { StageView } from "@adventure/play-contract";

const ATMOSPHERES: Array<[RegExp, AmbientOverlayId]> = [
  [/\b(?:thunder|storm)\b/, "thunderstorm"],
  [/\b(?:rain|monsoon)\b/, "rain"],
  [/\b(?:snow|winter)\b/, "snow"],
  [/\b(?:fog|mist)\b/, "fog"],
  [/\b(?:haze|smoke)\b/, "haze"],
  [/\b(?:dust|drought|desert)\b/, "dust"],
  [/\b(?:night|midnight|evening|dusk)\b/, "night"],
];

export function v3Ambient(stage: Pick<StageView, "timePlace" | "title">): AmbientOverlayId {
  const framing = `${stage.timePlace} ${stage.title}`.toLowerCase();
  return ATMOSPHERES.find(([pattern]) => pattern.test(framing))?.[1] ?? "clear";
}
