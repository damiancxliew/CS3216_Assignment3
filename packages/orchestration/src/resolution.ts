/**
 * I4 — Resolution payload (EXECUTION_SPEC §2, PRD FR-15 / FR-15b / FR-21).
 *
 * The structured outcome the Resolver writes and the DB stores as a `resolution` row. The split in
 * this file is the server-authority boundary, made structural rather than procedural:
 *
 *   - `outcome`   — what happened to the world. Public announcement, effects, state deltas.
 *   - `rolls`     — the probability rolls behind it (D10). Server-side only.
 *   - `privateNotes`, `rationale` — why it happened. Server-side only.
 *
 * `publicResolution` is the only supported way to turn a record into something a client may see,
 * and it is built from the public fields rather than by deleting the private ones, so a new private
 * field cannot leak by being forgotten (FR-21).
 */
import { z } from 'zod'

import { EFFECT_TEXT, SCENE_EFFECTS, isSceneEffectId, type SceneEffectId } from './catalogue'
import { actorActionSchema } from './actions'

export const RESOLUTION_VERSION = 1 as const

const id = z.string().min(1).max(64)

/** Where an effect plays: a tile, an entity id, or nowhere in particular (FR-15b). */
export const effectAnchorSchema = z.union([z.object({ x: z.number(), y: z.number() }), id])
export type EffectAnchor = z.infer<typeof effectAnchorSchema>

export const sceneEffectSchema = z.object({
  id: z.enum(SCENE_EFFECTS),
  at: effectAnchorSchema.nullable(),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
})
export type SceneEffect = z.infer<typeof sceneEffectSchema>

/** The client-facing form of an effect: same thing plus its text equivalent (FR-15c). */
export interface PublicEffect extends SceneEffect {
  text: string
}

/** One probability roll (D10). Never projected: the player is not shown the odds, before or after. */
export const rollSchema = z.object({
  id,
  /** What was rolled for, for the debrief and for M13. */
  label: z.string().min(1).max(200),
  probability: z.number().min(0).max(1),
  value: z.number().min(0).max(1),
  success: z.boolean(),
})
export type Roll = z.infer<typeof rollSchema>

/** How a stakeholder's standing toward the player moved. Disposition is world state, not rationale. */
export const agentDeltaSchema = z.object({
  agentId: id,
  dispositionDelta: z.number().int().min(-3).max(3),
  disposition: z.number().int().min(-5).max(5),
})
export type AgentDelta = z.infer<typeof agentDeltaSchema>

export const worldDeltaSchema = z.object({
  /** Dotted path into the attempt's world state, e.g. `treaty.signed`. */
  path: z.string().min(1).max(120),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  /** One line the debrief can show for this change (FR-19). */
  summary: z.string().min(1).max(300),
})
export type WorldDelta = z.infer<typeof worldDeltaSchema>

/** Where play goes next. Authored in the spec, chosen by the option — not invented by the model. */
export const nextStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), stageId: id }),
  z.object({ kind: z.literal('ending'), endingId: id }),
  z.object({ kind: z.literal('continue') }),
])
export type NextStep = z.infer<typeof nextStepSchema>

export const outcomeSchema = z.object({
  /** The only narrative text the player sees for this resolution. No odds, no rationale (D11). */
  announcement: z.string().min(1).max(1200),
  effects: z.array(sceneEffectSchema).max(4),
  agentDeltas: z.array(agentDeltaSchema).max(8),
  worldDeltas: z.array(worldDeltaSchema).max(16),
  /** Appended to the shared historical context every actor receives (D8). Public by definition. */
  sharedContextAppend: z.string().max(1200).nullable(),
  next: nextStepSchema,
})
export type Outcome = z.infer<typeof outcomeSchema>

export const RESOLUTION_TRIGGERS = ['decision', 'timer_expiry', 'stage_objective'] as const
export type ResolutionTrigger = (typeof RESOLUTION_TRIGGERS)[number]

export const resolutionRecordSchema = z.object({
  version: z.literal(RESOLUTION_VERSION),
  attemptId: id,
  stageId: id,
  resolvedAt: z.string().datetime(),
  trigger: z.enum(RESOLUTION_TRIGGERS),
  /** Everything the parties did this stage, already allow-listed (FR-20). */
  actions: z.array(actorActionSchema).max(256),
  outcome: outcomeSchema,
  rolls: z.array(rollSchema).max(16),
  /** Per-agent memory written by the resolution. Server-side only (FR-21). */
  privateNotes: z.array(z.object({ agentId: id, note: z.string().min(1).max(600) })).max(8),
  /** Why the Resolver decided what it decided. Server-side only (FR-21). */
  rationale: z.string().min(1).max(2000),
})
export type ResolutionRecord = z.infer<typeof resolutionRecordSchema>

export function validateResolutionRecord(value: unknown): { ok: true; record: ResolutionRecord } | { ok: false; issues: string[] } {
  const parsed = resolutionRecordSchema.safeParse(value)
  if (parsed.success) return { ok: true, record: parsed.data }
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`) }
}

export interface DroppedEffect {
  id: unknown
  detail: string
}

/**
 * Allow-list `effects[]` against the frozen catalogue (FR-15b/FR-20). An unknown id is dropped and
 * the turn still succeeds — a cosmetic layer may never fail a resolution.
 */
export function sanitizeEffects(candidates: readonly unknown[]): { effects: SceneEffect[]; dropped: DroppedEffect[] } {
  const effects: SceneEffect[] = []
  const dropped: DroppedEffect[] = []
  for (const candidate of candidates) {
    const rawId = (candidate as { id?: unknown } | null)?.id
    if (!isSceneEffectId(rawId)) {
      dropped.push({ id: rawId ?? null, detail: `"${String(rawId)}" is not in the frozen effect catalogue` })
      continue
    }
    const parsed = sceneEffectSchema.safeParse({
      id: rawId,
      at: (candidate as { at?: unknown }).at ?? null,
      intensity: (candidate as { intensity?: unknown }).intensity ?? null,
    })
    if (!parsed.success) {
      dropped.push({ id: rawId, detail: parsed.error.issues.map((i) => i.message).join('; ') })
      continue
    }
    effects.push(parsed.data)
  }
  return { effects, dropped }
}

export function toPublicEffect(effect: SceneEffect): PublicEffect {
  return { ...effect, text: EFFECT_TEXT[effect.id as SceneEffectId] }
}

/** The public projection of a resolution — the exact shape I3's decision response carries. */
export interface PublicResolution {
  announcement: string
  effects: PublicEffect[]
  nextStageId: string | null
  ending: boolean
}

/**
 * Build the client payload from the public fields only. Rolls, private notes and rationale are not
 * read here, so they cannot be projected (FR-21).
 */
export function publicResolution(record: ResolutionRecord): PublicResolution {
  const { outcome } = record
  return {
    announcement: outcome.announcement,
    effects: outcome.effects.map(toPublicEffect),
    nextStageId: outcome.next.kind === 'stage' ? outcome.next.stageId : null,
    ending: outcome.next.kind === 'ending',
  }
}
