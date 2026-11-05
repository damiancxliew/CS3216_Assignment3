import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { applyTeacherEdits } from "@/lib/v3/edit/apply";

it("edits a persisted pause base regardless of JSON object key order", () => {
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, reorder(item)]),
      );
    return value;
  };
  const base = reorder(
    JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  ) as AdventureSpec;
  const snapshot = JSON.stringify(base);
  const updated = applyTeacherEdits(
    base,
    [
      {
        type: "set",
        path: ["stages", 0, "title"],
        value: "Teacher stage title",
      },
    ],
    [],
  );
  expect(updated.stages[0].title).toBe("Teacher stage title");
  expect(JSON.stringify(base)).toBe(snapshot);
  expect(updated.discoveries[0].citations).toEqual(
    base.discoveries[0].citations,
  );
});
