import {
  PLAYER_ID,
  toResolverInput,
  toStageRuntime,
  type AdventureSpec,
  type StageRuntimeBundle,
} from "@adventure/generation";
import { loadI1Spec } from "@adventure/generation/fixtures";
import {
  applyAction,
  buildAgentTurnInput,
  createWorld,
  deriveOptions,
  FakeLlmClient,
  isAvailable,
  occupantsOf,
  publicResolution,
  resolveStageSync,
  runAgentTurn,
  StageDecisions,
  visibleTranscript,
  type ActorAction,
  type Decision,
  type ResolutionRecord,
  type Utterance,
  type WorldState,
} from "@adventure/orchestration";
import type {
  DecisionResponse,
  PublicActorCommitment,
  PublicAttemptState,
  PublicEffect,
  PublicMessage,
} from "./contract";

const MAX_RUNTIME_ATTEMPTS = 500;

export interface RuntimeSnapshot {
  version: 1;
  stageIndex: number;
  stageStartedAt: number;
  deadlineAt: number | null;
  revision: number;
  world: WorldState;
  decisions: Decision[];
  actions: ActorAction[];
  currentResolution: ResolutionRecord | null;
  resolutions: ResolutionRecord[];
  announcements: PublicAttemptState["announcements"];
  pendingEffects: PublicEffect[];
  dispositions: Record<string, number>;
  journal: PublicAttemptState["journal"];
  archivedTranscript: PublicMessage[];
  endingId: string | null;
}

export interface RuntimeAttempt {
  spec: AdventureSpec;
  bundle: StageRuntimeBundle;
  stageIndex: number;
  stageStartedAt: number;
  deadlineAt: number | null;
  revision: number;
  world: WorldState;
  ledger: StageDecisions;
  actions: ActorAction[];
  currentResolution: ResolutionRecord | null;
  resolutions: ResolutionRecord[];
  announcements: PublicAttemptState["announcements"];
  pendingEffects: PublicEffect[];
  dispositions: Record<string, number>;
  journal: PublicAttemptState["journal"];
  archivedTranscript: PublicMessage[];
  endingId: string | null;
}

const globalStore = globalThis as typeof globalThis & {
  __turnApiRuntimeAttempts?: Map<string, RuntimeAttempt>;
};
const attempts = (globalStore.__turnApiRuntimeAttempts ??= new Map<
  string,
  RuntimeAttempt
>());

export type PostMessageResult =
  | { ok: true; newMessages: PublicMessage[]; state: PublicAttemptState }
  | { ok: false; reason: "unknown_room" | "stage_closed" };

export type CommitDecisionResult = {
  resolution: DecisionResponse["resolution"];
  state: PublicAttemptState;
};

function createLedger(bundle: StageRuntimeBundle, decisions: readonly Decision[] = []): StageDecisions {
  return new StageDecisions(
    [
      { actorId: PLAYER_ID, actorKind: "player" },
      ...bundle.resolverAgents.map((agent) => ({ actorId: agent.id, actorKind: "agent" as const })),
    ],
    decisions,
  );
}

function stage(attempt: RuntimeAttempt) {
  const current = attempt.spec.stages[attempt.stageIndex];
  if (current === undefined) throw new Error(`spec has no stage ${attempt.stageIndex}`);
  return current;
}

function effectiveDeadline(spec: AdventureSpec, stageIndex: number, now: number): number | null {
  const seconds = spec.stages[stageIndex]?.timerSeconds ?? spec.defaultTimerSeconds;
  return seconds === 0 ? null : now + seconds * 1000;
}

function systemMessage(attemptId: string, attempt: RuntimeAttempt): PublicMessage {
  const current = stage(attempt);
  return {
    id: `${attemptId}-s${attempt.stageIndex}-system`,
    roomId: current.spawnRoomId,
    authorType: "system",
    authorId: null,
    authorName: null,
    body: current.sharedContext.text,
    createdAt: new Date(attempt.stageStartedAt).toISOString(),
  };
}

function publicMessage(
  attemptId: string,
  attempt: RuntimeAttempt,
  line: Utterance,
): PublicMessage {
  const actor = attempt.world.actors[line.speakerId];
  return {
    id: `${attemptId}-s${attempt.stageIndex}-u${line.seq}`,
    roomId: line.roomId,
    authorType: actor?.kind === "player" ? "player" : "agent",
    authorId: actor?.kind === "player" ? null : line.speakerId,
    authorName: actor?.name ?? line.speakerName,
    body: line.body,
    createdAt: new Date(attempt.stageStartedAt + line.seq).toISOString(),
  };
}

function currentTranscript(attemptId: string, attempt: RuntimeAttempt): PublicMessage[] {
  return [
    systemMessage(attemptId, attempt),
    ...visibleTranscript(attempt.world, PLAYER_ID).map((line) =>
      publicMessage(attemptId, attempt, line),
    ),
  ];
}

function enterStage(
  attemptId: string,
  attempt: RuntimeAttempt,
  stageIndex: number,
  now: number,
): void {
  if (attempt.stageIndex >= 0) {
    const archived = currentTranscript(attemptId, attempt);
    attempt.archivedTranscript = [...attempt.archivedTranscript, ...archived];
  }
  const bundle = toStageRuntime(attempt.spec, stageIndex);
  attempt.bundle = bundle;
  attempt.stageIndex = stageIndex;
  attempt.stageStartedAt = now;
  attempt.world = createWorld(bundle.world);
  attempt.ledger = createLedger(bundle);
  attempt.actions = [];
  attempt.currentResolution = null;
  attempt.deadlineAt = effectiveDeadline(attempt.spec, stageIndex, now);
}

export function createRuntimeAttempt(
  spec: AdventureSpec,
  stageIndex = 0,
  now = Date.now(),
  deadlineAt?: number | null,
): RuntimeAttempt {
  const bundle = toStageRuntime(spec, stageIndex);
  return {
    spec,
    bundle,
    stageIndex,
    stageStartedAt: now,
    deadlineAt: deadlineAt === undefined ? effectiveDeadline(spec, stageIndex, now) : deadlineAt,
    revision: 1,
    world: createWorld(bundle.world),
    ledger: createLedger(bundle),
    actions: [],
    currentResolution: null,
    resolutions: [],
    announcements: [],
    pendingEffects: [],
    dispositions: {},
    journal: [],
    archivedTranscript: [],
    endingId: null,
  };
}

function sameKeys(actual: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(actual).sort().join("\n") === [...expected].sort().join("\n");
}

export function restoreRuntimeAttempt(
  spec: AdventureSpec,
  snapshot: RuntimeSnapshot,
): RuntimeAttempt {
  if (snapshot.version !== 1) throw new Error(`unsupported runtime snapshot version ${snapshot.version}`);
  if (
    !Number.isInteger(snapshot.stageIndex) ||
    snapshot.stageIndex < 0 ||
    snapshot.stageIndex >= spec.stages.length
  ) {
    throw new Error(`invalid runtime snapshot stage index ${snapshot.stageIndex}`);
  }
  const bundle = toStageRuntime(spec, snapshot.stageIndex);
  const expectedRoomIds = bundle.world.rooms.map((room) => room.id);
  const expectedActorIds = bundle.world.actors.map((actor) => actor.id);
  const world = structuredClone(snapshot.world);
  if (!sameKeys(world.rooms, expectedRoomIds)) throw new Error("runtime snapshot room set does not match the stage");
  if (!sameKeys(world.actors, expectedActorIds)) throw new Error("runtime snapshot actor set does not match the stage");
  if (!sameKeys(world.location, expectedActorIds)) throw new Error("runtime snapshot placement does not match the stage");
  const currentStageId = spec.stages[snapshot.stageIndex]?.id;
  if (snapshot.currentResolution !== null && snapshot.currentResolution.stageId !== currentStageId) {
    throw new Error("runtime snapshot resolution does not match the active stage");
  }
  return {
    spec,
    bundle,
    stageIndex: snapshot.stageIndex,
    stageStartedAt: snapshot.stageStartedAt,
    deadlineAt: snapshot.deadlineAt,
    revision: snapshot.revision,
    world,
    ledger: createLedger(bundle, structuredClone(snapshot.decisions)),
    actions: structuredClone(snapshot.actions),
    currentResolution: structuredClone(snapshot.currentResolution),
    resolutions: structuredClone(snapshot.resolutions),
    announcements: structuredClone(snapshot.announcements),
    pendingEffects: structuredClone(snapshot.pendingEffects),
    dispositions: structuredClone(snapshot.dispositions),
    journal: structuredClone(snapshot.journal),
    archivedTranscript: structuredClone(snapshot.archivedTranscript),
    endingId: snapshot.endingId,
  };
}

export function snapshotRuntimeAttempt(attempt: RuntimeAttempt): RuntimeSnapshot {
  return structuredClone({
    version: 1 as const,
    stageIndex: attempt.stageIndex,
    stageStartedAt: attempt.stageStartedAt,
    deadlineAt: attempt.deadlineAt,
    revision: attempt.revision,
    world: attempt.world,
    decisions: attempt.ledger.all(),
    actions: attempt.actions,
    currentResolution: attempt.currentResolution,
    resolutions: attempt.resolutions,
    announcements: attempt.announcements,
    pendingEffects: attempt.pendingEffects,
    dispositions: attempt.dispositions,
    journal: attempt.journal,
    archivedTranscript: attempt.archivedTranscript,
    endingId: attempt.endingId,
  });
}

function applyAndRecord(attempt: RuntimeAttempt, action: ActorAction): { ok: true } | { ok: false } {
  const result = applyAction(attempt.world, action);
  if (!result.ok) return { ok: false };
  attempt.actions.push(action);
  return { ok: true };
}

function addRoomEvidence(attempt: RuntimeAttempt, roomId: string): void {
  const known = new Set(attempt.world.evidenceKnown[PLAYER_ID] ?? []);
  const journalIds = new Set(attempt.journal.map((entry) => entry.id));
  for (const evidence of stage(attempt).evidence) {
    if (evidence.roomId !== roomId || known.has(evidence.id)) continue;
    known.add(evidence.id);
    if (journalIds.has(evidence.id)) continue;
    const span = evidence.content.spans[0];
    attempt.journal.push({
      id: evidence.id,
      text: evidence.content.text,
      sourceSpan: span === undefined ? null : `${span.sourceId}, p. ${span.page}`,
      collectedAt: new Date().toISOString(),
    });
    journalIds.add(evidence.id);
  }
  attempt.world.evidenceKnown[PLAYER_ID] = [...known];
}

function objectiveMet(
  attempt: RuntimeAttempt,
  objectiveId: string,
  visiting: Set<string>,
): boolean {
  if (visiting.has(objectiveId)) return false;
  const objective = stage(attempt).objectives.find((candidate) => candidate.id === objectiveId);
  if (objective === undefined) return false;
  const nextVisiting = new Set(visiting).add(objectiveId);
  if (!objective.requires.every((required) => objectiveMet(attempt, required, nextVisiting))) {
    return false;
  }
  const known = new Set(attempt.world.evidenceKnown[PLAYER_ID] ?? []);
  if (known.has(objective.targetId)) return true;
  return visibleTranscript(attempt.world, PLAYER_ID).some(
    (line) => line.speakerId === objective.targetId || line.addresseeId === objective.targetId,
  );
}

function projectOptions(attempt: RuntimeAttempt) {
  const closed = attempt.endingId !== null || attempt.currentResolution !== null;
  const live = deriveOptions(attempt.world, attempt.bundle.options, PLAYER_ID);
  return attempt.bundle.options.map((option) => {
    const available =
      !closed &&
      live.options.some((candidate) => candidate.id === option.id) &&
      isAvailable(attempt.world, option);
    return {
      id: option.id,
      label: option.label,
      available,
      unavailableReason: available
        ? null
        : closed
          ? "Your decision for this stage is already recorded."
          : "Complete its prerequisites first.",
    };
  });
}

function projectCommitments(attempt: RuntimeAttempt): PublicActorCommitment[] {
  return [
    {
      actorKind: "player",
      actorId: PLAYER_ID,
      actorName: attempt.world.actors[PLAYER_ID]?.name ?? PLAYER_ID,
      committed: attempt.ledger.has(PLAYER_ID),
    },
    ...attempt.bundle.resolverAgents.map((agent) => ({
      actorKind: "agent" as const,
      actorId: agent.id,
      actorName: attempt.world.actors[agent.id]?.name ?? agent.name,
      committed: attempt.ledger.has(agent.id),
    })),
  ];
}

export function projectRuntimeState(attemptId: string, attempt: RuntimeAttempt): PublicAttemptState {
  const currentStage = stage(attempt);
  const now = Date.now();
  const timerEnabled = attempt.deadlineAt !== null;
  const secondsRemaining = timerEnabled
    ? Math.max(0, Math.round((attempt.deadlineAt! - now) / 1000))
    : null;
  const authoredRooms = new Map(currentStage.rooms.map((room) => [room.id, room]));
  const rooms = Object.values(attempt.world.rooms).map((room) => ({
    id: room.id,
    name: room.name,
    purpose: authoredRooms.get(room.id)?.purpose ?? null,
    doorOpen: room.doorOpen,
    occupantIds: occupantsOf(attempt.world, room.id).map((actor) => actor.id),
  }));
  const agents = currentStage.agents.map((specAgent) => {
    const actor = attempt.world.actors[specAgent.id];
    const stakeholder = attempt.spec.stakeholders.find(
      (candidate) => candidate.id === specAgent.stakeholderId,
    );
    return {
      id: specAgent.id,
      name: stakeholder?.name ?? actor?.name ?? specAgent.id,
      role: stakeholder?.role ?? actor?.publicRole ?? null,
      publicPosition: specAgent.publicPosition.text,
      roomId: attempt.world.location[specAgent.id] ?? null,
      portraitUrl: null,
    };
  });
  const overlay = currentStage.ambientOverlay ?? attempt.spec.ambientOverlay;
  const archivedAndCurrent = [
    ...attempt.archivedTranscript,
    ...currentTranscript(attemptId, attempt),
  ];
  return {
    attemptId,
    adventureId: attempt.spec.id,
    publishedVersion: 1,
    status: attempt.endingId === null ? "active" : "completed",
    stage: {
      id: currentStage.id,
      index: currentStage.index,
      title: currentStage.title,
      sharedContext: currentStage.sharedContext.text,
      ambientOverlay: overlay.id,
      overlayIntensity: overlay.intensity,
      objectives: currentStage.objectives.map((objective) => ({
        id: objective.id,
        title: objective.title,
        met: objectiveMet(attempt, objective.id, new Set()),
      })),
    },
    timer: {
      enabled: timerEnabled,
      deadlineAt: timerEnabled ? new Date(attempt.deadlineAt!).toISOString() : null,
      serverNow: new Date(now).toISOString(),
      secondsRemaining,
    },
    mapArtifactId: null,
    playerPos: null,
    currentRoomId: attempt.world.location[PLAYER_ID] ?? null,
    rooms,
    agents,
    transcript: archivedAndCurrent,
    journal: attempt.journal,
    options: projectOptions(attempt),
    commitments: projectCommitments(attempt),
    announcements: attempt.announcements,
    pendingEffects: attempt.pendingEffects,
    revision: attempt.revision,
  };
}

function resolveCurrent(
  attemptId: string,
  attempt: RuntimeAttempt,
  optionId: string | null,
): DecisionResponse["resolution"] {
  const record = resolveStageSync(
    toResolverInput(attempt.spec, attempt.bundle, {
      attemptId,
      seed: `turn-api:${attemptId}`,
      resolvedAt: new Date().toISOString(),
      optionId,
      actions: attempt.actions,
      evidenceCollected: (attempt.world.evidenceKnown[PLAYER_ID] ?? []).length,
      dispositions: attempt.dispositions,
      decisions: attempt.ledger.all(),
    }),
  ).record;
  attempt.currentResolution = record;
  attempt.resolutions.push(record);
  for (const delta of record.outcome.agentDeltas) {
    attempt.dispositions[delta.agentId] = delta.disposition;
  }
  const projected = publicResolution(record);
  attempt.announcements = [
    ...attempt.announcements,
    {
      id: `${attemptId}-a${attempt.announcements.length + 1}`,
      body: projected.announcement,
      createdAt: record.resolvedAt,
    },
  ];
  attempt.pendingEffects = projected.effects;
  attempt.revision += 1;
  const next = record.outcome.next;
  if (next.kind === "stage") {
    const nextIndex = attempt.spec.stages.findIndex((candidate) => candidate.id === next.stageId);
    if (nextIndex < 0) throw new Error(`unknown authored stage target "${next.stageId}"`);
    enterStage(attemptId, attempt, nextIndex, Date.now());
  } else if (next.kind === "ending") {
    attempt.endingId = next.endingId;
  } else {
    throw new Error("stage resolution cannot continue without a stage or ending target");
  }
  return projected;
}

export function expireRuntimeAttemptIfNeeded(
  attemptId: string,
  attempt: RuntimeAttempt,
  now = Date.now(),
): boolean {
  if (attempt.endingId !== null || attempt.currentResolution !== null) return false;
  if (attempt.deadlineAt === null || now < attempt.deadlineAt) return false;
  for (const decision of attempt.ledger.expire()) {
    attempt.actions.push({
      actorKind: decision.actorKind,
      actorId: decision.actorId,
      action: { type: "pass" },
    });
  }
  resolveCurrent(attemptId, attempt, null);
  return true;
}

export function setRuntimeAttemptDeadline(attempt: RuntimeAttempt, deadlineAt: number | null): void {
  attempt.deadlineAt = deadlineAt;
}

export async function postMessageToRuntimeAttempt(
  attemptId: string,
  attempt: RuntimeAttempt,
  roomId: string,
  body: string,
): Promise<PostMessageResult> {
  if (attempt.endingId !== null || attempt.currentResolution !== null) {
    return { ok: false, reason: "stage_closed" };
  }
  const room = attempt.world.rooms[roomId];
  if (room === undefined) return { ok: false, reason: "unknown_room" };
  const respondent = occupantsOf(attempt.world, roomId).find((actor) => actor.kind === "agent");
  if (respondent === undefined) return { ok: false, reason: "unknown_room" };
  const beforeSeq = attempt.world.seq;
  if (attempt.world.location[PLAYER_ID] !== roomId) {
    if (!room.doorOpen) {
      const openDoor: ActorAction = {
        actorKind: "agent",
        actorId: respondent.id,
        action: { type: "open_door", roomId },
      };
      if (!applyAndRecord(attempt, openDoor).ok) return { ok: false, reason: "unknown_room" };
    }
    const move: ActorAction = {
      actorKind: "player",
      actorId: PLAYER_ID,
      action: { type: "move_room", toRoomId: roomId },
    };
    if (!applyAndRecord(attempt, move).ok) return { ok: false, reason: "unknown_room" };
  }
  addRoomEvidence(attempt, roomId);
  const playerSpeech: ActorAction = {
    actorKind: "player",
    actorId: PLAYER_ID,
    action: {
      type: "speak",
      roomId,
      body,
      addresseeId: respondent.id,
    },
  };
  if (!applyAndRecord(attempt, playerSpeech).ok) return { ok: false, reason: "unknown_room" };
  const config = {
    ...attempt.bundle.stage,
    decision: { catalogue: attempt.bundle.options, ledger: attempt.ledger },
  };
  const specAgent = stage(attempt).agents.find((agent) => agent.id === respondent.id);
  if (specAgent === undefined) throw new Error(`active stage has no authored agent "${respondent.id}"`);
  const reply = JSON.stringify({ say: `I stand by this: ${specAgent.publicPosition.text}`, actions: [] });
  const turn = await runAgentTurn(
    new FakeLlmClient({ replies: [reply] }),
    buildAgentTurnInput(attempt.world, respondent.id, config, 6),
  );
  for (const action of turn.actions) applyAndRecord(attempt, action);
  attempt.revision += 1;
  const newMessages = visibleTranscript(attempt.world, PLAYER_ID)
    .filter((line) => line.seq > beforeSeq)
    .map((line) => publicMessage(attemptId, attempt, line));
  return { ok: true, newMessages, state: projectRuntimeState(attemptId, attempt) };
}

export async function commitRuntimeAttemptDecision(
  attemptId: string,
  attempt: RuntimeAttempt,
  optionId: string,
): Promise<CommitDecisionResult | null> {
  if (attempt.endingId !== null || attempt.currentResolution !== null) return null;
  const live = deriveOptions(attempt.world, attempt.bundle.options, PLAYER_ID);
  const option = attempt.bundle.options.find((candidate) => candidate.id === optionId);
  if (
    option === undefined ||
    !live.options.some((candidate) => candidate.id === optionId) ||
    !isAvailable(attempt.world, option)
  ) {
    return null;
  }
  const playerAction: ActorAction = {
    actorKind: "player",
    actorId: PLAYER_ID,
    action: { type: "commit_decision", optionId, optionsVersion: live.version },
  };
  const playerDecision = attempt.ledger.commit(attempt.world, attempt.bundle.options, {
    actorId: PLAYER_ID,
    actorKind: "player",
    optionId,
    optionsVersion: live.version,
  });
  if (!playerDecision.ok) return null;
  attempt.actions.push(playerAction);
  for (const agent of attempt.bundle.resolverAgents) {
    if (attempt.ledger.has(agent.id)) continue;
    const agentOptions = deriveOptions(attempt.world, attempt.bundle.options, agent.id);
    const first = agentOptions.options.find((candidate) => {
      const definition = attempt.bundle.options.find((optionDefinition) => optionDefinition.id === candidate.id);
      return definition !== undefined && isAvailable(attempt.world, definition);
    });
    if (first === undefined) {
      const passed = attempt.ledger.pass(agent.id);
      if (!passed.ok) throw new Error(`could not pass active-stage agent "${agent.id}"`);
      attempt.actions.push({ actorKind: "agent", actorId: agent.id, action: { type: "pass" } });
      continue;
    }
    const agentAction: ActorAction = {
      actorKind: "agent",
      actorId: agent.id,
      action: {
        type: "commit_decision",
        optionId: first.id,
        optionsVersion: agentOptions.version,
      },
    };
    const agentDecision = attempt.ledger.commit(attempt.world, attempt.bundle.options, {
      actorId: agent.id,
      actorKind: "agent",
      optionId: first.id,
      optionsVersion: agentOptions.version,
    });
    if (!agentDecision.ok) throw new Error(`could not commit active-stage agent "${agent.id}"`);
    attempt.actions.push(agentAction);
  }
  const resolution = resolveCurrent(attemptId, attempt, optionId);
  return { resolution, state: projectRuntimeState(attemptId, attempt) };
}

async function seed(attemptId: string): Promise<RuntimeAttempt> {
  const spec = await loadI1Spec();
  const attempt = createRuntimeAttempt(spec);
  attempts.set(attemptId, attempt);
  while (attempts.size > MAX_RUNTIME_ATTEMPTS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
  return attempt;
}

async function get(attemptId: string): Promise<RuntimeAttempt> {
  const attempt = attempts.get(attemptId) ?? (await seed(attemptId));
  expireRuntimeAttemptIfNeeded(attemptId, attempt);
  return attempt;
}

export async function runtimeState(attemptId: string): Promise<PublicAttemptState> {
  const attempt = await get(attemptId);
  return projectRuntimeState(attemptId, attempt);
}

export async function postRuntimeMessage(
  attemptId: string,
  roomId: string,
  body: string,
): Promise<PostMessageResult> {
  const attempt = await get(attemptId);
  return postMessageToRuntimeAttempt(attemptId, attempt, roomId, body);
}

export async function commitRuntimeDecision(
  attemptId: string,
  optionId: string,
): Promise<CommitDecisionResult | null> {
  const attempt = await get(attemptId);
  return commitRuntimeAttemptDecision(attemptId, attempt, optionId);
}

export function expireRuntimeDeadline(attemptId: string): void {
  const attempt = attempts.get(attemptId);
  if (attempt === undefined) throw new Error(`cannot expire unknown runtime attempt "${attemptId}"`);
  if (attempt.deadlineAt !== null) setRuntimeAttemptDeadline(attempt, Date.now() - 1);
}

export function resetRuntime(): void {
  attempts.clear();
}
