import { loadI1Spec } from "@adventure/generation/fixtures";
import { describe, expect, it, vi } from "vitest";

import { PlaySession } from "@/lib/play/session";
import { applyEditToSpec } from "@/lib/teacher/edit-spec";
import { findForbiddenKeys } from "@/lib/turn-api/contract";

const timer = { enabled: false, deadlineAt: null };

describe("prepared scrolls", () => {
  it("preloads teacher-edited text in range and saves exactly that text without generation", async () => {
    const original = await loadI1Spec();
    const stage = original.stages[0]!;
    const item = stage.evidence[0]!;
    const edited = applyEditToSpec(original, {
      kind: "evidence", stageId: stage.id, evidenceId: item.id,
      name: "Teacher's scroll", text: "The teacher's reviewed facts.\n\nConsider who benefits.",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.spec.stages[0]!.evidence[0]!.content.spans).toEqual(item.content.spans);
    expect(original.stages[0]!.evidence[0]).toEqual(item);

    const session = PlaySession.start(edited.spec, "prepared-scroll", 1);
    const prop = session.state(timer).props.find((candidate) => candidate.id === item.id)!;
    // Place the player at the document without collecting it, to isolate projection from pickup.
    session.world.spatial!.state.actors.player = { ...prop.position };
    session.world.location.player = item.roomId;
    const nearby = session.state(timer);
    const prepared = nearby.evidenceHere.find((candidate) => candidate.id === item.id)!;
    expect(prepared.canInspect).toBe(true);
    expect(prepared.content?.text).toBe("Teacher's scroll: The teacher's reviewed facts.\n\nConsider who benefits.");
    expect(nearby.journal).toEqual([]);
    expect(session.snapshot().stageStats.evidence).toBe(0);
    expect(findForbiddenKeys(nearby)).toEqual([]);

    const complete = vi.fn(async () => { throw new Error("Reading a scroll must not generate text"); });
    const llm = { complete };
    expect(await session.action(llm, { type: "inspect", evidenceId: item.id })).toEqual({ ok: true, refused: null });
    expect(session.state(timer).journal[0]).toMatchObject({ id: item.id, ...prepared.content });
    expect(session.state(timer).evidenceHere.some((candidate) => candidate.id === item.id)).toBe(false);
    await session.action(llm, { type: "inspect", evidenceId: item.id });
    expect(session.snapshot().stageStats.evidence).toBe(1);
    expect(complete).not.toHaveBeenCalled();
    const resumed = PlaySession.resume(edited.spec, "prepared-scroll", 1, session.snapshot());
    expect(resumed.state(timer).journal).toEqual(session.state(timer).journal);
  });

  it("withholds prepared text outside reading range and from other stages", async () => {
    const spec = await loadI1Spec();
    const session = PlaySession.start(spec, "distant-scroll", 1);
    const item = spec.stages[0]!.evidence[0]!;
    // Keep the room label while the authoritative tile is far away: labels cannot unlock text.
    session.world.location.player = item.roomId;
    session.world.spatial!.state.actors.player = { x: -100, y: -100 };
    const state = session.state(timer);
    expect(state.evidenceHere.find((candidate) => candidate.id === item.id)).toMatchObject({ canInspect: false });
    expect(state.evidenceHere.every((candidate) => candidate.content === undefined)).toBe(true);
    expect(state.props.every((candidate) => !("content" in candidate))).toBe(true);
    const currentIds = new Set(spec.stages[0]!.evidence.map((candidate) => candidate.id));
    expect(state.evidenceHere.every((candidate) => currentIds.has(candidate.id))).toBe(true);
  });
});
