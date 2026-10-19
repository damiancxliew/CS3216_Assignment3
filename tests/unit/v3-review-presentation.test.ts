import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { reviewIssueMessage, reviewNames } from "@/lib/v3/review-presentation";
import { ReviewIssue } from "@/components/teacher/review-issue";

const spec = AdventureSpec.parse(
  JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")),
);

describe("teacher review language", () => {
  it("gives passages and related story references readable labels", () => {
    const names = reviewNames(spec);
    const doc = spec.documents.find((doc) => doc.keyPassages.length)!;
    expect(names.get(doc.keyPassages[0].id)).toBe(`Passage 1 · ${doc.title}`);
    for (const character of spec.characters) {
      for (const slant of character.slants)
        expect(names.get(slant.id)).toBe(slant.claim);
      for (const stance of character.stances)
        expect(names.get(`stance:${character.id}:${stance.id}`)).toBe(
          stance.label,
        );
    }
    expect(names.get("held")).toBe("Carried by the student");
  });

  it.each([
    [
      "passage-offsets",
      "A highlighted passage does not match the document text.",
    ],
    [
      "quote-not-in-source",
      "A quotation could not be matched to its source. Check the wording.",
    ],
    [
      "source-label",
      "The source information is missing. Identify where this content came from.",
    ],
  ])("explains %s without internal ids", (code, message) => {
    expect(
      reviewIssueMessage({
        code,
        path: "documents.0.keyPassages.0",
        message: "kp-instructions-dutch has invalid offsets 800–900",
      }),
    ).toBe(message);
  });

  it("keeps original diagnostics in closed details rather than the main message", () => {
    const issue = {
      code: "passage-offsets",
      path: "documents.0.keyPassages.0",
      message: "kp-instructions-dutch has invalid offsets 800–900",
    };
    const html = renderToStaticMarkup(createElement(ReviewIssue, { issue }));
    const detailsAt = html.indexOf("<details");
    expect(html.slice(0, detailsAt)).toContain(
      "A highlighted passage does not match the document text.",
    );
    expect(html.slice(0, detailsAt)).not.toContain("kp-instructions-dutch");
    expect(html.slice(detailsAt)).toContain(issue.message);
    expect(html.slice(detailsAt)).toContain(issue.path);
    expect(html).not.toContain(" open=");
  });

  it("keeps readable advice and gives unfamiliar diagnostics a safe summary", () => {
    expect(
      reviewIssueMessage({
        code: "new-warning",
        path: "",
        message: "Consider including another historical perspective.",
      }),
    ).toBe("Consider including another historical perspective.");
    expect(
      reviewIssueMessage({
        code: "future-check",
        path: "characters.0",
        message: "persona.voice is undefined for char-test",
      }),
    ).toBe("This check reported a problem but did not explain what to change.");
  });
});

it("keeps stage names distinct from character-local stance IDs", () => {
  const edited = structuredClone(spec);
  edited.characters[0].stances[0].id = edited.stages[0].id;
  edited.characters[1].stances[0].id = edited.stages[0].id;
  const names = reviewNames(edited);
  expect(names.get(edited.stages[0].id)).toBe(edited.stages[0].title);
  expect(
    names.get(`stance:${edited.characters[0].id}:${edited.stages[0].id}`),
  ).toBe(edited.characters[0].stances[0].label);
  expect(
    names.get(`stance:${edited.characters[1].id}:${edited.stages[0].id}`),
  ).toBe(edited.characters[1].stances[0].label);
});
