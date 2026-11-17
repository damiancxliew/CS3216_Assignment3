import { describe, expect, it } from "vitest";
import { condenseDiff, type DiffPart } from "@/lib/v3/review-chat/word-diff";

describe("condenseDiff", () => {
  it("keeps the last words of a long leading context", () => {
    const parts: DiffPart[] = [
      { type: "same", text: "one two three four five six " },
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
    ];

    expect(condenseDiff(parts, 2)).toEqual([
      { type: "same", text: "… five six " },
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
    ]);
  });

  it("keeps the first words of a long trailing context", () => {
    const parts: DiffPart[] = [
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "same", text: "one two three four five" },
    ];

    expect(condenseDiff(parts, 2)).toEqual([
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "same", text: "one two…" },
    ]);
  });

  it("collapses long unchanged context between changes", () => {
    const parts: DiffPart[] = [
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "same", text: "one two three four five six" },
      { type: "removed", text: "before" },
      { type: "added", text: "after" },
    ];

    expect(condenseDiff(parts, 2)).toEqual([
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "same", text: "one two … five six" },
      { type: "removed", text: "before" },
      { type: "added", text: "after" },
    ]);
  });

  it("leaves short unchanged contexts alone", () => {
    const parts: DiffPart[] = [
      { type: "same", text: "one two" },
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "same", text: "one two three four" },
      { type: "removed", text: "before" },
      { type: "added", text: "after" },
      { type: "same", text: "five six" },
    ];

    expect(condenseDiff(parts, 2)).toEqual(parts);
  });

  it("returns unchanged input when there are no changes", () => {
    const parts: DiffPart[] = [{ type: "same", text: "one two three" }];

    expect(condenseDiff(parts, 1)).toBe(parts);
  });

  it("never changes removed or added parts", () => {
    const changed: DiffPart[] = [
      { type: "removed", text: " an exact old phrase " },
      { type: "added", text: " an exact new phrase " },
    ];
    const parts: DiffPart[] = [
      { type: "same", text: "one two three four five" },
      ...changed,
      { type: "same", text: "six seven eight nine ten" },
    ];

    expect(condenseDiff(parts, 1).filter(({ type }) => type !== "same")).toEqual(
      changed,
    );
  });
});
