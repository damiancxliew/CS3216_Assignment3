import { describe, expect, it } from "vitest";
import { changePreview } from "@/lib/v3/review-chat/preview";

describe("review-chat previews", () => {
  it("uses a character's name rather than their role as the field label", () => {
    const current = {
      characters: [{
        id: "percival",
        name: "Arthur Percival",
        title: "Lieutenant-General, army commander",
        persona: { voice: "I have little strength left." },
      }],
    };
    const change = {
      type: "set" as const,
      path: ["characters", 0, "persona", "voice"],
      value: "I am tired of this fight.",
    };

    expect(changePreview(current, change).label).toBe(
      "Arthur Percival · Persona · Voice",
    );
  });

  it("uses singular one-based collection labels for indexed fields", () => {
    const current = {
      definingMoments: [{
        id: "decision-1",
        acts: [{ reaction: "Before" }, { reaction: "Before" }],
      }],
    };
    const change = {
      type: "set" as const,
      path: ["definingMoments", 0, "acts", 1, "reaction"],
      value: "After",
    };

    expect(changePreview(current, change).label).toBe(
      "Decision 1 · Act 2 · Reaction",
    );
  });

  it("renders reading support edits as quoted passages, not offset arrays", () => {
    const currentBody = "The harbour is closed.";
    const current = {
      documents: [{
        body: currentBody,
        readingCheck: {
          variants: Array.from({ length: 4 }, () => ({
            support: [{ start: 0, end: currentBody.length }],
          })),
        },
      }],
    };
    const body = "The harbour is open.";
    const change = {
      type: "set" as const,
      path: ["documents", 0, "readingCheck", "variants", 0, "support"],
      value: [{ start: 0, end: body.length }],
    };

    expect(changePreview(current, change, [
      { type: "set", path: ["documents", 0, "body"], value: body },
      change,
    ])).toEqual({
      label: "Reading question 1 · Supporting passage",
      before: "“The harbour is closed.”",
      after: "“The harbour is open.”",
    });
  });
});
