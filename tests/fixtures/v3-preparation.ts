import { EngineSpec } from "@adventure/engine";
import { sampleSpec } from "../../packages/spec-v3/tests/sample";

/** Synthetic source-reasoning fixture, not an authenticated historical lesson. */
export function preparationAdventure() {
  const spec = EngineSpec.parse(structuredClone(sampleSpec));
  // Keep this service fixture focused on preparation and timer policy, without background moves.
  spec.storyEvents = [];
  const doc = spec.documents[0]!;
  doc.body = "The harbour was busy. Several masters complained of new dues at the anchorage. Their cargo remained on board. Ships waited for inspection.";
  const start = doc.body.indexOf("Several"), end = doc.body.indexOf(" Their");
  doc.keyPassages = [{ id: "kp-1", start, end }];
  const question = (id: string, prompt: string) => ({
    id, prompt,
    options: [{ id: "supported", text: "Some merchants opposed the duties." }, { id: "overstated", text: "All merchants welcomed the duties." }, { id: "unsupported", text: "No merchant paid the duties." }],
    correctOptionId: "supported", support: [{ start, end }], explanation: "The register describes complaints from several masters.",
  });
  doc.readingCheck = {
    discoveryId: "disc-2",
    variants: [
      question("check-1", "What does the register suggest about the new duties?"),
      question("check-2", "Which conclusion about merchants does the register support?"),
      question("check-3", "How far does the evidence support opposition to the duties?"),
      question("check-4", "Which claim stays within the register's evidence?"),
    ],
    recovery: question("correction", "What do the complaints directly tell you?"),
    recoveryDiscoveryIds: [],
  };
  spec.stages[0]!.preparation = {
    characters: {
      "char-farquhar": [{ discoveryIds: ["disc-2"], minMet: 1 }],
      "char-nakhoda": [{ discoveryIds: ["disc-2"], minMet: 1 }],
    },
    decision: [{ discoveryIds: ["disc-1", "disc-3"], minMet: 1 }],
    essentialCharacters: [{ characterId: "char-farquhar", discoveryIds: ["disc-1"] }, { characterId: "char-nakhoda", discoveryIds: ["disc-3"] }],
  };
  return { spec, support: { start, end } };
}
