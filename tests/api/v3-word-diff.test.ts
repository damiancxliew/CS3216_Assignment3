import { describe, expect, it } from "vitest";
import { wordDiff } from "@/lib/v3/review-chat/word-diff";

describe("wordDiff", () => {
  it("marks identical strings as unchanged", () => {
    expect(wordDiff("same words", "same words")).toEqual([
      { type: "same", text: "same words" },
    ]);
  });

  it("marks a replaced word as removed and added", () => {
    expect(wordDiff("A small cat.", "A large cat.")).toEqual([
      { type: "same", text: "A " },
      { type: "removed", text: "small" },
      { type: "added", text: "large" },
      { type: "same", text: " cat." },
    ]);
  });

  it("marks inserted words as added", () => {
    expect(wordDiff("The cat waited.", "The tired cat waited.")).toEqual([
      { type: "same", text: "The " },
      { type: "added", text: "tired " },
      { type: "same", text: "cat waited." },
    ]);
  });

  it("handles empty before text", () => {
    expect(wordDiff("", "New text")).toEqual([
      { type: "added", text: "New text" },
    ]);
  });

  it("handles empty after text", () => {
    expect(wordDiff("Old text", "")).toEqual([
      { type: "removed", text: "Old text" },
    ]);
  });

  it("uses the fallback for large inputs", () => {
    const before = "old ".repeat(501);
    const after = "new ".repeat(501);
    expect(wordDiff(before, after)).toEqual([
      { type: "removed", text: before },
      { type: "added", text: after },
    ]);
  });

  it("preserves both strings across unchanged and changed parts", () => {
    const before = "Ships arrived early. The harbour was crowded.";
    const after = "Ships arrived before dawn. The harbour was nearly empty.";
    const parts = wordDiff(before, after);
    expect(
      parts
        .filter(({ type }) => type === "same" || type === "removed")
        .map(({ text }) => text)
        .join(""),
    ).toBe(before);
    expect(
      parts
        .filter(({ type }) => type === "same" || type === "added")
        .map(({ text }) => text)
        .join(""),
    ).toBe(after);
  });
});
