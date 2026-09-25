import { describe, expect, it } from "vitest";

import { parseBriefEdit } from "@/lib/brief/edit";

function form(): FormData {
  const data = new FormData();
  data.set("title", "The Treaty");
  data.set("setting", "Singapore, 1819");
  data.set("student_role", "Interpreter");
  data.set("learning_objectives", "Explain the agreement\n\nCompare two perspectives");
  data.set("band", "lower-secondary");
  data.set("age_min", "13");
  data.set("age_max", "14");
  data.set("stage_count", "2");
  data.set("stage_0_title", "Arrival");
  data.set("stage_0_focus", "Meet the visitors and decide whom to trust.");
  data.set("stage_1_title", "Negotiation");
  data.set("stage_1_focus", "Review the terms and decide what to report.");
  return data;
}

describe("brief editing", () => {
  it("parses the edited fields that generation will read", () => {
    expect(parseBriefEdit(form())).toEqual({
      title: "The Treaty",
      setting: "Singapore, 1819",
      studentRole: "Interpreter",
      learningObjectives: ["Explain the agreement", "Compare two perspectives"],
      readingLevel: { band: "lower-secondary", ageMin: 13, ageMax: 14 },
      stageOutline: [
        { title: "Arrival", focus: "Meet the visitors and decide whom to trust." },
        { title: "Negotiation", focus: "Review the terms and decide what to report." },
      ],
    });
  });

  it("rejects an incomplete stage or reversed age range", () => {
    const incomplete = form();
    incomplete.delete("stage_1_focus");
    expect(parseBriefEdit(incomplete)).toBeNull();

    const ages = form();
    ages.set("age_min", "15");
    expect(parseBriefEdit(ages)).toBeNull();
  });
});
