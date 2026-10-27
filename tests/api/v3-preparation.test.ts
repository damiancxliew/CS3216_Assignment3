import { describe, expect, it } from "vitest";
import { FakeLlmClient, type LlmRequest } from "@adventure/orchestration";
import type { Action, PlayerView } from "@adventure/play-contract";
import { checkSpec } from "@adventure/spec-v3";
import { createAttempt, getAttempt, postAction, runPostTurnChecks, type V3PlayServiceDeps } from "@/lib/play/v3/service";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { preparationAdventure } from "../fixtures/v3-preparation";

async function session() {
  const { spec, support } = preparationAdventure();
  expect(checkSpec(spec).errors).toEqual([]);
  const store = new MemoryV3PlayStore();
  store.addAdventure({ id: "prepared", schoolId: "school", ownerId: "teacher", status: "published", specVersion: 1, spec });
  store.addMember("school", "student");
  const llm = new FakeLlmClient({ replies: [(request: LlmRequest) => {
    if (request.schemaName !== "v3_post_turn_check") return JSON.stringify({ reply: "Raffles signed the treaty. The captain described the Riau routes." });
    const schema = request.jsonSchema as { properties: { conveyed: { items: { enum?: string[] } } } };
    return JSON.stringify({ conveyed: schema.properties.conveyed.items.enum ?? [], substantive: !request.user.includes("Hello"), assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: "none", reason: null } });
  }] });
  let time = 1000;
  const deps: V3PlayServiceDeps = { store, llm: () => llm, now: () => time, env: { V3_ENABLED: "1", V3_SCHOOL_IDS: "school", V3_RATE_LIMIT_PER_10S: "100" } };
  const created = await createAttempt(deps, "student", "prepared");
  const id = created.body.attemptId as string;
  let revision = created.body.revision as number;
  async function send(action: Action, expected = 200) {
    const result = await postAction(deps, "student", id, { revision, action });
    expect(result.status).toBe(expected);
    if (result.status === 200) revision = result.body.revision as number;
    return result;
  }
  async function check() {
    const attempt = await store.loadAttempt(id);
    const pending = (attempt!.state as { pendingChecks: { messageId: string }[] }).pendingChecks.map(p => p.messageId);
    await runPostTurnChecks(deps, id, pending);
    revision = (await store.loadAttempt(id))!.revision;
  }
  await send({ type: "continue" });
  await send({ type: "continue" });
  await send({ type: "openDocument", documentId: "doc-1" });
  return { spec, store, deps, id, send, check, support, revision: () => revision, setTime: (value: number) => { time = value; } };
}

const answer = (selection: { start: number; end: number }, questionId = "check-1", recovery = false): Action => ({ type: "submitReadingCheck", documentId: "doc-1", questionId, choiceId: "supported", ...selection, recovery });

describe("prepared v3 attempts through the action service", () => {
  it("persists a failed first response and correction through resume without leaking private marking", async () => {
    const game = await session();
    await game.send(answer({ start: 0, end: game.spec.documents[0]!.body.length }));
    const resumed = await createAttempt(game.deps, "student", "prepared");
    const view = resumed.body.view as PlayerView;
    expect(view.documents[0]?.readingCheck?.status).toBe("needsReview");
    expect(JSON.stringify(resumed.body)).not.toMatch(/correctOptionId|recoveryDiscoveryIds|"support":|check-2/);
    expect(view.notes).toEqual([]);
    await game.send(answer(game.support), 409);
    await game.send(answer(game.support, "correction", true));
    await game.send(answer(game.support, "check-2"));
    const loaded = await game.store.loadAttempt(game.id);
    const history = (loaded!.state as { readingChecks: Record<string, { attempts: { correct: boolean }[] }> }).readingChecks["doc-1"]!.attempts;
    expect(history.map(attempt => attempt.correct)).toEqual([false, true, true]);
    expect((await getAttempt(game.deps, "another-student", game.id)).status).toBe(404);
  });

  it("serializes simultaneous submissions and rejects forged marking keys", async () => {
    const game = await session();
    const request = { revision: game.revision(), action: answer(game.support) };
    const responses = await Promise.all([postAction(game.deps, "student", game.id, request), postAction(game.deps, "student", game.id, request)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(game.store.savedEvents.flatMap(batch => batch.events).filter(event => event.type === "discovery")).toHaveLength(1);
    expect((await postAction(game.deps, "student", game.id, { revision: game.revision(), action: { ...answer(game.support), correct: true } })).status).toBe(400);
  });

  it("requires both essential exchanges after delayed checks, including at timer expiry", async () => {
    const game = await session();
    await game.send({ type: "message", characterId: "char-nakhoda", text: "What do your routes reveal?" }, 409);
    await game.send(answer(game.support));
    await game.send({ type: "closeDocument", documentId: "doc-1" });
    await game.send({ type: "message", characterId: "char-nakhoda", text: "Hello" });
    await game.check();
    await game.send({ type: "endStage" }, 409);
    game.setTime(2_000_000);
    await game.send({ type: "tick" });
    await game.send({ type: "message", characterId: "char-nakhoda", text: "Why do the Riau routes matter to your trade?" });
    await game.check();
    await game.send({ type: "endStage" }, 409);
    await game.send({ type: "enterRoom", roomId: "room-office" });
    await game.send({ type: "message", characterId: "char-farquhar", text: "What does the treaty reveal about Raffles's role?" });
    await game.send({ type: "endStage" }, 409);
    await game.check();
    const result = await game.send({ type: "endStage" });
    expect((result.body.view as PlayerView).definingMoment?.status).toBe("choosing");
  });
});
