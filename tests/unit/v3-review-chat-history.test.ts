import { describe, expect, it } from "vitest";
import {
  CHANGES_MARKER,
  visibleReviewText,
  withChangeLog,
} from "@/lib/v3/review-chat/history";

describe("review chat history text", () => {
  it("appends formatted before and after values", () => {
    expect(withChangeLog("Changed the title.", [
      { label: "Adventure title", before: "Old title", after: "New title" },
    ])).toBe(
      `Changed the title.${CHANGES_MARKER}- Adventure title: "Old title" → "New title"`,
    );
  });

  it("truncates each before and after value independently", () => {
    const before = "b".repeat(161);
    const after = "a".repeat(170);
    const result = withChangeLog("Changed it.", [
      { label: "Title", before, after },
    ]);

    expect(result).toContain(`"${"b".repeat(160)}…"`);
    expect(result).toContain(`"${"a".repeat(160)}…"`);
    expect(result).not.toContain(before);
    expect(result).not.toContain(after);
  });

  it("drops complete change lines from the end to fit the limit", () => {
    const entries = [
      { label: "Title", before: "Old", after: "New" },
      { label: "Voice", before: "Quiet", after: "Loud" },
    ];
    const oneLine = `Notes.${CHANGES_MARKER}- Title: "Old" → "New"`;

    expect(withChangeLog("Notes.", entries, oneLine.length)).toBe(oneLine);
  });

  it("returns notes unchanged when no change line fits", () => {
    expect(withChangeLog("Notes.", [
      { label: "Title", before: "Old", after: "New" },
    ], "Notes.".length)).toBe("Notes.");
    expect(withChangeLog("Longnotes", [], 4)).toBe("Long");
  });

  it("leaves notes unchanged when there are no changes", () => {
    expect(withChangeLog("No edits were needed.", [])).toBe(
      "No edits were needed.",
    );
  });

  it("strips internal suffixes for display and preserves plain messages", () => {
    expect(visibleReviewText({
      role: "user",
      text: "Change the title.\n\nTargets: [[\"title\"]]",
    })).toBe("Change the title.");
    expect(visibleReviewText({
      role: "assistant",
      text: `Changed the title.${CHANGES_MARKER}- Adventure title: "Old" → "New"`,
    })).toBe("Changed the title.");
    expect(visibleReviewText({ role: "user", text: "Plain user message" })).toBe(
      "Plain user message",
    );
    expect(visibleReviewText({ role: "assistant", text: "Plain reply" })).toBe(
      "Plain reply",
    );
  });
});
