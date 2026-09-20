/**
 * Canned public state behind the I3 contract, so the client can be built
 * tonight before the DB and the Resolver are wired in (EXECUTION_SPEC §2,
 * "stub, don't wait").
 *
 * The stub keeps per-attempt state in memory: posting a message appends to the
 * transcript and gets an in-persona canned reply, committing a decision
 * resolves the stage deterministically. Replaced by the DB + Kevin's Resolver
 * (I4) behind the same response shapes.
 */
import type {
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

/** Canned agent votes, ticked as soon as the human is in (D18/FR-14). */
const AGENT_VOTES: Record<string, { name: string; optionId: string | null }> = {
  [STUB_AGENT_ENVOY]: { name: "Envoy Marisel", optionId: "option-abstain" },
  [STUB_AGENT_GENERAL]: {
    name: "General Orvan",
    optionId: "option-support-blockade",
  },
};

type StubAttempt = {
  createdAt: number;
  deadlineAt: number;
  revision: number;
  transcript: PublicMessage[];
  announcements: { id: string; body: string; createdAt: string }[];
  pendingEffects: PublicEffect[];
  committedOptionId: string | null;
  /** actor id → chosen option, or null for a pass. Never projected publicly. */
  commitments: Map<string, string | null>;
  status: PublicAttemptState["status"];
};

const attempts = new Map<string, StubAttempt>();

function seed(attemptId: string): StubAttempt {
  const now = Date.now();
  const attempt: StubAttempt = {
    createdAt: now,
    deadlineAt: now + STUB_TIMER_SECONDS * 1000,
    revision: 1,
    transcript: [
      {
        id: `${attemptId}-m1`,
        roomId: STUB_ROOM_CHAMBER,
        authorType: "system",
        authorId: null,
        authorName: null,
        body: "The council chamber is loud. Two of the delegates stop talking when you enter.",
        createdAt: new Date(now).toISOString(),
      },
      {
        id: `${attemptId}-m2`,
        roomId: STUB_ROOM_CHAMBER,
        authorType: "agent",
        authorId: STUB_AGENT_ENVOY,
        authorName: "Envoy Marisel",
        body: "You are late. The general has already asked for a vote on the blockade.",
        createdAt: new Date(now + 1000).toISOString(),
      },
    ],
    announcements: [],
    pendingEffects: [],
    committedOptionId: null,
    commitments: new Map(),
    status: "active",
  };
  attempts.set(attemptId, attempt);
  return attempt;
}

function get(attemptId: string): StubAttempt {
  const attempt = attempts.get(attemptId) ?? seed(attemptId);
  enforceDeadline(attempt);
  return attempt;
}

/**
 * The deadline is server-held: once it passes, an actor that has not committed
 * is recorded as a pass and the stage resolves without them (D12/FR-16). A
 * refresh or a client clock change cannot postpone this.
 */
function enforceDeadline(attempt: StubAttempt) {
  if (Date.now() < attempt.deadlineAt) return;
  if (attempt.commitments.has(PLAYER_ACTOR_ID)) return;
  attempt.commitments.set(PLAYER_ACTOR_ID, null);
  tickAgents(attempt);
  attempt.revision += 1;
}

/** Agents decide under the same rules as players; they are ticked immediately
 *  once every human is in rather than waiting the clock out. */
function tickAgents(attempt: StubAttempt) {
  for (const [agentId, vote] of Object.entries(AGENT_VOTES)) {
    if (!attempt.commitments.has(agentId)) {
      attempt.commitments.set(agentId, vote.optionId);
    }
  }
}

function commitments(attempt: StubAttempt): PublicActorCommitment[] {
  return [
    {
      actorKind: "player" as const,
      actorId: PLAYER_ACTOR_ID,
      actorName: "You",
      committed: attempt.commitments.has(PLAYER_ACTOR_ID),
    },
    ...Object.entries(AGENT_VOTES).map(([agentId, vote]) => ({
      actorKind: "agent" as const,
      actorId: agentId,
      actorName: vote.name,
      committed: attempt.commitments.has(agentId),
    })),
  ];
}

function options(attempt: StubAttempt) {
  const talkedToGeneral = attempt.transcript.some(
    (m) => m.authorId === STUB_AGENT_GENERAL,
  );
  const open = !attempt.commitments.has(PLAYER_ACTOR_ID);
  const closedReason = "Your decision for this stage is already recorded.";
  return [
    {
      id: "option-support-blockade",
      label: "Vote for the blockade",
      available: open,
      unavailableReason: open ? null : closedReason,
    },
    {
      id: "option-broker-truce",
      label: "Broker a truce between the envoy and the general",
      available: open && talkedToGeneral,
      unavailableReason: open
        ? talkedToGeneral
          ? null
          : "You have not spoken to the general yet."
        : closedReason,
    },
    {
      id: "option-abstain",
      label: "Abstain and keep listening",
      available: open,
      unavailableReason: open ? null : closedReason,
    },
  ];
}

export function stubState(attemptId: string): PublicAttemptState {
  const attempt = get(attemptId);
  const now = Date.now();
  const secondsRemaining = Math.max(
    0,
    Math.round((attempt.deadlineAt - now) / 1000),
  );
  return {
    attemptId,
    adventureId: STUB_ADVENTURE_ID,
    publishedVersion: 1,
    status: attempt.status,
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
          met: attempt.transcript.some((m) => m.authorId === STUB_AGENT_GENERAL),
        },
        {
        id: "objective-decide",
        title: "Cast your position",
        met: attempt.commitments.has(PLAYER_ACTOR_ID),
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
    currentRoomId: STUB_ROOM_CHAMBER,
    rooms: [
      {
        id: STUB_ROOM_CHAMBER,
        name: "Council chamber",
        purpose: "Where the vote is held",
        doorOpen: true,
        occupantIds: [STUB_AGENT_ENVOY],
      },
      {
        id: STUB_ROOM_ANTEROOM,
        name: "Anteroom",
        purpose: "Quiet enough for a private word",
        doorOpen: false,
        occupantIds: [STUB_AGENT_GENERAL],
      },
    ],
    agents: [
      {
        id: STUB_AGENT_ENVOY,
        name: "Envoy Marisel",
        role: "Envoy of the coastal cities",
        publicPosition: "Wants the strait kept open for grain convoys.",
        roomId: STUB_ROOM_CHAMBER,
        portraitUrl: null,
      },
      {
        id: STUB_AGENT_GENERAL,
        name: "General Orvan",
        role: "Commander of the garrison",
        publicPosition: "Wants the strait closed before the fleet arrives.",
        roomId: STUB_ROOM_ANTEROOM,
        portraitUrl: null,
      },
    ],
    transcript: attempt.transcript,
    journal: [
      {
        id: "journal-grain-ledger",
        text: "A ledger showing the grain convoys that passed the strait last month.",
        sourceSpan: "Council minutes, p. 14",
        collectedAt: new Date(attempt.createdAt).toISOString(),
      },
    ],
    options: options(attempt),
    commitments: commitments(attempt),
    announcements: attempt.announcements,
    pendingEffects: attempt.pendingEffects,
    revision: attempt.revision,
  };
}

export function stubPostMessage(
  attemptId: string,
  roomId: string,
  body: string,
): { newMessages: PublicMessage[]; state: PublicAttemptState } {
  const attempt = get(attemptId);
  const now = Date.now();
  attempt.revision += 1;

  const playerMessage: PublicMessage = {
    id: `${attemptId}-m${attempt.transcript.length + 1}`,
    roomId,
    authorType: "player",
    authorId: null,
    authorName: "You",
    body,
    createdAt: new Date(now).toISOString(),
  };

  const respondent =
    roomId === STUB_ROOM_ANTEROOM
      ? { id: STUB_AGENT_GENERAL, name: "General Orvan" }
      : { id: STUB_AGENT_ENVOY, name: "Envoy Marisel" };

  const agentMessage: PublicMessage = {
    id: `${attemptId}-m${attempt.transcript.length + 2}`,
    roomId,
    authorType: "agent",
    authorId: respondent.id,
    authorName: respondent.name,
    body:
      respondent.id === STUB_AGENT_GENERAL
        ? "Close the strait and the fleet starves. That is the whole of my argument."
        : "Say that in the chamber and half the council will stop listening to you.",
    createdAt: new Date(now + 500).toISOString(),
  };

  attempt.transcript = [...attempt.transcript, playerMessage, agentMessage];
  return {
    newMessages: [playerMessage, agentMessage],
    state: stubState(attemptId),
  };
}

export function stubCommitDecision(attemptId: string, optionId: string) {
  const attempt = get(attemptId);
  const available = options(attempt).find((o) => o.id === optionId && o.available);
  if (!available) return null;

  attempt.revision += 1;
  attempt.committedOptionId = optionId;
  attempt.commitments.set(PLAYER_ACTOR_ID, optionId);
  tickAgents(attempt);

  const announcement =
    optionId === "option-support-blockade"
      ? "The council votes to close the strait. The coastal delegation walks out."
      : optionId === "option-broker-truce"
        ? "The envoy and the general agree to a week's pause. Nobody looks satisfied."
        : "You abstain. The vote carries without you, narrowly.";

  const effects: PublicEffect[] =
    optionId === "option-support-blockade"
      ? [
          {
            id: "crowd_flee",
            at: null,
            intensity: 2,
            text: "The gallery empties as the vote is called.",
          },
        ]
      : [];

  attempt.announcements = [
    ...attempt.announcements,
    {
      id: `${attemptId}-a${attempt.announcements.length + 1}`,
      body: announcement,
      createdAt: new Date().toISOString(),
    },
  ];
  attempt.pendingEffects = effects;

  return {
    resolution: {
      announcement,
      effects,
      nextStageId: STUB_NEXT_STAGE_ID,
      ending: false,
    },
    state: stubState(attemptId),
  };
}

/** Test helper: move the server-held deadline into the past. */
export function expireStubDeadline(attemptId: string) {
  const attempt = attempts.get(attemptId) ?? seed(attemptId);
  attempt.deadlineAt = Date.now() - 1;
}

/** Test helper: forget all canned attempts. */
export function resetStub() {
  attempts.clear();
}
