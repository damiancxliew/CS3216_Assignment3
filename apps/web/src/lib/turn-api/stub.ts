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

type StubAttempt = {
  createdAt: number;
  deadlineAt: number;
  revision: number;
  transcript: PublicMessage[];
  announcements: { id: string; body: string; createdAt: string }[];
  pendingEffects: PublicEffect[];
  committedOptionId: string | null;
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
    status: "active",
  };
  attempts.set(attemptId, attempt);
  return attempt;
}

function get(attemptId: string): StubAttempt {
  return attempts.get(attemptId) ?? seed(attemptId);
}

function options(attempt: StubAttempt) {
  const talkedToGeneral = attempt.transcript.some(
    (m) => m.authorId === STUB_AGENT_GENERAL,
  );
  return [
    {
      id: "option-support-blockade",
      label: "Vote for the blockade",
      available: attempt.committedOptionId === null,
      unavailableReason:
        attempt.committedOptionId === null ? null : "The stage is already resolved.",
    },
    {
      id: "option-broker-truce",
      label: "Broker a truce between the envoy and the general",
      available: attempt.committedOptionId === null && talkedToGeneral,
      unavailableReason: talkedToGeneral
        ? attempt.committedOptionId === null
          ? null
          : "The stage is already resolved."
        : "You have not spoken to the general yet.",
    },
    {
      id: "option-abstain",
      label: "Abstain and keep listening",
      available: attempt.committedOptionId === null,
      unavailableReason:
        attempt.committedOptionId === null ? null : "The stage is already resolved.",
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
        { id: "objective-decide", title: "Cast your position", met: attempt.committedOptionId !== null },
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

/** Test helper: forget all canned attempts. */
export function resetStub() {
  attempts.clear();
}
