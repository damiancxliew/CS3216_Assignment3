import { describe, expect, it } from "vitest";
import { analyticsEnvironment, stagingReplayConfig } from "../apps/web/src/lib/analytics/environment";
import { demoActionEvents } from "../apps/web/src/lib/demo/analytics-events";
import { createDemoV3Client, newDemoV3State } from "../apps/web/src/lib/demo/v3-session";
import { stages } from "../apps/web/src/lib/demo/lim-bo-seng";

describe("staging analytics isolation", () => {
  it("labels staging, production and local traffic independently", () => {
    expect(analyticsEnvironment("staging.pocketadventures.world")).toBe("staging");
    expect(analyticsEnvironment("pocketadventures.world")).toBe("production");
    expect(analyticsEnvironment("127.0.0.1")).toBe("development");
    expect(analyticsEnvironment("branch.vercel.app")).toBe("preview");
    expect(analyticsEnvironment("127.0.0.1", "staging")).toBe("staging");
  });
  it("only requests canvas replay for the staging demo and masks conversation text", () => {
    expect(stagingReplayConfig("production", "/demo/lim-bo-seng")).toEqual({});
    expect(stagingReplayConfig("staging", "/teacher")).toMatchObject({ disable_session_recording: true });
    expect(stagingReplayConfig("staging", "/demo/lim-bo-seng")).toMatchObject({
      disable_session_recording: false,
      session_recording: { maskAllInputs: true, captureCanvas: { recordCanvas: true } },
    });
  });
});

describe("demo events from committed actions", () => {
  it("tracks both chapters exactly once, rooms, sources, decisions and the first NPC exchange without student text", async () => {
    let state = newDemoV3State();
    const events: ReturnType<typeof demoActionEvents> = [];
    const client = createDemoV3Client(state, next => { state = next; }, async () =>
      new Response(JSON.stringify({ mode: "live", reply: "Private reply", sources: ["life"] })),
      { onCommitted: (before, after, action) => events.push(...demoActionEvents(before, after, action)) },
    );
    const act = async (action: Parameters<typeof client.act>[1]) => {
      expect((await client.act(state.revision, action)).ok).toBe(true);
    };
    expect((await client.act(999, { type: "continue" })).ok).toBe(false);
    expect((await client.act(0, { type: "enterRoom", roomId: "embark" })).ok).toBe(false);
    expect(events).toEqual([]);
    for (let chapter = 0; chapter < 2; chapter++) {
      await act({ type: "continue" });
      if (chapter === 1) await act({ type: "enterRoom", roomId: "shore" });
      const source = chapter === 0 ? "life" : "force";
      await act({ type: "openDocument", documentId: source });
      await act({ type: "selectPassage", documentId: source, start: 0, end: 30 });
      await act({ type: "closeDocument", documentId: source });
      for (let i = 0; i < 2; i++) await act({ type: "message", characterId: stages[chapter].npcs[0].id, text: "Private student text" });
      await act({ type: "endStage" });
      await act({ type: "act", actId: stages[chapter].choices[0].id });
      await act({ type: "enterRoom", roomId: chapter === 0 ? "street" : "coast" });
      await act({ type: "enterRoom", roomId: "embark" });
    }
    expect(events.filter(e => e.event === "demo_chapter_started").map(e => e.properties.chapter)).toEqual([1, 2]);
    expect(events.filter(e => e.event === "demo_chapter_completed").map(e => e.properties.chapter)).toEqual([1, 2]);
    expect(events.filter(e => e.event === "demo_npc_conversation_started")).toHaveLength(2);
    expect(events.filter(e => e.event === "demo_decision_submitted")).toHaveLength(2);
    expect(events.filter(e => e.event === "demo_room_entered")).toHaveLength(5);
    expect(JSON.stringify(events)).not.toMatch(/Private|prediction|messages|answers/);
  });
  it("telemetry failures cannot turn a committed action into a gameplay failure", async () => {
    const client = createDemoV3Client(newDemoV3State(), () => {}, fetch, { onCommitted: () => { throw new Error("analytics unavailable"); } });
    expect((await client.act(0, { type: "continue" })).ok).toBe(true);
    expect((await client.refresh()).revision).toBe(1);
  });
});
