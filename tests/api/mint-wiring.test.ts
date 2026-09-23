import { loadI1Spec } from "@adventure/generation/fixtures";
import { auditClientPayload, FakeLlmClient, type LlmClient } from "@adventure/orchestration";
import type { AdventureSpec } from "@adventure/generation/spec";
import { beforeAll, describe, expect, it } from "vitest";

import { getState, postDecision, postMessage, type PlayServiceDeps } from "@/lib/play/service";
import { MemoryPlayStore, type AttemptRecord } from "@/lib/play/store";
import { PlaySession } from "@/lib/play/session";

const STUDENT = "student-mint";

let spec: AdventureSpec;

function record(attemptId: string): AttemptRecord {
  return {
    attemptId,
    studentId: STUDENT,
    adventureId: spec.id,
    publishedVersion: 1,
    status: "active",
    stageDeadlineAt: null,
    spec,
    snapshot: null,
    runtimeRevision: 0,
  };
}

function mintReply(labels: readonly string[] = ["Offer a temporary anchorage"]): string {
  return JSON.stringify(labels.map((label) => ({
    label,
    stance: "cooperative",
    branchTargetKey: "opt-sign-preliminary",
    preconditions: [{ kind: "actor_in_room", actorId: "player", roomId: "landing-beach" }],
    why: "The public exchange opened this route.",
  })));
}

function deps(attemptId: string, replies: readonly string[]): { d: PlayServiceDeps; store: MemoryPlayStore; llm: FakeLlmClient } {
  const store = new MemoryPlayStore([record(attemptId)]);
  const llm = new FakeLlmClient({ replies });
  return { d: { store, llm }, store, llm };
}

async function addPublicLines(d: PlayServiceDeps, store: MemoryPlayStore, attemptId: string, count = 6): Promise<Awaited<ReturnType<typeof postMessage>>> {
  let now = store.clock().getTime();
  now += 5000;
  store.clock = () => new Date(now);
  let result: Awaited<ReturnType<typeof postMessage>> = await postMessage(d, attemptId, STUDENT, { roomId: "landing-beach", body: "The negotiation continues." });
  for (let index = 1; index < count; index += 1) {
    now += 5000;
    store.clock = () => new Date(now);
    result = await postMessage(d, attemptId, STUDENT, { roomId: "landing-beach", body: `The negotiation continues, line ${index}.` });
  }
  return result;
}

beforeAll(async () => {
  spec = await loadI1Spec();
});

describe("in-memory Resolver option minting", () => {
  it("mints after enough public lines, exposes an available option, and changes the version", async () => {
    const { d, store, llm } = deps("mint-visible", [mintReply(), JSON.stringify({ say: "", actions: [{ type: "yield" }] })]);
    const initial = await getState(d, "mint-visible", STUDENT);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const after = await addPublicLines(d, store, "mint-visible");
    expect(after.ok, JSON.stringify(after)).toBe(true);
    if (!after.ok) return;
    const minted = after.state.options.find((option) => option.id.startsWith("minted-"));
    expect(minted).toMatchObject({ available: true });
    expect(after.state.optionsVersion).not.toBe(initial.state.optionsVersion);
    expect(llm.requests).toHaveLength(1);
  });

  it("keeps reads side-effect-free and resumes minted ids and versions", async () => {
    const { d, store, llm } = deps("mint-resume", [mintReply()]);
    const after = await addPublicLines(d, store, "mint-resume");
    expect(after.ok, JSON.stringify(after)).toBe(true);
    if (!after.ok) return;
    const requestsBeforeRead = llm.requests.length;
    const resumed = await getState(d, "mint-resume", STUDENT);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.state.options.filter((option) => option.id.startsWith("minted-")).map((option) => option.id))
      .toEqual(after.state.options.filter((option) => option.id.startsWith("minted-")).map((option) => option.id));
    expect(resumed.state.optionsVersion).toBe(after.state.optionsVersion);
    expect(llm.requests).toHaveLength(requestsBeforeRead);
    expect(store.saved.at(-1)?.snapshot.mintedOptions?.map((option) => option.id)).toEqual(
      after.state.options.filter((option) => option.id.startsWith("minted-")).map((option) => option.id),
    );
  });

  it("commits a minted option, follows its authored branch, caps minting, and clears it on the next stage", async () => {
    const { d, store } = deps("mint-commit", [
      mintReply(["Offer a temporary anchorage"]),
      mintReply(["Open a second channel", "Invent a third route"]),
    ]);
    const after = await addPublicLines(d, store, "mint-commit");
    expect(after.ok, JSON.stringify(after)).toBe(true);
    if (!after.ok) return;
    const secondRound = await addPublicLines(d, store, "mint-commit");
    expect(secondRound.ok, JSON.stringify(secondRound)).toBe(true);
    if (!secondRound.ok) return;
    const minted = secondRound.state.options.filter((option) => option.id.startsWith("minted-"));
    expect(minted).toHaveLength(2);
    expect(minted.every((option) => option.available)).toBe(true);

    const committed = await postDecision(d, "mint-commit", STUDENT, {
      optionId: minted[0]!.id,
      optionsVersion: secondRound.state.optionsVersion,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.state.stage.index).toBe(1);
    expect(committed.state.options.every((option) => !option.id.startsWith("minted-"))).toBe(true);
    expect(committed.value.nextStageId).toBe("stage-sultan");
  });

  it("swallows garbage mint output and still completes the turn", async () => {
    const { d, store, llm } = deps("mint-garbage", ["not json"]);
    const result = await addPublicLines(d, store, "mint-garbage");

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.state.options.some((option) => option.id.startsWith("minted-"))).toBe(false);
    expect(llm.requests).toHaveLength(3);
  });

  it("counts mint tokens against stage telemetry and keeps the minted state auditable", async () => {
    const { d, store } = deps("mint-budget", [mintReply()]);
    const result = await addPublicLines(d, store, "mint-budget");

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const snapshot = store.saved.at(-1)!.snapshot;
    expect(snapshot.tokensSpent).toBeGreaterThan(0);
    expect(snapshot.stageStats.tokens).toBe(snapshot.tokensSpent);
    const secrets = spec.stages.flatMap((stage) => stage.agents.flatMap((agent) => [
      agent.privateContext.persona,
      agent.privateContext.motivations,
      agent.privateContext.hiddenInterests,
      agent.privateContext.knowledgeHorizon,
    ]));
    expect(auditClientPayload({ state: result.state }, secrets).ok).toBe(true);
  });

  it("swallows a throwing mint client", async () => {
    const store = new MemoryPlayStore([record("mint-throw")]);
    const client: LlmClient = { complete: async () => { throw new Error("model unavailable"); } };
    const d: PlayServiceDeps = { store, llm: client };
    const result = await addPublicLines(d, store, "mint-throw");

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.state.options.some((option) => option.id.startsWith("minted-"))).toBe(false);
  });

  it("does not mint after a refused move", async () => {
    let now = Date.parse("2026-09-22T12:00:00.000Z");
    const session = PlaySession.start(spec, "mint-refused-move", 1, { now: () => new Date(now) });
    for (let index = 0; index < 6; index += 1) {
      const message = session.beginMessage({ roomId: "landing-beach", body: `A public line ${index}.` });
      expect(message.ok).toBe(true);
      now += 1000;
    }
    const before = session.snapshot();
    const client = new FakeLlmClient({ replies: [mintReply()] });
    const refused = await session.action(client, {
      type: "move_step",
      stageId: spec.stages[before.stageIndex]!.id,
      from: before.playerPos!,
      to: { x: before.playerPos!.x + 99, y: before.playerPos!.y + 99 },
    });

    expect(refused).toMatchObject({ ok: true, refused: expect.any(String) });
    expect(client.requests).toHaveLength(0);
    expect(session.snapshot().mintedAtSeq).toBe(before.mintedAtSeq);
  });
});
