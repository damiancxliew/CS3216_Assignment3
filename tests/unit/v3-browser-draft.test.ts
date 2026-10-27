import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { recoverBrowserDraft, browserDraftKey } from "@/app/v3/teacher/[id]/review/browser-draft";

const base = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
describe("browser draft recovery", () => {
  it("recovers edits and their original version without changing the saved adventure", () => {
    const recovered = recoverBrowserDraft(JSON.stringify({ version: 2, base,
      edits: [{ type: "set", path: ["title"], value: "Unsaved title" }], candidates: {},
    }), "adv", []);
    expect(recovered.version).toBe(2);
    expect(recovered.draft.title).toBe("Unsaved title");
    expect(recovered.base).toEqual(base);
    expect(browserDraftKey("adv")).not.toBe(browserDraftKey("other"));
  });
  it("rejects corrupt data and candidates from another adventure", () => {
    expect(() => recoverBrowserDraft("broken", "adv", [])).toThrow();
    expect(() => recoverBrowserDraft(JSON.stringify({ version: 2, base, edits: [], candidates: {
      "00000000-0000-4000-8000-000000000001": {
        id: "00000000-0000-4000-8000-000000000001", adventureId: "other", target: { kind: "stage", key: base.stages[0].id },
        snapshot: { candidateId: "00000000-0000-4000-8000-000000000001", origin: "upload", url: "https://assets.example/image.webp", format: "webp", caption: "Image", alt: "Image", credit: "Teacher" },
      },
    } }), "adv", [])).toThrow(/another adventure/);
  });
});
