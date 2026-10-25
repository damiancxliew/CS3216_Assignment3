import { expect, it } from "vitest";
import { sources } from "../apps/web/src/lib/demo/lim-bo-seng";
import { sourceQuestions } from "../apps/web/src/lib/demo/source-questions";
import { createDemoV3Client, newDemoV3State, restoreDemoV3State, projectDemoV3 } from "../apps/web/src/lib/demo/v3-session";
it("gives every archive source a specific question, three options, a hint and a short footnote", () => {
  for (const source of sources) {
    const q = sourceQuestions[source.id];
    expect(q, source.id).toBeDefined();
    expect(new Set(q.options).size).toBe(3);
    expect(q.options[q.answer]).toBeTruthy();
    expect(q.hint.length).toBeGreaterThan(20);
    expect(q.footnote.length).toBeLessThan(145);
  }
});
it("keeps caveats out of scroll body and persists a single reward note on repeated saves", async () => {
  let state = newDemoV3State(); state.intro = false;
  const client = createDemoV3Client(state, (next) => { state = next; });
  await client.act(0, { type:"openDocument", documentId:"life" });
  const doc = projectDemoV3(state).documents.find((d) => d.id === "life")!;
  expect(doc.body).toBe(sources.find((s) => s.id === "life")!.summary);
  expect(doc.body).not.toContain("SOURCE LIMITS");
  for (let i = 0; i < 2; i++) expect((await client.act(state.revision, {type:"selectPassage",documentId:"life",start:0,end:doc.body.length})).ok).toBe(true);
  const restored = restoreDemoV3State(JSON.stringify(state));
  expect(restored.notes).toHaveLength(1);
  expect(restored.notes[0].text).toContain(doc.body);
});
