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
  applyAction,
  createWorld,
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
  type ActorAction,
  type Decision,
  type LlmClient,
  type PublicEffect,
  type ResolutionRecord,
  type StageConfig,
  type Utterance,
  type WorldState,
} from "@adventure/orchestration";
import { PLAYER_ID, toResolverInput, toStageRuntime, type StageRuntimeBundle } from "@adventure/generation/runtime";
import { resolveStageSettings, type AdventureSpec, type Stage } from "@adventure/generation/spec";

import { compileStageMap, publicMap, type PublicMap } from "./layout";
import type { PublicAttemptState, PublicMessage } from "@/lib/turn-api/contract";

export type JournalEntry = { id: string; text: string; sourceSpan: string | null; collectedAt: string };
export type Announcement = { id: string; body: string; createdAt: string };

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
  status: "active" | "completed";
  endingId: string | null;
  tokensSpent: number;
  revision: number;
}

/** Additive to the frozen I3 projection: what the renderer needs on top of it. */
export interface PlayState extends PublicAttemptState {
  map: PublicMap | null;
  /** Where every actor stands, by room. Tiles are the client's business except the player's own. */
  actors: { id: string; name: string; kind: "player" | "agent"; roomId: string | null }[];
  /** Evidence in the player's room that they have not examined yet. Names only — content is what examining reveals. */
  evidenceHere: { id: string; name: string; position: { x: number; y: number } | null }[];
  /** Version of the option set shown; commits carry it back so a stale set is rejected (FR-14). */
  optionsVersion: string;
  stageCount: number;
  ending: { id: string; title: string; summary: string } | null;
}

export type PlayerWorldAction =
  | { type: "move_room"; toRoomId: string; position?: { x: number; y: number } }
  | { type: "open_door"; roomId: string }
  | { type: "close_door"; roomId: string }
  | { type: "knock"; roomId: string }
  | { type: "inspect"; evidenceId: string }
  | { type: "position"; position: { x: number; y: number } };

export type SessionError =
  | { code: "stage_closed"; message: string }
  | { code: "not_found"; message: string }
  | { code: "invalid_request"; message: string }
  | { code: "stale_option"; message: string }
  | { code: "stale_state"; message: string };

export type MessageOutcome = { ok: true; newMessages: PublicMessage[] } | { ok: false; error: SessionError };
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
}

export interface SessionTimer {
  enabled: boolean;
  deadlineAt: string | null;
}

/** Budget for autonomous agent activity per stage (FR-12b). Kept modest: this is money per attempt. */
const STAGE_TOKEN_BUDGET = 60_000;
const AUTONOMOUS_TICKS_PER_MOVE = 1;
const DECISION_TICKS = 2;

function messageId(attemptId: string, line: Utterance): string {
  return `${attemptId}:${line.seq}`;
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
  private openedStageIndex: number | null = null;

  private constructor(
    readonly spec: AdventureSpec,
    readonly attemptId: string,
    readonly publishedVersion: number,
    private snap: PlaySnapshot,
    private readonly clock: SessionClock,
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
    };
    this.closedEvents = { utterances: [], decisions: [] };
    this.resolutionEvent = null;
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

  static start(spec: AdventureSpec, attemptId: string, publishedVersion: number, clock: SessionClock = { now: () => new Date() }): PlaySession {
    const bundle = toStageRuntime(spec, 0);
    const world = createWorld(bundle.world);
    const snap: PlaySnapshot = {
      version: 1,
      stageIndex: 0,
      world,
      decisions: [],
      dispositions: {},
      journal: [],
      announcements: [],
      pendingEffects: [],
      playerPos: null,
      spokenAt: {},
      status: "active",
      endingId: null,
      tokensSpent: 0,
      revision: 0,
    };
    return new PlaySession(spec, attemptId, publishedVersion, snap, clock);
  }

  static resume(spec: AdventureSpec, attemptId: string, publishedVersion: number, snapshot: PlaySnapshot, clock: SessionClock = { now: () => new Date() }): PlaySession {
    return new PlaySession(spec, attemptId, publishedVersion, { ...structuredClone(snapshot), spokenAt: snapshot.spokenAt ?? {} }, clock);
  }

  snapshot(): PlaySnapshot {
    return structuredClone({ ...this.snap, decisions: this.ledger.all() });
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
        objectives: this.stage.objectives.map((o) => ({ id: o.id, title: o.title, met: this.objectiveMet(o.targetId) })),
      },
      timer: { enabled: timer.enabled, deadlineAt: timer.deadlineAt, serverNow: now.toISOString(), secondsRemaining },
      mapArtifactId: compiled?.map.id ?? null,
      playerPos: this.snap.playerPos ?? compiled?.playerSpawn ?? null,
      currentRoomId: playerRoom,
      rooms: this.stage.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        purpose: room.purpose,
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
        roomId: world.location[agent.id] ?? null,
        portraitUrl: null,
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
      actors: [
        { id: PLAYER_ID, name: "You", kind: "player", roomId: playerRoom },
        ...this.stage.agents.map((agent) => ({ id: agent.id, name: this.agentName(agent.id), kind: "agent" as const, roomId: world.location[agent.id] ?? null })),
      ],
      evidenceHere: this.stage.evidence
        .filter((item) => item.roomId === playerRoom && !known.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.name,
          position: compiled?.placements.find((p) => p.id === item.id)?.position ?? null,
        })),
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
    const world = this.snap.world;
    return world.transcript
      .filter((line) => world.presence.some((p) => p.actorId === PLAYER_ID && p.roomId === line.roomId && p.fromSeq <= line.seq && (p.toSeq === null || line.seq < p.toSeq)))
      .sort((a, b) => a.seq - b.seq);
  }

  private toMessage(line: Utterance): PublicMessage {
    const isPlayer = this.snap.world.actors[line.speakerId]?.kind === "player";
    return {
      id: messageId(this.attemptId, line),
      roomId: line.roomId,
      authorType: isPlayer ? "player" : "agent",
      authorId: line.speakerId,
      authorName: isPlayer ? "You" : line.speakerName,
      body: line.body,
      createdAt: this.snap.spokenAt[line.seq] ?? this.clock.now().toISOString(),
    };
  }

  private objectiveMet(targetId: string): boolean {
    const world = this.snap.world;
    if ((world.evidenceKnown[PLAYER_ID] ?? []).includes(targetId)) return true;
    // Agent objective: the player has heard that character speak while in the same room.
    return this.playerHeard().some((line) => line.speakerId === targetId);
  }

  private agentName(agentId: string): string {
    return this.snap.world.actors[agentId]?.name ?? this.bundle.resolverAgents.find((a) => a.id === agentId)?.name ?? agentId;
  }

  private participants(): { actorId: string; actorKind: "player" | "agent" }[] {
    return [{ actorId: PLAYER_ID, actorKind: "player" }, ...this.stage.agents.map((a) => ({ actorId: a.id, actorKind: "agent" as const }))];
  }

  private map() {
    if (this.snap.status !== "active") return null;
    if (!this.compiledMap) this.compiledMap = compileStageMap(this.stage, this.attemptId);
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
    this.snap.revision += 1;
    const now = this.clock.now().toISOString();
    for (const line of this.snap.world.transcript) this.snap.spokenAt[line.seq] ??= now;
  }

  private closed(): SessionError | null {
    if (this.snap.status !== "active") return { code: "stage_closed", message: "This adventure has ended." };
    if (this.ledger.has(PLAYER_ID)) return { code: "stage_closed", message: "You have already decided; the stage is resolving." };
    return null;
  }

  // ---------------------------------------------------------------------------
  // player speech
  // ---------------------------------------------------------------------------

  async message(client: LlmClient, input: { roomId: string; body: string; addresseeId?: string | null }): Promise<MessageOutcome> {
    const closed = this.closed();
    if (closed) return { ok: false, error: closed };
    const world = this.snap.world;
    const here = world.location[PLAYER_ID];
    if (!world.rooms[input.roomId]) return { ok: false, error: { code: "not_found", message: "That room is not part of this stage." } };
    if (input.roomId !== here) return { ok: false, error: { code: "invalid_request", message: "You can only speak in the room you are standing in." } };

    const occupants = Object.entries(world.location)
      .filter(([actorId, roomId]) => roomId === here && actorId !== PLAYER_ID && this.bundle.stage.agents[actorId])
      .map(([actorId]) => actorId);
    const addressee = input.addresseeId && occupants.includes(input.addresseeId) ? input.addresseeId : occupants[0] ?? null;

    const firstSeq = world.seq + 1;
    const spoken = applyAction(world, {
      actorKind: "player",
      actorId: PLAYER_ID,
      action: { type: "speak", roomId: here, body: input.body, addresseeId: addressee },
    });
    if (!spoken.ok) return { ok: false, error: { code: "invalid_request", message: spoken.reason } };

    if (addressee) {
      const turnInput = buildAgentTurnInput(world, addressee, this.stageConfig(), 1);
      const reply = await replyToPlayer(client, world, turnInput, {
        limiter: this.limiter,
        inbox: this.inbox,
        speakerId: PLAYER_ID,
        nowMs: this.clock.now().getTime(),
        tokenBudget: STAGE_TOKEN_BUDGET,
        tokensSpent: this.snap.tokensSpent,
      });
      this.snap.tokensSpent += reply.turn.usage.promptTokens + reply.turn.usage.completionTokens;
    }

    this.bump();
    const newMessages = this.playerHeard()
      .filter((line) => line.seq >= firstSeq)
      .map((line) => this.toMessage(line));
    return { ok: true, newMessages };
  }

  // ---------------------------------------------------------------------------
  // player world actions
  // ---------------------------------------------------------------------------

  async action(client: LlmClient, action: PlayerWorldAction): Promise<ActionOutcome> {
    const closed = this.closed();
    if (closed) return { ok: false, error: closed };
    const world = this.snap.world;

    if (action.type === "position") {
      if (this.snap.playerPos?.x !== action.position.x || this.snap.playerPos?.y !== action.position.y) {
        this.snap.playerPos = action.position;
        this.bump();
      }
      return { ok: true, refused: null };
    }

    if (action.type === "inspect") {
      const item = this.stage.evidence.find((e) => e.id === action.evidenceId);
      if (!item) return { ok: false, error: { code: "not_found", message: "There is no such thing here." } };
      if (world.location[PLAYER_ID] !== item.roomId) return { ok: true, refused: "You need to be in the same room to examine that." };
      const known = (world.evidenceKnown[PLAYER_ID] ??= []);
      if (!known.includes(item.id)) {
        known.push(item.id);
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

    const worldAction = action.type === "move_room" ? { type: action.type, toRoomId: action.toRoomId } : action;
    const filtered = filterActions([worldAction], { actorKind: "player", actorId: PLAYER_ID });
    const entry: ActorAction | undefined = filtered.actions[0];
    if (!entry) return { ok: false, error: { code: "invalid_request", message: filtered.dropped[0]?.reason ?? "That is not something you can do." } };

    const result = applyAction(world, entry);
    if (action.type === "move_room" && result.ok && action.position) this.snap.playerPos = action.position;
    this.bump();

    // Moving or knocking is when the world gets a beat to itself: characters act while the player
    // walks, and someone behind a knocked door gets the chance to answer it (K4, #8).
    if ((action.type === "move_room" || action.type === "knock") && result.ok) await this.tick(client, AUTONOMOUS_TICKS_PER_MOVE);

    return { ok: true, refused: result.ok ? null : result.reason };
  }

  /** Let the characters act autonomously for a bounded number of ticks (FR-12a/FR-12b). */
  async tick(client: LlmClient, maxTicks: number): Promise<void> {
    if (this.snap.status !== "active") return;
    const run = await runStage(client, this.snap.world, {
      ...this.stageConfig(),
      maxTicks,
      tokenBudget: Math.max(0, STAGE_TOKEN_BUDGET - this.snap.tokensSpent),
    });
    this.snap.tokensSpent += run.telemetry.totalTokens;
    this.bump();
  }

  // ---------------------------------------------------------------------------
  // decision and resolution
  // ---------------------------------------------------------------------------

  async decide(client: LlmClient, optionId: string, optionsVersion?: string): Promise<DecisionOutcome> {
    const closed = this.closed();
    if (closed) return { ok: false, error: closed };
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

    const next = record.outcome.next;
    if (next.kind === "ending") {
      this.snap.status = "completed";
      this.snap.endingId = next.endingId;
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
    this.snap.world = createWorld(bundle.world);
    this.snap.decisions = [];
    this.snap.playerPos = null;
    this.snap.spokenAt = {};
    this.stage = this.spec.stages[index]!;
    this.bundle = bundle;
    this.ledger = new StageDecisions(this.participants());
    this.compiledMap = null;
    this.baseSeq = 0;
    this.baseDecided = new Set();
    this.openedStageIndex = index;
  }
}
