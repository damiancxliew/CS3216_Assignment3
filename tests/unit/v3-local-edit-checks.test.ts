import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { newLocalErrors } from "@/lib/v3/edit/local-checks";
const fixture = () =>
  AdventureSpec.parse(
    JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
  );
describe("immediate pause validation", () => {
  it("allows existing generation errors while blocking newly introduced errors", () => {
    const base = fixture();
    base.reveal!.whatHappened = "";
    const edited = structuredClone(base);
    edited.stages[0].title = "A teacher title";
    expect(newLocalErrors(base, edited)).toEqual([]);
    edited.teacherQuestions[0] = "";
    expect(newLocalErrors(base, edited).length).toBeGreaterThan(0);
  });
  it("reports broken references and structural errors without throwing", () => {
    const base = fixture();
    const edited = structuredClone(base);
    edited.stages[0].startRoomId = "missing-room";
    expect(newLocalErrors(base, edited).length).toBeGreaterThan(0);
    expect(
      newLocalErrors(base, { ...base, endings: null }).some(
        (issue) => issue.code === "schema",
      ),
    ).toBe(true);
  });
});
