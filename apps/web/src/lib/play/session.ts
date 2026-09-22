/**
 * One attempt's play loop over the orchestration runtime (K1–K9), independent
 * of Next.js and of the database. The service layer loads a `PlaySnapshot`,
 * calls one method here, and persists the snapshot that comes back; the API
 * tests drive this directly with a `FakeLlmClient`.
 *
 * Ids in the public state are the spec's slugs (rooms, agents, options,
 * evidence), because the runtime speaks slugs; the store maps them onto row
 * uuids where a foreign key demands it.
 */
import {
  DEFAULT_REPLY_RATE_LIMIT,
  advanceSpatialMovement,
  applyAction,
  deriveOptions,
  fakeResolver,
  filterActions,
  publicResolution,
  ReplyInbox,
  ReplyRateLimiter,
  replyToPlayer,
  runStage,
  StageDecisions,
  buildAgentTurnInput,
  createWorld,
  DOORWAY_ID,
  hasConversationExchange,
  hearingActorIds,
  moveActorStep,
  type ActorAction,
  type Decision,
  type LlmClient,
  type PublicEffect,
  type ReplyResult,
  type ResolutionRecord,
  type StageConfig,
  type Utterance,
  type WorldState,
  visibleTranscript,
} from "@adventure/orchestration";
import { createSpatialStageWorld } from "@adventure/game-integration";
import { isInPhysicalInteractionRange } from "@adventure/game-core";
import type { CompiledStage, Point } from "@adventure/game-core";
import { isDeepStrictEqual } from "node:util";
import { PLAYER_ID, toResolverInput, toStageRuntime, type StageRuntimeBundle } from "@adventure/generation/runtime";
import { resolveStageSettings, type AdventureSpec, type Stage } from "@adventure/generation/spec";

import type { AssetManifest } from "@adventure/generation/assets";

import { characterFor, facesetUrl, PLAYER_CHARACTER, type Character } from "./appearance";
import { compileStageMap, publicMap, SpatialCompatibilityError, type PublicMap } from "./layout";
import { OUTDOORS_ROOM_ID } from "@/lib/turn-api/contract";
import type { PublicAttemptState, PublicMessage } from "@/lib/turn-api/contract";

export { OUTDOORS_ROOM_ID } from "@/lib/turn-api/contract";

export type JournalEntry = { id: string; text: string; sourceSpan: string | null; collectedAt: string };
export type Announcement = { id: string; body: string; createdAt: string };
export interface PendingReply {
  id: string;
  stageId: string;
  agentId: string;
  utteranceSeq: number;
  expiresAt: number;
}

/** Everything the loop needs to continue an attempt. Stored as jsonb in `attempt_state.world_state`. */
export interface PlaySnapshot {
  version: 1;
  stageIndex: number;
  world: WorldState;
  decisions: Decision[];
  /** Standing carried between stages, by agent id (the resolver's `agentDeltas` accumulate here). */
  dispositions: Record<string, number>;
  journal: JournalEntry[];
  announcements: Announcement[];
  pendingEffects: PublicEffect[];
  /** The last tile the client reported for the player, so a resume draws them where they were. */
  playerPos: { x: number; y: number } | null;
  /** When each line of the current stage's transcript was spoken, by seq — so a resume shows the same times. */
  spokenAt: Record<string, string>;
  /** Per-stage counters for telemetry (P11); reset when a stage opens. */
  stageStats: { openedAt: string; tokens: number; messages: number; actions: number; evidence: number };
  status: "active" | "completed";
  endingId: string | null;
  tokensSpent: number;
  revision: number;
  nextStepAt?: number;
  pendingReply?: PendingReply | null;
  replyRate?: { tokens: number; lastMs: number };
}

/** Additive to the frozen I3 projection: what the renderer needs on top of it. */
export interface PlayState extends PublicAttemptState {
  map: PublicMap | null;
  /** What to actually do for each goal, in plain words ("Talk to X in Y"), keyed by objective id. */
  objectiveHints: Record<string, string>;
  /** Generated landmark image per room, when the asset service produced one (D4). */
  roomImages: Record<string, string>;
  /** Generated prop image per evidence item, when one exists (D4). Keys are evidence ids. */
  evidenceImages: Record<string, string>;
  /** Where every actor stands, by room. Tiles are the client's business except the player's own. */
  actors: { id: string; name: string; kind: "player" | "agent"; roomId: string | null; position: Point | null; sprite: Character }[];
  hearingActorIds: string[];
  pendingDialogue: boolean;
  /** Evidence in the player's room that they have not examined yet. Names only — content is what examining reveals. */
  evidenceHere: { id: string; name: string; position: { x: number; y: number } | null; canInspect: boolean }[];
  /** Version of the option set shown; commits carry it back so a stale set is rejected (FR-14). */
  optionsVersion: string;
  stageCount: number;
  ending: { id: string; title: string; summary: string } | null;
}

export type PlayerWorldAction =
  | { type: "move_step"; stageId: string; from: Point; to: Point }
  | { type: "move_room"; toRoomId: string; position?: { x: number; y: number } }
  | { type: "open_door"; roomId: string }
  | { type: "close_door"; roomId: string }
  | { type: "knock"; roomId: string }
  | { type: "inspect"; evidenceId: string }
  | { type: "share_evidence"; evidenceId: string }
  | { type: "position"; position: { x: number; y: number } };

export type SessionError =
  | { code: "stage_closed"; message: string }
  | { code: "not_found"; message: string }
  | { code: "invalid_request"; message: string }
  | { code: "stale_option"; message: string }
  | { code: "stale_state"; message: string }
  | { code: "rate_limited"; message: string }
  | { code: "incompatible_version"; message: string };

export type MessageOutcome = { ok: true; newMessages: PublicMessage[] } | { ok: false; error: SessionError };
export type MessageBeginOutcome = { ok: true; newMessages: PublicMessage[]; ticket: PendingReply | null } | { ok: false; error: SessionError };
export type ActionOutcome = { ok: true; refused: string | null } | { ok: false; error: SessionError };
export type DecisionOutcome =
  | { ok: true; resolution: ReturnType<typeof publicResolution> }
  | { ok: false; error: SessionError };

export interface SessionClock {
  now: () => Date;
}

/** What a request changed, for the store to record. Drained once per request. */
export interface SessionEvents {
  utterances: { line: Utterance; heardByPlayer: boolean; stageIndex: number }[];
  decisions: { decision: Decision; stageIndex: number }[];
  resolution: { record: ResolutionRecord; stageIndex: number } | null;
  /** Index of a stage this request opened, if it advanced. */
  openedStageIndex: number | null;
  endingId: string | null;
  /** Numbers for the stage that resolved this request (P11), if one did. */
  telemetry: StageTelemetry | null;
}

export interface StageTelemetry {
  stageIndex: number;
  endedBy: "decision" | "timer";
  durationSeconds: number;
  tokens: number;
  messages: number;
  actions: number;
  evidenceFound: number;
  agentLines: number;
}

export interface SessionTimer {
  enabled: boolean;
  deadlineAt: string | null;
}

/**
 * The space between buildings. Orchestration models presence as "in a room", so the outdoors is a
 * room too: one nobody can shut, with nothing to examine, where a player hears only what is said
 * outdoors. Walking out of a building therefore really does leave its conversation behind (D7).
 */
function worldFor(spec: AdventureSpec, index: number, attemptId: string, compiledStages?: readonly CompiledStage[]): WorldState {
  const compiled = compiledStages === undefined ? compileStageMap(spec.stages[index]!, attemptId) : compiledStages[index];
  if (compiled === undefined) throw new SpatialCompatibilityError();
  return createSpatialStageWorld(spec, index, compiled);
}

/** Budget for autonomous agent activity per stage (FR-12b). Kept modest: this is money per attempt. */
const STAGE_TOKEN_BUDGET = 60_000;
const AUTONOMOUS_TICKS_PER_MOVE = 1;
const DECISION_TICKS = 2;

function messageId(attemptId: string, stageId: string, line: Utterance): string {
  return `${attemptId}:${stageId}:${line.seq}`;
}

function newId(): string {
  return crypto.randomUUID();
}

export class PlaySession {
  private bundle: StageRuntimeBundle;
  private stage: Stage;
  private ledger: StageDecisions;
  private readonly limiter = new ReplyRateLimiter();
  private readonly inbox = new ReplyInbox();
  private compiledMap: ReturnType<typeof compileStageMap> | null = null;
  /** Event accounting: where this request started in the current stage's world and ledger. */
  private baseSeq: number;
  private baseDecided: Set<string>;
  private closedEvents: Pick<SessionEvents, "utterances" | "decisions"> = { utterances: [], decisions: [] };
  private resolutionEvent: SessionEvents["resolution"] = null;
  private telemetryEvent: StageTelemetry | null = null;
  private openedStageIndex: number | null = null;

  private constructor(
    readonly spec: AdventureSpec,
    readonly attemptId: string,
    readonly publishedVersion: number,
    private snap: PlaySnapshot,
    private readonly clock: SessionClock,
    /** Generated images for this version, when any exist (D4). Portraits fall back to the curated faceset. */
    private readonly assets: AssetManifest | null = null,
    private readonly compiledStages?: readonly CompiledStage[],
  ) {
    this.stage = spec.stages[snap.stageIndex]!;
    this.bundle = toStageRuntime(spec, snap.stageIndex);
    this.ledger = StageDecisions.restore(this.participants(), snap.decisions);
    this.baseSeq = snap.world.seq;
    this.baseDecided = new Set(snap.decisions.map((d) => d.actorId));
  }

  /** Everything this request changed, then reset. The store records it; nothing here is projected. */
  drainEvents(): SessionEvents {
    const current = this.stageEvents();
    const events: SessionEvents = {
      utterances: [...this.closedEvents.utterances, ...current.utterances],
      decisions: [...this.closedEvents.decisions, ...current.decisions],
      resolution: this.resolutionEvent,
      openedStageIndex: this.openedStageIndex,
      endingId: this.snap.status === "completed" ? this.snap.endingId : null,
      telemetry: this.telemetryEvent,
    };
    this.closedEvents = { utterances: [], decisions: [] };
    this.resolutionEvent = null;
    this.telemetryEvent = null;
    this.openedStageIndex = null;
    this.baseSeq = this.snap.world.seq;
    this.baseDecided = new Set(this.ledger.all().map((d) => d.actorId));
    return events;
  }

  private stageEvents(): Pick<SessionEvents, "utterances" | "decisions"> {
    const heardSeqs = new Set(this.playerHeard().map((line) => line.seq));
    return {
      utterances: this.snap.world.transcript
        .filter((line) => line.seq > this.baseSeq)
        .map((line) => ({ line, heardByPlayer: heardSeqs.has(line.seq), stageIndex: this.snap.stageIndex })),
      decisions: this.ledger
        .all()
        .filter((d) => !this.baseDecided.has(d.actorId))
        .map((decision) => ({ decision, stageIndex: this.snap.stageIndex })),
    };
  }

  static start(spec: AdventureSpec, attemptId: string, publishedVersion: number, clock: SessionClock = { now: () => new Date() }, assets: AssetManifest | null = null, compiledStages?: readonly CompiledStage[]): PlaySession {
    const world = worldFor(spec, 0, attemptId, compiledStages);
    const snap: PlaySnapshot = {
      version: 1,
      stageIndex: 0,
      world,
      decisions: [],
      dispositions: {},
      journal: [],
      announcements: [],
      pendingEffects: [],
      playerPos: world.spatial?.state.actors[PLAYER_ID] ?? null,
      spokenAt: {},
      stageStats: { openedAt: clock.now().toISOString(), tokens: 0, messages: 0, actions: 0, evidence: 0 },
      status: "active",
      endingId: null,
      tokensSpent: 0,
      revision: 0,
      nextStepAt: 0,
      pendingReply: null,
      replyRate: { tokens: DEFAULT_REPLY_RATE_LIMIT.burst, lastMs: 0 },
    };
    return new PlaySession(spec, attemptId, publishedVersion, snap, clock, assets, compiledStages);
  }

  static resume(spec: AdventureSpec, attemptId: string, publishedVersion: number, snapshot: PlaySnapshot, clock: SessionClock = { now: () => new Date() }, assets: AssetManifest | null = null, compiledStages?: readonly CompiledStage[]): PlaySession {
    if (!Number.isInteger(snapshot.stageIndex) || snapshot.stageIndex < 0 || snapshot.stageIndex >= spec.stages.length) throw new SpatialCompatibilityError();
    const expected = compiledStages === undefined ? compileStageMap(spec.stages[snapshot.stageIndex]!, attemptId) : compiledStages[snapshot.stageIndex];
    if (!snapshot.world.spatial || expected === undefined || !isDeepStrictEqual(snapshot.world.spatial.map, expected.map)) throw new SpatialCompatibilityError();
    const cloned = structuredClone(snapshot);
    try {
      createWorld({ rooms: Object.values(cloned.world.rooms), actors: Object.values(cloned.world.actors), placement: cloned.world.location, spatial: cloned.world.spatial });
    } catch {
      throw new SpatialCompatibilityError();
    }
    return new PlaySession(spec, attemptId, publishedVersion, {
      ...cloned,
      spokenAt: cloned.spokenAt ?? {},
      stageStats: cloned.stageStats ?? { openedAt: clock.now().toISOString(), tokens: 0, messages: 0, actions: 0, evidence: 0 },
      nextStepAt: cloned.nextStepAt ?? 0,
      pendingReply: cloned.pendingReply ?? null,
      replyRate: cloned.replyRate ?? { tokens: DEFAULT_REPLY_RATE_LIMIT.burst, lastMs: 0 },
    }, clock, assets, compiledStages);
  }

  snapshot(): PlaySnapshot {
    return structuredClone({ ...this.snap, playerPos: this.snap.world.spatial?.state.actors[PLAYER_ID] ?? null, decisions: this.ledger.all() });
  }

  get world(): WorldState {
    return this.snap.world;
  }

  get stageIndex(): number {
    return this.snap.stageIndex;
  }

  get currentStage(): Stage {
    return this.stage;
  }

  // ---------------------------------------------------------------------------
  // projection
  // ---------------------------------------------------------------------------

  state(timer: SessionTimer): PlayState {
    const world = this.snap.world;
    const playerRoom = world.location[PLAYER_ID] ?? null;
    const now = this.clock.now();
    const derived = deriveOptions(world, this.bundle.options, PLAYER_ID);
    const available = new Set(derived.options.map((o) => o.id));
    const known = new Set(world.evidenceKnown[PLAYER_ID] ?? []);
    const compiled = this.map();
    const ending = this.snap.endingId ? this.spec.endings.find((e) => e.id === this.snap.endingId) ?? null : null;
    const secondsRemaining =
      timer.enabled && timer.deadlineAt ? Math.max(0, Math.floor((new Date(timer.deadlineAt).getTime() - now.getTime()) / 1000)) : null;
    const { ambientOverlay } = resolveStageSettings(this.spec, this.stage);

    return {
      attemptId: this.attemptId,
      adventureId: this.spec.id,
      publishedVersion: this.publishedVersion,
      status: this.snap.status,
      stage: {
        id: this.stage.id,
        index: this.stage.index,
        title: this.stage.title,
        sharedContext: this.stage.sharedContext.text,
        ambientOverlay: ambientOverlay.id,
        overlayIntensity: ambientOverlay.intensity,
        objectives: this.stage.objectives.map((o) => ({ id: o.id, title: o.title, met: this.objectiveMet(o.id) })),
      },
      timer: { enabled: timer.enabled, deadlineAt: timer.deadlineAt, serverNow: now.toISOString(), secondsRemaining },
      mapArtifactId: compiled?.map.id ?? null,
      playerPos: world.spatial?.state.actors[PLAYER_ID] ?? null,
      currentRoomId: playerRoom,
      rooms: this.stage.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        purpose: room.purpose,
        enclosure: world.spatial!.map.rooms.find((candidate) => candidate.id === room.id)!.enclosure,
        doorOpen: world.rooms[room.id]?.doorOpen ?? room.doorDefault === "open",
        occupantIds: Object.entries(world.location)
          .filter(([, roomId]) => roomId === room.id)
          .map(([actorId]) => actorId),
      })),
      agents: this.stage.agents.map((agent) => ({
        id: agent.id,
        name: this.agentName(agent.id),
        role: this.spec.stakeholders.find((s) => s.id === agent.stakeholderId)?.role ?? null,
        publicPosition: agent.publicPosition.text,
        roomId: this.roomOf(agent.id),
        portraitUrl: this.portraitFor(agent.stakeholderId),
      })),
      transcript: this.visibleTranscript(),
      journal: this.snap.journal,
      options: this.bundle.options.map((option) => ({
        id: option.id,
        label: option.label,
        available: available.has(option.id),
        unavailableReason: available.has(option.id) ? null : "You do not know enough yet to choose this.",
      })),
      commitments: this.participants().map((p) => ({
        actorKind: p.actorKind,
        actorId: p.actorId,
        actorName: p.actorKind === "player" ? "You" : this.agentName(p.actorId),
        committed: this.ledger.has(p.actorId),
      })),
      announcements: this.snap.announcements,
      pendingEffects: this.snap.pendingEffects,
      revision: this.snap.revision,
      map: compiled ? publicMap(compiled) : null,
      hearingActorIds: hearingActorIds(world, PLAYER_ID),
      pendingDialogue: this.snap.pendingReply?.expiresAt !== undefined && this.snap.pendingReply.expiresAt > now.getTime(),
      actors: [
        { id: PLAYER_ID, name: "You", kind: "player", roomId: playerRoom, position: world.spatial?.state.actors[PLAYER_ID] ?? null, sprite: PLAYER_CHARACTER },
        ...this.stage.agents.map((agent) => ({
          id: agent.id,
          name: this.agentName(agent.id),
          kind: "agent" as const,
          roomId: this.roomOf(agent.id),
          position: world.spatial?.state.actors[agent.id] ?? null,
          sprite: this.characterOf(agent.stakeholderId),
        })),
      ],
      evidenceHere: this.stage.evidence
        .filter((item) => item.roomId === playerRoom && !known.has(item.id))
        .map((item) => {
          const position = compiled?.placements.find((p) => p.id === item.id)?.position ?? null;
          const playerPoint = world.spatial?.state.actors[PLAYER_ID] ?? null;
          const canInspect = playerPoint !== null && position !== null && compiled !== null && isInPhysicalInteractionRange(world.spatial!.map, world.spatial!.state.doors, playerPoint, position);
          return { id: item.id, name: item.name, position, canInspect };
        }),
      objectiveHints: this.objectiveHints(),
      roomImages: this.generatedImages("landmark", this.stage.rooms.map((r) => r.id)),
      evidenceImages: this.generatedImages("prop", this.stage.evidence.map((e) => e.id)),
      optionsVersion: derived.version,
      stageCount: this.spec.stages.length,
      ending: ending ? { id: ending.id, title: ending.title, summary: ending.summary } : null,
    };
  }

  /** Lines the player could have heard, oldest first (FR-11: presence decides). */
  private visibleTranscript(): PublicMessage[] {
    return this.playerHeard().map((line) => this.toMessage(line));
  }

  private playerHeard(): Utterance[] {
    return visibleTranscript(this.snap.world, PLAYER_ID).sort((a, b) => a.seq - b.seq);
  }

  private toMessage(line: Utterance): PublicMessage {
    const isPlayer = this.snap.world.actors[line.speakerId]?.kind === "player";
    return {
      id: messageId(this.attemptId, this.stage.id, line),
      roomId: line.roomId,
      authorType: isPlayer ? "player" : "agent",
      authorId: line.speakerId,
      authorName: isPlayer ? "You" : line.speakerName,
      body: line.body,
      createdAt: this.snap.spokenAt[line.seq] ?? this.clock.now().toISOString(),
    };
  }

  private objectiveMet(objectiveId: string, visiting = new Set<string>()): boolean {
    if (visiting.has(objectiveId)) return false;
    const objective = this.stage.objectives.find((candidate) => candidate.id === objectiveId);
    if (!objective) return false;
    if (!objective.requires.every((required) => this.objectiveMet(required, new Set(visiting).add(objectiveId)))) return false;
    const world = this.snap.world;
    if ((world.evidenceKnown[PLAYER_ID] ?? []).includes(objective.targetId)) return true;
    // Agent objective: the player has heard that character speak while in the same room.
    return hasConversationExchange(world, PLAYER_ID, objective.targetId);
  }

  /**
   * Goals are authored as outcomes ("Hear Farquhar's assessment"); students need the verb. An
   * agent goal is met by hearing that person speak while you are with them (K6 heard_from), an
   * evidence goal by examining the item — so say that, and where.
   */
  private objectiveHints(): Record<string, string> {
    const roomName = (roomId: string | null | undefined) => this.stage.rooms.find((r) => r.id === roomId)?.name ?? null;
    const out: Record<string, string> = {};
    for (const objective of this.stage.objectives) {
      const agent = this.stage.agents.find((a) => a.id === objective.targetId);
      if (agent) {
        const where = roomName(this.roomOf(agent.id));
        out[objective.id] = `Talk to ${this.agentName(agent.id)}${where ? ` in ${where}` : ""} and hear what they say`;
        continue;
      }
      const item = this.stage.evidence.find((e) => e.id === objective.targetId);
      if (item) {
        const where = roomName(item.roomId);
        out[objective.id] = `Look at ${item.name}${where ? ` in ${where}` : ""}`;
      }
    }
    return out;
  }

  /** An actor's authored room, or null when they are outdoors or nowhere. */
  private roomOf(actorId: string): string | null {
    const roomId = this.snap.world.location[actorId] ?? null;
    return roomId === OUTDOORS_ROOM_ID ? null : roomId;
  }

  private characterOf(stakeholderId: string): Character {
    const stakeholder = this.spec.stakeholders.find((s) => s.id === stakeholderId);
    return characterFor({ id: stakeholderId, name: stakeholder?.name ?? null, role: stakeholder?.role ?? null });
  }

  /** Ready or cached generated images of one kind, keyed by the entity they depict. Nothing for the rest. */
  private generatedImages(kind: "landmark" | "prop", entityIds: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const record of this.assets?.records ?? []) {
      if (record.kind === kind && entityIds.includes(record.entityId) && (record.status === "ready" || record.status === "cached")) out[record.entityId] = record.url;
    }
    return out;
  }

  /** The generated portrait once it is ready or cached (D4); the hand-drawn faceset until then (D6). */
  private portraitFor(stakeholderId: string): string {
    const record = this.assets?.records.find((r) => r.entityId === stakeholderId && r.kind === "portrait");
    if (record && (record.status === "ready" || record.status === "cached")) return record.url;
    return facesetUrl(this.characterOf(stakeholderId));
  }

  private agentName(agentId: string): string {
    return this.snap.world.actors[agentId]?.name ?? this.bundle.resolverAgents.find((a) => a.id === agentId)?.name ?? agentId;
  }

  private participants(): { actorId: string; actorKind: "player" | "agent" }[] {
    return [{ actorId: PLAYER_ID, actorKind: "player" }, ...this.stage.agents.map((a) => ({ actorId: a.id, actorKind: "agent" as const }))];
  }

  private map() {
    if (this.snap.status !== "active") return null;
    if (!this.compiledMap) {
      if (this.compiledStages !== undefined) {
        const compiled = this.compiledStages[this.snap.stageIndex];
        if (compiled === undefined) throw new SpatialCompatibilityError();
        this.compiledMap = compiled;
      } else {
        this.compiledMap = compileStageMap(this.stage, this.attemptId);
      }
    }
    return this.compiledMap;
  }

  private stageConfig(): StageConfig {
    return {
      ...this.bundle.stage,
      decision: { catalogue: this.bundle.options, ledger: this.ledger },
      tokenBudget: STAGE_TOKEN_BUDGET,
      replies: { inbox: this.inbox, limiter: this.limiter, now: () => this.clock.now().getTime() },
    };
  }

  private bump(): void {
    this.syncJournal();
    this.snap.revision += 1;
    const now = this.clock.now().toISOString();
    for (const line of this.snap.world.transcript) this.snap.spokenAt[line.seq] ??= now;
  }

  private syncJournal(): void {
    const known = new Set(this.snap.world.evidenceKnown[PLAYER_ID] ?? []);
    const stored = new Set(this.snap.journal.map((entry) => entry.id));
    for (const item of this.stage.evidence) {
      if (!known.has(item.id) || stored.has(item.id)) continue;
      const span = item.content.spans[0];
      this.snap.journal.push({ id: item.id, text: `${item.name}: ${item.content.text}`, sourceSpan: span ? `${span.sourceId}, p. ${span.page}: “${span.quote}”` : null, collectedAt: this.clock.now().toISOString() });
    }
  }

  private closed(): SessionError | null {
    if (this.snap.status !== "active") return { code: "stage_closed", message: "This adventure has ended." };
    if (this.ledger.has(PLAYER_ID)) return { code: "stage_closed", message: "You have already decided; the stage is resolving." };
    return null;
  }

  // ---------------------------------------------------------------------------
  // player speech
  // ---------------------------------------------------------------------------

  beginMessage(input: { roomId: string; body: string; addresseeId?: string | null }): MessageBeginOutcome {
    const closed = this.closed();
    if (closed) return { ok: false, error: closed };
    if (!input.body.trim() || input.body.length > 2000) return { ok: false, error: { code: "invalid_request", message: "Write between 1 and 2000 characters." } };
    const world = this.snap.world;
    const here = world.location[PLAYER_ID];
    if (!world.rooms[input.roomId] && input.roomId !== OUTDOORS_ROOM_ID && input.roomId !== DOORWAY_ID) return { ok: false, error: { code: "not_found", message: "That room is not part of this stage." } };
    if (input.roomId !== here) return { ok: false, error: { code: "invalid_request", message: "You can only speak where you are standing." } };
    const addressee = input.addresseeId ?? null;
    if (addressee !== null && (world.actors[addressee]?.kind !== "agent" || !hearingActorIds(world, PLAYER_ID).includes(addressee))) return { ok: false, error: { code: "invalid_request", message: "That addressee cannot hear you." } };
    if (addressee !== null && this.snap.pendingReply && this.snap.pendingReply.expiresAt > this.clock.now().getTime()) return { ok: false, error: { code: "rate_limited", message: "Wait for the pending reply or keep exploring." } };
    const nowMs = this.clock.now().getTime();
    const elapsed = Math.max(0, nowMs - (this.snap.replyRate?.lastMs ?? 0));
    const tokens = Math.min(DEFAULT_REPLY_RATE_LIMIT.burst, (this.snap.replyRate?.tokens ?? DEFAULT_REPLY_RATE_LIMIT.burst) + elapsed / DEFAULT_REPLY_RATE_LIMIT.minIntervalMs);
    if (tokens < 1) return { ok: false, error: { code: "rate_limited", message: "Try again shortly." } };
    const firstSeq = world.seq + 1;
    const spoken = applyAction(world, { actorKind: "player", actorId: PLAYER_ID, action: { type: "speak", roomId: here, body: input.body, addresseeId: addressee } });
    if (!spoken.ok) return { ok: false, error: { code: "invalid_request", message: spoken.reason } };
    this.snap.stageStats.messages += 1;
    this.snap.replyRate = { tokens: tokens - 1, lastMs: Math.max(nowMs, this.snap.replyRate?.lastMs ?? 0) };
    const ticket: PendingReply | null = addressee === null ? null : { id: newId(), stageId: this.stage.id, agentId: addressee, utteranceSeq: firstSeq, expiresAt: nowMs + 120_000 };
    if (ticket) this.snap.pendingReply = ticket;
    this.bump();
    return { ok: true, ticket, newMessages: this.playerHeard().filter((line) => line.seq >= firstSeq).map((line) => this.toMessage(line)) };
  }

  async produceReply(client: LlmClient, ticket: PendingReply): Promise<ReplyResult> {
    const source = this.snap.world.transcript.find((line) => line.seq === ticket.utteranceSeq);
    if (!source) throw new Error("reply source missing");
    const detached = structuredClone(this.snap.world);
    const turnInput = { ...buildAgentTurnInput(detached, ticket.agentId, this.stageConfig(), 1), playerMessage: source.body, replyToSeqs: [ticket.utteranceSeq] };
    return replyToPlayer(client, detached, turnInput, { limiter: new ReplyRateLimiter(), inbox: new ReplyInbox(), speakerId: PLAYER_ID, nowMs: this.clock.now().getTime(), tokenBudget: STAGE_TOKEN_BUDGET, tokensSpent: this.snap.tokensSpent });
  }

  completeReply(ticket: PendingReply, result: ReplyResult | null): MessageOutcome {
    if (this.snap.status !== "active" || this.snap.pendingReply?.id !== ticket.id || this.snap.pendingReply.stageId !== this.stage.id || ticket.expiresAt <= this.clock.now().getTime()) return { ok: true, newMessages: [] };
    const beforeSeq = this.snap.world.seq;
    this.snap.pendingReply = null;
    if (result === null) {
      this.snap.announcements.push({ id: newId(), body: "The reply was interrupted. Please try again.", createdAt: this.clock.now().toISOString() });
      this.bump();
      return { ok: true, newMessages: [] };
    }
    const used = result.turn.usage.promptTokens + result.turn.usage.completionTokens;
    this.snap.tokensSpent += used;
    this.snap.stageStats.tokens += used;
    if (result.source === "deflection") {
      if (result.turn.say.trim()) applyAction(this.snap.world, { actorKind: "agent", actorId: ticket.agentId, action: { type: "speak", roomId: this.snap.world.location[ticket.agentId]!, body: result.turn.say, addresseeId: null } });
    } else {
      const context = result.source === "model" && !result.turn.degraded ? { replyToSeqs: [ticket.utteranceSeq] } : {};
      for (const entry of result.turn.actions) if (entry.actorKind === "agent" && entry.actorId === ticket.agentId) applyAction(this.snap.world, entry, entry.action.type === "speak" ? context : {});
    }
    this.bump();
    return { ok: true, newMessages: this.playerHeard().filter((line) => line.seq > beforeSeq).map((line) => this.toMessage(line)) };
  }

  expirePendingReply(): void {
    if (this.snap.pendingReply && this.snap.pendingReply.expiresAt <= this.clock.now().getTime()) {
      this.snap.pendingReply = null;
      this.bump();
    }
  }

  async message(client: LlmClient, input: { roomId: string; body: string; addresseeId?: string | null }): Promise<MessageOutcome> {
    const begun = this.beginMessage(input);
    if (!begun.ok || !begun.ticket) return begun;
    let reply: ReplyResult | null = null;
    try { reply = await this.produceReply(client, begun.ticket); } catch { reply = null; }
    const completed = this.completeReply(begun.ticket, reply);
    return completed.ok ? { ok: true, newMessages: [...begun.newMessages, ...completed.newMessages] } : completed;
  }

  // ---------------------------------------------------------------------------
  // player world actions
  // ---------------------------------------------------------------------------

  async action(client: LlmClient, action: PlayerWorldAction): Promise<ActionOutcome> {
    const closed = this.closed();
    if (closed) return { ok: false, error: closed };
    const world = this.snap.world;
    if (action.type === "position" || action.type === "move_room") return { ok: false, error: { code: "invalid_request", message: "Use adjacent tile movement." } };
    if (action.type === "move_step") {
      const spatial = this.snap.world.spatial!;
      const current = spatial.state.actors[PLAYER_ID]!;
      if (action.stageId !== this.stage.id || current.x !== action.from.x || current.y !== action.from.y) return { ok: false, error: { code: "stale_state", message: "The stage or position changed. Refresh and try again." } };
      const now = this.clock.now().getTime();
      if (now < (this.snap.nextStepAt ?? 0)) return { ok: false, error: { code: "rate_limited", message: "Move again shortly." } };
      const moved = moveActorStep(this.snap.world, PLAYER_ID, action.to);
      if (!moved.ok) return { ok: true, refused: moved.reason };
      advanceSpatialMovement(this.snap.world);
      this.snap.nextStepAt = now + 160;
      this.snap.stageStats.actions += 1;
      this.bump();
      return { ok: true, refused: null };
    }

    if (action.type === "inspect") {
      const item = this.stage.evidence.find((e) => e.id === action.evidenceId);
      if (!item) return { ok: false, error: { code: "not_found", message: "There is no such thing here." } };
      const placement = this.map()?.placements.find((p) => p.id === item.id);
      const playerPoint = world.spatial?.state.actors[PLAYER_ID] ?? null;
      if (!placement || !playerPoint || !world.spatial || !isInPhysicalInteractionRange(world.spatial.map, world.spatial.state.doors, playerPoint, placement.position)) return { ok: true, refused: "Walk closer to examine that." };
      const known = (world.evidenceKnown[PLAYER_ID] ??= []);
      if (!known.includes(item.id)) {
        known.push(item.id);
        this.snap.stageStats.evidence += 1;
        this.snap.stageStats.actions += 1;
        const span = item.content.spans[0];
        this.snap.journal.push({
          id: item.id,
          text: `${item.name}: ${item.content.text}`,
          sourceSpan: span ? `${span.sourceId}, p. ${span.page}: “${span.quote}”` : null,
          collectedAt: this.clock.now().toISOString(),
        });
        this.bump();
      }
      return { ok: true, refused: null };
    }

    this.snap.stageStats.actions += 1;
    const worldAction = action.type === "share_evidence"
      ? { type: "share_evidence" as const, roomId: world.location[PLAYER_ID] ?? "", evidenceId: action.evidenceId }
      : action;
    const filtered = filterActions([worldAction], { actorKind: "player", actorId: PLAYER_ID });
    const entry: ActorAction | undefined = filtered.actions[0];
    if (!entry) return { ok: false, error: { code: "invalid_request", message: filtered.dropped[0]?.reason ?? "That is not something you can do." } };

    const result = applyAction(world, entry);
    this.bump();

    // Knocking gives whoever is behind that door a beat to answer it (K4, #8) — only them, so the
    // wait is one model call. Walking costs nothing: characters answer when spoken to, and a stage
    // resolving is the moment everyone acts.
    if (action.type === "knock" && result.ok) {
      const inside = Object.entries(world.location)
        .filter(([actorId, roomId]) => roomId === action.roomId && actorId !== PLAYER_ID)
        .map(([actorId]) => actorId);
      if (inside.length > 0) await this.tick(client, AUTONOMOUS_TICKS_PER_MOVE, inside);
    }

    return { ok: true, refused: result.ok ? null : result.reason };
  }

  /** Let the characters act autonomously for a bounded number of ticks (FR-12a/FR-12b); `only` narrows who. */
  async tick(client: LlmClient, maxTicks: number, only?: readonly string[]): Promise<void> {
    if (this.snap.status !== "active") return;
    const config = this.stageConfig();
    const agents = only ? Object.fromEntries(Object.entries(config.agents).filter(([id]) => only.includes(id))) : config.agents;
    const run = await runStage(client, this.snap.world, {
      ...config,
      agents,
      maxTicks,
      tokenBudget: Math.max(0, STAGE_TOKEN_BUDGET - this.snap.tokensSpent),
    });
    this.snap.tokensSpent += run.telemetry.totalTokens;
    this.snap.stageStats.tokens += run.telemetry.totalTokens;
    this.bump();
  }

  // ---------------------------------------------------------------------------
  // decision and resolution
  // ---------------------------------------------------------------------------

  async decide(client: LlmClient, optionId: string, optionsVersion?: string): Promise<DecisionOutcome> {
    const closed = this.closed();
    if (closed) return { ok: false, error: closed };
    if (this.snap.pendingReply && this.snap.pendingReply.expiresAt > this.clock.now().getTime()) return { ok: false, error: { code: "rate_limited", message: "Wait for the pending reply or keep exploring." } };
    const world = this.snap.world;
    const version = optionsVersion ?? deriveOptions(world, this.bundle.options, PLAYER_ID).version;
    const commit = this.ledger.commit(world, this.bundle.options, { actorId: PLAYER_ID, actorKind: "player", optionId, optionsVersion: version });
    if (!commit.ok) {
      return { ok: false, error: { code: commit.reason === "unknown_option" ? "not_found" : "stale_option", message: commit.detail } };
    }

    // Every human is in: the characters are told to decide now (D18), then anyone still silent abstains.
    await this.tick(client, DECISION_TICKS);
    for (const actorId of this.ledger.pending()) this.ledger.pass(actorId);

    return { ok: true, resolution: await this.resolve(optionId) };
  }

  /** The stage timer ran out: everyone still undecided passes and the stage resolves (D12/FR-16). */
  async expire(): Promise<DecisionOutcome> {
    if (this.snap.status !== "active") return { ok: false, error: { code: "stage_closed", message: "This adventure has ended." } };
    const playerDecision = this.ledger.all().find((d) => d.actorId === PLAYER_ID);
    this.ledger.expire();
    return { ok: true, resolution: await this.resolve(playerDecision?.optionId ?? null) };
  }

  private async resolve(optionId: string | null) {
    const world = this.snap.world;
    const evidenceCollected = (world.evidenceKnown[PLAYER_ID] ?? []).filter((id) => this.stage.evidence.some((e) => e.id === id)).length;
    const { record } = await fakeResolver.resolveStage(
      toResolverInput(this.spec, this.bundle, {
        attemptId: this.attemptId,
        seed: `${this.attemptId}|${this.publishedVersion}`,
        resolvedAt: this.clock.now().toISOString(),
        optionId,
        actions: [],
        evidenceCollected,
        dispositions: this.snap.dispositions,
        decisions: this.ledger.all(),
      }),
    );
    for (const delta of record.outcome.agentDeltas) {
      this.snap.dispositions[delta.agentId] = (this.snap.dispositions[delta.agentId] ?? 0) + (delta.dispositionDelta ?? 0);
    }
    const resolution = publicResolution(record);
    const createdAt = this.clock.now().toISOString();
    this.snap.announcements.push({ id: newId(), body: resolution.announcement, createdAt });
    this.snap.pendingEffects = resolution.effects;

    // Bank the closing stage's events before its world is replaced.
    const closing = this.stageEvents();
    this.closedEvents.utterances.push(...closing.utterances);
    this.closedEvents.decisions.push(...closing.decisions);
    this.resolutionEvent = { record, stageIndex: this.snap.stageIndex };
    const stats = this.snap.stageStats;
    this.telemetryEvent = {
      stageIndex: this.snap.stageIndex,
      endedBy: optionId === null ? "timer" : "decision",
      durationSeconds: Math.max(0, Math.round((this.clock.now().getTime() - new Date(stats.openedAt).getTime()) / 1000)),
      tokens: stats.tokens,
      messages: stats.messages,
      actions: stats.actions,
      evidenceFound: stats.evidence,
      agentLines: world.transcript.filter((line) => line.speakerId !== PLAYER_ID).length,
    };

    const next = record.outcome.next;
    if (next.kind === "ending") {
      this.snap.status = "completed";
      this.snap.endingId = next.endingId;
      this.snap.pendingReply = null;
    } else if (next.kind === "stage") {
      const index = this.spec.stages.findIndex((s) => s.id === next.stageId);
      if (index < 0) throw new Error(`resolver pointed at unknown stage "${next.stageId}"`);
      this.openStage(index);
    }
    this.bump();
    return resolution;
  }

  private openStage(index: number): void {
    const bundle = toStageRuntime(this.spec, index);
    this.snap.stageIndex = index;
    this.snap.world = worldFor(this.spec, index, this.attemptId, this.compiledStages);
    this.snap.decisions = [];
    this.snap.playerPos = this.snap.world.spatial?.state.actors[PLAYER_ID] ?? null;
    this.snap.spokenAt = {};
    this.snap.stageStats = { openedAt: this.clock.now().toISOString(), tokens: 0, messages: 0, actions: 0, evidence: 0 };
    this.snap.nextStepAt = 0;
    this.snap.pendingReply = null;
    this.stage = this.spec.stages[index]!;
    this.bundle = bundle;
    this.ledger = new StageDecisions(this.participants());
    this.compiledMap = null;
    this.baseSeq = 0;
    this.baseDecided = new Set();
    this.openedStageIndex = index;
  }
}
