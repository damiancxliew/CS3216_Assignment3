import type { EnqueueStep } from "@adventure/jobs";

export function portraitsStep(adventureId: string, version: number): Exclude<EnqueueStep, string> {
  return {
    name: `portraits-v${version}`,
    step: "v3.portraits",
    input: { adventureId, version },
  };
}
