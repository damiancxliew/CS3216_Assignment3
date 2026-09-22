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
  type AgentPrivateContext,
  type DecisionStance,
  type OptionDefinition,
  type ResolutionRecord,
  type StageConfig,
  type WorldState,
} from "@adventure/orchestration";
import type {
  DecisionResponse,
  PublicActorCommitment,
  PublicAttemptState,
  PublicEffect,
  PublicMessage,
} from "./contract";

const STUB_ADVENTURE_ID = "00000000-0000-4000-8000-000000000001";
const STUB_STAGE_ID = "00000000-0000-4000-8000-000000000010";
const STUB_NEXT_STAGE_ID = "00000000-0000-4000-8000-000000000011";
const STUB_ROOM_CHAMBER = "00000000-0000-4000-8000-000000000020";
const STUB_ROOM_ANTEROOM = "00000000-0000-4000-8000-000000000021";
const STUB_AGENT_ENVOY = "00000000-0000-4000-8000-000000000030";
const STUB_AGENT_GENERAL = "00000000-0000-4000-8000-000000000031";
const STUB_TIMER_SECONDS = 600;
const PLAYER_ACTOR_ID = "player";
const ENVOY_SECRET = "The coastal delegation will accept a seven-day pause.";
const GENERAL_SECRET = "The garrison has only six days of grain remaining.";

const OPTION_CATALOGUE: OptionDefinition[] = [
  {
    id: "option-support-blockade",
    label: "Vote for the blockade",
    preconditions: [],
  },
  {
    id: "option-broker-truce",
    label: "Broker a truce between the envoy and the general",
    preconditions: [
      {
        kind: "actors_together",
        actorId: PLAYER_ACTOR_ID,
        otherActorId: STUB_AGENT_GENERAL,
      },
    ],
  },
  {
    id: "option-abstain",
    label: "Abstain and keep listening",
    preconditions: [],
  },
];

const OPTION_STANCES: Record<string, DecisionStance> = {
  "option-support-blockade": "antagonistic",
  "option-broker-truce": "cooperative",
  "option-abstain": "evasive",
};

const AGENT_VOTES: Record<string, string> = {
  [STUB_AGENT_GENERAL]: "option-support-blockade",
  [STUB_AGENT_ENVOY]: "option-abstain",
};

const AGENT_CONTEXTS: Record<string, AgentPrivateContext> = {
  [STUB_AGENT_ENVOY]: {
    agentId: STUB_AGENT_ENVOY,
    motivations: ["Keep grain convoys moving through the strait."],
    secrets: [ENVOY_SECRET],
    knowledgeHorizon: "Only what the envoy has seen or heard in the council chamber.",
    notes: [],
  },
  [STUB_AGENT_GENERAL]: {
    agentId: STUB_AGENT_GENERAL,
    motivations: ["Protect the garrison before its supplies run out."],
    secrets: [GENERAL_SECRET],
    knowledgeHorizon: "Only what the general has seen or heard in the anteroom.",
    notes: [],
  },
};

const globalStore = globalThis as typeof globalThis & {
  __turnApiRuntimeAttempts?: Map<string, RuntimeAttempt>;
};
const attempts = (globalStore.__turnApiRuntimeAttempts ??= new Map<
  string,
  RuntimeAttempt
>());
const MAX_RUNTIME_ATTEMPTS = 500;

export type PostMessageResult =
  | { ok: true; newMessages: PublicMessage[]; state: PublicAttemptState }
  | { ok: false; reason: "unknown_room" | "stage_closed" };

export type CommitDecisionResult = {
  resolution: DecisionResponse["resolution"];
  state: PublicAttemptState;
};

type RuntimeAttempt = {
  createdAt: number;
  deadlineAt: number;
  revision: number;
  world: WorldState;
  ledger: StageDecisions;
  actions: ActorAction[];
  resolution: ResolutionRecord | null;
  announcements: PublicAttemptState["announcements"];
  pendingEffects: PublicEffect[];
  dispositions: Record<string, number>;
};

function stageConfig(ledger: StageDecisions): StageConfig {
  return {
    sharedContext:
      "Three weeks into the crisis, the council must decide whether to close the strait.",
    stageBrief: "The council is deciding whether to close the strait before the fleet arrives.",
    decision: { catalogue: OPTION_CATALOGUE, ledger },
    agents: {
      [STUB_AGENT_ENVOY]: { privateContext: AGENT_CONTEXTS[STUB_AGENT_ENVOY], relevant: true },
      [STUB_AGENT_GENERAL]: { privateContext: AGENT_CONTEXTS[STUB_AGENT_GENERAL], relevant: true },
    },
  };
}

function seed(attemptId: string): RuntimeAttempt {
  const createdAt = Date.now();
  const ledger = new StageDecisions([
    { actorId: PLAYER_ACTOR_ID, actorKind: "player" },
    { actorId: STUB_AGENT_ENVOY, actorKind: "agent" },
    { actorId: STUB_AGENT_GENERAL, actorKind: "agent" },
  ]);
  const world = createWorld({
    rooms: [
      {
        id: STUB_ROOM_CHAMBER,
        name: "Council chamber",
        description: "Where the vote is held",
        doorOpen: true,
      },
      {
        id: STUB_ROOM_ANTEROOM,
        name: "Anteroom",
        description: "Quiet enough for a private word",
        doorOpen: true,
      },
    ],
    actors: [
      {
        id: STUB_AGENT_ENVOY,
        name: "Envoy Marisel",
        publicRole: "Envoy of the coastal cities",
        kind: "agent",
      },
      {
        id: STUB_AGENT_GENERAL,
        name: "General Orvan",
        publicRole: "Commander of the garrison",
        kind: "agent",
      },
      {
        id: PLAYER_ACTOR_ID,
        name: "You",
        publicRole: "A council delegate",
        kind: "player",
      },
    ],
    placement: {
      [STUB_AGENT_ENVOY]: STUB_ROOM_CHAMBER,
      [STUB_AGENT_GENERAL]: STUB_ROOM_ANTEROOM,
      [PLAYER_ACTOR_ID]: STUB_ROOM_CHAMBER,
    },
  });
  const attempt: RuntimeAttempt = {
    createdAt,
    deadlineAt: createdAt + STUB_TIMER_SECONDS * 1000,
    revision: 1,
    world,
    ledger,
    actions: [],
    resolution: null,
    announcements: [],
    pendingEffects: [],
    dispositions: {
      [STUB_AGENT_ENVOY]: 0,
      [STUB_AGENT_GENERAL]: 0,
    },
  };
  const opening: ActorAction = {
    actorKind: "agent",
    actorId: STUB_AGENT_ENVOY,
    action: {
      type: "speak",
      roomId: STUB_ROOM_CHAMBER,
      body: "You are late. The general has already asked for a vote on the blockade.",
      addresseeId: PLAYER_ACTOR_ID,
    },
  };
  applyAction(world, opening);
  attempt.actions.push(opening);
  attempts.set(attemptId, attempt);
  while (attempts.size > MAX_RUNTIME_ATTEMPTS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
  return attempt;
}

function resolveAttempt(
  attemptId: string,
  attempt: RuntimeAttempt,
  decision: {
    optionId: string;
    label: string;
    stance: DecisionStance;
  } | null,
  trigger: "decision" | "timer_expiry",
): DecisionResponse["resolution"] {
  const resolverResult = resolveStageSync({
    attemptId,
    stageId: STUB_STAGE_ID,
    seed: `turn-api:${attemptId}`,
    stageIndex: 0,
    resolvedAt: new Date().toISOString(),
    trigger,
    decision:
      decision === null
        ? null
        : {
            ...decision,
            branchTarget: { kind: "stage", stageId: STUB_NEXT_STAGE_ID },
          },
    fallbackNext: { kind: "stage", stageId: STUB_NEXT_STAGE_ID },
    agents: [STUB_AGENT_ENVOY, STUB_AGENT_GENERAL].map((agentId) => {
      const actor = attempt.world.actors[agentId];
      const commitment = attempt.ledger.all().find((entry) => entry.actorId === agentId);
      return {
        id: agentId,
        name: actor?.name ?? agentId,
        disposition: attempt.dispositions[agentId] ?? 0,
        ...(commitment === undefined
          ? {}
          : { commitment: { optionId: commitment.optionId, how: commitment.how } }),
      };
    }),
    actions: attempt.actions,
    evidenceCollected: 0,
  });
  attempt.resolution = resolverResult.record;
  for (const delta of resolverResult.record.outcome.agentDeltas) {
    attempt.dispositions[delta.agentId] = delta.disposition;
  }
  const projected = publicResolution(resolverResult.record);
  attempt.announcements.push({
    id: `${attemptId}-a${attempt.announcements.length + 1}`,
    body: projected.announcement,
    createdAt: resolverResult.record.resolvedAt,
  });
  attempt.pendingEffects = projected.effects;
  attempt.revision += 1;
  return projected;
}

function enforceDeadline(attemptId: string, attempt: RuntimeAttempt): void {
  if (attempt.resolution !== null || Date.now() < attempt.deadlineAt) return;
  const expired = attempt.ledger.expire();
  for (const decision of expired) {
    attempt.actions.push({
      actorKind: decision.actorKind,
      actorId: decision.actorId,
      action: { type: "pass" },
    });
  }
  resolveAttempt(attemptId, attempt, null, "timer_expiry");
}

function get(attemptId: string): RuntimeAttempt {
  const attempt = attempts.get(attemptId) ?? seed(attemptId);
  enforceDeadline(attemptId, attempt);
  return attempt;
}

function toPublicMessage(
  attemptId: string,
  attempt: RuntimeAttempt,
  line: { seq: number; roomId: string; speakerId: string; speakerName: string; body: string },
): PublicMessage {
  const actor = attempt.world.actors[line.speakerId];
  return {
    id: `${attemptId}-u${line.seq}`,
    roomId: line.roomId,
    authorType: actor?.kind === "player" ? "player" : "agent",
    authorId: actor?.kind === "player" ? null : line.speakerId,
    authorName: actor?.kind === "player" ? "You" : line.speakerName,
    body: line.body,
    createdAt: new Date(attempt.createdAt + line.seq).toISOString(),
  };
}

function commitments(attempt: RuntimeAttempt): PublicActorCommitment[] {
  return [
    {
      actorKind: "player",
      actorId: PLAYER_ACTOR_ID,
      actorName: "You",
      committed: attempt.ledger.has(PLAYER_ACTOR_ID),
    },
    ...[STUB_AGENT_ENVOY, STUB_AGENT_GENERAL].map((agentId) => ({
      actorKind: "agent" as const,
      actorId: agentId,
      actorName: attempt.world.actors[agentId]?.name ?? agentId,
      committed: attempt.ledger.has(agentId),
    })),
  ];
}

function projectOptions(attempt: RuntimeAttempt) {
  const resolved = attempt.resolution !== null;
  const live = deriveOptions(attempt.world, OPTION_CATALOGUE, PLAYER_ACTOR_ID);
  const closedReason = "Your decision for this stage is already recorded.";
  return OPTION_CATALOGUE.map((option) => {
    const available = !resolved && live.options.some((candidate) => candidate.id === option.id) && isAvailable(attempt.world, option);
    return {
      id: option.id,
      label: option.label,
      available,
      unavailableReason: available
        ? null
        : resolved
          ? closedReason
          : option.id === "option-broker-truce"
            ? "You have not spoken to the general yet."
            : null,
    };
  });
}

function projectState(attemptId: string, attempt: RuntimeAttempt): PublicAttemptState {
  const now = Date.now();
  const visible = visibleTranscript(attempt.world, PLAYER_ACTOR_ID).map((line) =>
    toPublicMessage(attemptId, attempt, line),
  );
  const transcript: PublicMessage[] = [
    {
      id: `${attemptId}-u0`,
      roomId: STUB_ROOM_CHAMBER,
      authorType: "system",
      authorId: null,
      authorName: null,
      body: "The council chamber is loud. Two of the delegates stop talking when you enter.",
      createdAt: new Date(attempt.createdAt).toISOString(),
    },
    ...visible,
  ];
  const rooms = Object.values(attempt.world.rooms).map((room) => ({
    id: room.id,
    name: room.name,
    purpose: room.id === STUB_ROOM_CHAMBER ? "Where the vote is held" : "Quiet enough for a private word",
    doorOpen: room.doorOpen,
    occupantIds: occupantsOf(attempt.world, room.id).map((actor) => actor.id),
  }));
  const agents = [STUB_AGENT_ENVOY, STUB_AGENT_GENERAL].map((agentId) => {
    const actor = attempt.world.actors[agentId];
    return {
      id: agentId,
      name: actor?.name ?? agentId,
      role: actor?.publicRole ?? null,
      publicPosition:
        agentId === STUB_AGENT_ENVOY
          ? "Wants the strait kept open for grain convoys."
          : "Wants the strait closed before the fleet arrives.",
      roomId: attempt.world.location[agentId] ?? null,
      portraitUrl: null,
    };
  });
  const secondsRemaining = Math.max(0, Math.round((attempt.deadlineAt - now) / 1000));
  return {
    attemptId,
    adventureId: STUB_ADVENTURE_ID,
    publishedVersion: 1,
    status: "active",
    stage: {
      id: STUB_STAGE_ID,
      index: 0,
      title: "The vote on the blockade",
      sharedContext:
        "Three weeks into the crisis, the council must decide whether to close the strait.",
      ambientOverlay: "clouds",
      overlayIntensity: 2,
      objectives: [
        {
          id: "objective-hear-both",
          title: "Hear both delegations",
          met: visible.some((message) => message.authorId === STUB_AGENT_GENERAL),
        },
        {
          id: "objective-decide",
          title: "Cast your position",
          met: attempt.ledger.has(PLAYER_ACTOR_ID),
        },
      ],
    },
    timer: {
      enabled: true,
      deadlineAt: new Date(attempt.deadlineAt).toISOString(),
      serverNow: new Date(now).toISOString(),
      secondsRemaining,
    },
    mapArtifactId: null,
    playerPos: { x: 6, y: 4 },
    currentRoomId: attempt.world.location[PLAYER_ACTOR_ID] ?? null,
    rooms,
    agents,
    transcript,
    journal: [
      {
        id: "journal-grain-ledger",
        text: "A ledger showing the grain convoys that passed the strait last month.",
        sourceSpan: "Council minutes, p. 14",
        collectedAt: new Date(attempt.createdAt).toISOString(),
      },
    ],
    options: projectOptions(attempt),
    commitments: commitments(attempt),
    announcements: attempt.announcements,
    pendingEffects: attempt.pendingEffects,
    revision: attempt.revision,
  };
}

export async function runtimeState(attemptId: string): Promise<PublicAttemptState> {
  return projectState(attemptId, get(attemptId));
}

export async function postRuntimeMessage(
  attemptId: string,
  roomId: string,
  body: string,
): Promise<PostMessageResult> {
  if (roomId !== STUB_ROOM_CHAMBER && roomId !== STUB_ROOM_ANTEROOM) {
    return { ok: false, reason: "unknown_room" };
  }
  const attempt = get(attemptId);
  if (attempt.resolution !== null) return { ok: false, reason: "stage_closed" };

  const beforeSeq = attempt.world.seq;
  if (attempt.world.location[PLAYER_ACTOR_ID] !== roomId) {
    const movement: ActorAction = {
      actorKind: "player",
      actorId: PLAYER_ACTOR_ID,
      action: { type: "move_room", toRoomId: roomId },
    };
    applyAction(attempt.world, movement);
    attempt.actions.push(movement);
  }
  const respondent = occupantsOf(attempt.world, roomId).find((actor) => actor.kind === "agent");
  if (respondent === undefined) return { ok: false, reason: "unknown_room" };
  const playerSpeech: ActorAction = {
    actorKind: "player",
    actorId: PLAYER_ACTOR_ID,
    action: { type: "speak", roomId, body, addresseeId: respondent.id },
  };
  applyAction(attempt.world, playerSpeech);
  attempt.actions.push(playerSpeech);

  const config = stageConfig(attempt.ledger);
  const input = buildAgentTurnInput(attempt.world, respondent.id, config, 6);
  const reply =
    respondent.id === STUB_AGENT_GENERAL
      ? '{"say":"Close the strait and the fleet starves. That is the whole of my argument.","actions":[]}'
      : '{"say":"Say that in the chamber and half the council will stop listening to you.","actions":[]}';
  const turn = await runAgentTurn(
    new FakeLlmClient({ replies: [reply] }),
    input,
    { optionsVersion: deriveOptions(attempt.world, OPTION_CATALOGUE, respondent.id).version },
  );
  for (const action of turn.actions) {
    applyAction(attempt.world, action);
    attempt.actions.push(action);
  }
  attempt.revision += 1;
  const newMessages = visibleTranscript(attempt.world, PLAYER_ACTOR_ID)
    .filter((line) => line.seq > beforeSeq)
    .map((line) => toPublicMessage(attemptId, attempt, line));
  return { ok: true, newMessages, state: projectState(attemptId, attempt) };
}

export async function commitRuntimeDecision(
  attemptId: string,
  optionId: string,
): Promise<CommitDecisionResult | null> {
  const attempt = get(attemptId);
  if (attempt.resolution !== null) return null;
  const current = deriveOptions(attempt.world, OPTION_CATALOGUE, PLAYER_ACTOR_ID);
  const definition = OPTION_CATALOGUE.find((option) => option.id === optionId);
  if (
    definition === undefined ||
    !current.options.some((option) => option.id === optionId) ||
    !isAvailable(attempt.world, definition)
  ) {
    return null;
  }
  const playerAction: ActorAction = {
    actorKind: "player",
    actorId: PLAYER_ACTOR_ID,
    action: { type: "commit_decision", optionId, optionsVersion: current.version },
  };
  const playerDecision = attempt.ledger.commit(attempt.world, OPTION_CATALOGUE, {
    actorId: PLAYER_ACTOR_ID,
    actorKind: "player",
    optionId,
    optionsVersion: current.version,
  });
  if (!playerDecision.ok) return null;
  attempt.actions.push(playerAction);

  for (const [agentId, agentOptionId] of Object.entries(AGENT_VOTES)) {
    if (attempt.ledger.has(agentId)) continue;
    const agentOptions = deriveOptions(attempt.world, OPTION_CATALOGUE, agentId);
    const agentDefinition = OPTION_CATALOGUE.find((option) => option.id === agentOptionId);
    if (
      agentDefinition !== undefined &&
      agentOptions.options.some((option) => option.id === agentOptionId) &&
      isAvailable(attempt.world, agentDefinition)
    ) {
      const agentAction: ActorAction = {
        actorKind: "agent",
        actorId: agentId,
        action: {
          type: "commit_decision",
          optionId: agentOptionId,
          optionsVersion: agentOptions.version,
        },
      };
      const agentDecision = attempt.ledger.commit(attempt.world, OPTION_CATALOGUE, {
        actorId: agentId,
        actorKind: "agent",
        optionId: agentOptionId,
        optionsVersion: agentOptions.version,
      });
      if (agentDecision.ok) attempt.actions.push(agentAction);
    } else {
      const passed = attempt.ledger.pass(agentId);
      if (passed.ok) {
        attempt.actions.push({ actorKind: "agent", actorId: agentId, action: { type: "pass" } });
      }
    }
  }

  const resolution = resolveAttempt(
    attemptId,
    attempt,
    {
      optionId,
      label: definition.label,
      stance: OPTION_STANCES[optionId] as DecisionStance,
    },
    "decision",
  );
  return { resolution, state: projectState(attemptId, attempt) };
}

export function expireRuntimeDeadline(attemptId: string): void {
  const attempt = attempts.get(attemptId) ?? seed(attemptId);
  attempt.deadlineAt = Date.now() - 1;
}

export function resetRuntime(): void {
  attempts.clear();
}
