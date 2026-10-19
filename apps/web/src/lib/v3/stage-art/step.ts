import type { EnqueueStep } from "@adventure/jobs";

export function stageArtStep(adventureId: string, version: number): Exclude<EnqueueStep, string> {
  return {
    name: `stage-art-v${version}`,
    step: "v3.stage-art",
    input: { adventureId, version },
  };
}
