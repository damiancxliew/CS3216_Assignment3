/**
 * I3 — Turn API contract (EXECUTION_SPEC §2).
 *
 * `POST /api/attempt/:id/message`, `POST /api/attempt/:id/decision` and
 * `GET /api/attempt/:id/state` all answer with a *public projection* of attempt
 * state. Private agent context, unrevealed events, probability rolls and
 * Resolver rationale are absent from these types by construction (FR-21), so a
 * handler cannot leak them without changing this file.
 */
import { z } from "zod";
import { MAP_THEMES, MAP_STYLES, environmentSchema } from "@adventure/generation/spec";

export { FORBIDDEN_RESPONSE_KEYS, findForbiddenKeys } from "@adventure/orchestration";

export const OUTDOORS_ROOM_ID = "__outdoors__";

export const AMBIENT_OVERLAYS = [
  "clear",
  "clouds",
  "rain",
  "thunderstorm",
  "haze",
  "fog",
  "night",
  "dust",
  "snow",
] as const;

export const SCENE_EFFECTS = [
  "explosion",
  "fire",
  "smoke",
  "confetti",
  "flash",
  "rubble",
  "crowd_cheer",
  "crowd_flee",
] as const;

export const publicRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().nullable(),
  enclosure: z.enum(["open", "enclosed"]),
  doorOpen: z.boolean(),
  occupantIds: z.array(z.string()),
});

/** Only the public half of an agent: `private_context` lives server-side. */
export const publicAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  publicPosition: z.string().nullable(),
  roomId: z.string().nullable(),
  portraitUrl: z.string().nullable(),
});

export const publicMessageSchema = z.object({
  id: z.string(),
  roomId: z.string().nullable(),
  authorType: z.enum(["player", "agent", "system"]),
  authorId: z.string().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

/**
 * Options are re-derived from state on every response (FR-14), so a stale
 * option is rejected rather than executed. `available: false` carries a
 * player-facing reason only — never a precondition dump.
 */
export const publicDecisionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});

export const publicEffectSchema = z.object({
  id: z.enum(SCENE_EFFECTS),
  at: z
    .union([z.object({ x: z.number(), y: z.number() }), z.string()])
    .nullable(),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  /** Text equivalent for the accessible path (FR-15c). */
  text: z.string(),
});

/**
 * Timers (D12/FR-16). The deadline is server-held; the client renders a
 * countdown from `deadlineAt` against `serverNow`, so a refresh or a client
 * clock change cannot buy extra time.
 */
export const publicTimerSchema = z.object({
  enabled: z.boolean(),
  deadlineAt: z.string().nullable(),
  serverNow: z.string(),
  secondsRemaining: z.number().nullable(),
});

/**
 * Decisions are actor-kind-neutral (D18/FR-14): agents commit or pass under the
 * same rules as players, and the stage closes once every actor has. The client
 * learns *that* an actor has committed so it can render "waiting on N", never
 * *what* they chose — the choice is only revealed through the resolution.
 */
export const publicActorCommitmentSchema = z.object({
  actorKind: z.enum(["player", "agent"]),
  actorId: z.string(),
  actorName: z.string(),
  committed: z.boolean(),
});

export const publicStageSchema = z.object({
  id: z.string(),
  index: z.number(),
  title: z.string(),
  sharedContext: z.string(),
  ambientOverlay: z.enum(AMBIENT_OVERLAYS),
  mapTheme: z.enum(MAP_THEMES),
  visualStyle: z.enum(MAP_STYLES).optional(),
  environment: environmentSchema.nullable().optional(),
  setting: z.string().optional(),
  overlayIntensity: z.number(),
  objectives: z.array(
    z.object({ id: z.string(), title: z.string(), met: z.boolean() }),
  ),
});

/** The identity authored for the student to play; unlike agent context, all of this is public. */
export const publicPlayerSchema = z.object({
  name: z.string(),
  role: z.string(),
  brief: z.string(),
});

export const publicAttemptStateSchema = z.object({
  attemptId: z.string(),
  adventureId: z.string(),
  publishedVersion: z.number(),
  status: z.enum(["active", "spectating", "completed", "abandoned"]),
  player: publicPlayerSchema,
  stage: publicStageSchema,
  timer: publicTimerSchema,
  mapArtifactId: z.string().nullable(),
  playerPos: z.object({ x: z.number(), y: z.number() }).nullable(),
  currentRoomId: z.string().nullable(),
  rooms: z.array(publicRoomSchema),
  agents: z.array(publicAgentSchema),
  transcript: z.array(publicMessageSchema),
  journal: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      sourceSpan: z.string().nullable(),
      collectedAt: z.string(),
    }),
  ),
  options: z.array(publicDecisionOptionSchema),
  /** Every actor that must commit before this stage closes, players included. */
  commitments: z.array(publicActorCommitmentSchema),
  announcements: z.array(
    z.object({ id: z.string(), body: z.string(), createdAt: z.string() }),
  ),
  pendingEffects: z.array(publicEffectSchema),
  /** Monotonic per-attempt revision; the client discards out-of-order replies. */
  revision: z.number(),
});

export const messageRequestSchema = z.object({
  roomId: z.string().min(1),
  body: z.string().min(1).max(2000),
});

export const messageResponseSchema = z.object({
  accepted: z.literal(true),
  newMessages: z.array(publicMessageSchema),
  state: publicAttemptStateSchema,
});

export const decisionRequestSchema = z.object({
  optionId: z.string().min(1),
});

export const decisionResponseSchema = z.object({
  accepted: z.literal(true),
  /** Public announcement only — the roll and the rationale stay server-side. */
  resolution: z.object({
    announcement: z.string(),
    effects: z.array(publicEffectSchema),
    nextStageId: z.string().nullable(),
    ending: z.boolean(),
  }),
  state: publicAttemptStateSchema,
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "unauthorized",
      "not_found",
      "invalid_request",
      "stale_option",
      "stale_state",
      "conflict",
      "stage_closed",
      "rate_limited",
      "incompatible_version",
    ]),
    message: z.string(),
  }),
});

export type PublicAttemptState = z.infer<typeof publicAttemptStateSchema>;
export type PublicMessage = z.infer<typeof publicMessageSchema>;
export type PublicActorCommitment = z.infer<typeof publicActorCommitmentSchema>;
export type PublicEffect = z.infer<typeof publicEffectSchema>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
