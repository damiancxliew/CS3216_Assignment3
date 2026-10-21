import { describe, expect, it } from "vitest";
import { learningReportHtml } from "../apps/web/src/lib/demo/learning-report";
import { newDemoV3State } from "../apps/web/src/lib/demo/v3-session";

const date = new Date("2026-10-21T12:00:00Z");
describe("readable standalone learning report", () => {
  it("labels incomplete work instead of inventing answers or a grade", () => {
    const html = learningReportHtml(newDemoV3State(), date);
    expect(html).toContain("Progress so far");
    expect(html).toContain("0 / 2");
    expect(html).toContain("No recommendation recorded");
    expect(html).toContain("Not answered yet");
    expect(html).toContain("Print / Save as PDF");
  });
  it("exports actual decisions, trade-offs, sources, selected claims and reflections", () => {
    const state = newDemoV3State();
    state.phase = "reveal";
    state.decisions = [
      { stage: 0, choice: "family", prediction: "", evidence: ["family"] },
    ];
    state.notes = [
      {
        id: "source-0-family",
        text: "A household also carries the cost.",
        source: "document",
        stageIndex: 0,
        at: 0,
      },
    ];
    state.answers = [
      {
        verdictId: "community",
        text: "Cooperation mattered, but one account cannot speak for everyone.",
        evidenceNoteIds: ["source-0-family"],
      },
    ];
    const html = learningReportHtml(state, date);
    expect(html).toContain("Recommend support for the household");
    expect(html).toContain(
      "The departure preparations receive less of your attention.",
    );
    expect(html).toContain("A household also carries the cost.");
    expect(html).toContain(
      "Resistance depended on local cooperation and material support.",
    );
    expect(html).toContain(
      "Cooperation mattered, but one account cannot speak for everyone.",
    );
    expect(html).toContain("Sources in my record");
    expect(html).toContain("Lesson completed");
  });
  it("escapes student, model and legacy content so exports cannot execute it", () => {
    const state = newDemoV3State();
    const attack =
      '<script>window.pwned=true</script><img src=x onerror="alert(1)">';
    state.messages[0].text = attack;
    state.notes = [
      {
        id: "evil",
        text: attack,
        source: "conversation",
        stageIndex: 0,
        at: 0,
      },
    ];
    state.answers = [
      { verdictId: "community", text: attack, evidenceNoteIds: [] },
    ];
    state.previousFiveStageProgress = {
      stage: 1,
      chosen: "listen",
      moment: "predicting",
      decisions: [],
      notes: state.notes,
      messages: state.messages,
    };
    const html = learningReportHtml(state, date);
    expect(html).not.toContain(attack);
    expect(html).toContain("&lt;script&gt;");
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain("My earlier five-stage record");
    expect(html).toContain(
      "Pending earlier recommendation: Make room for private concerns",
    );
  });
});
