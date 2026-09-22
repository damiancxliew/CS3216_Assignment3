/**
 * I1 — Adventure Spec v2 (EXECUTION_SPEC §2, PRD FR-2/FR-3/FR-6b/FR-15a).
 *
 * Successor to the PoC's Blueprint v1. This is the planner's output and the
 * compiler's input. It describes *what* the adventure contains — stages, rooms,
 * stakeholders with private context, evidence with source spans, objectives,
 * decision options with branch targets, asset eligibility and ambient overlays —
 * and deliberately says nothing about geometry: coordinates, tiles, collision
 * and asset selection belong to the deterministic compiler (PRD D3).
 *
 * Style rules that keep this schema usable as an OpenAI strict structured-output
 * schema without a second copy:
 *   - no `.optional()`; absent values are `.nullable()`
 *   - closed enums only, all from `catalogue.ts`
 *   - all cross-reference checks live in `superRefine` so the JSON Schema stays
 *     simple and the errors are path-addressed for the repair loop (FR-4)
 */
import { z } from 'zod'

import {
  AMBIENT_OVERLAYS,
  ASSET_KIND_ENTITY,
  DECISION_STANCES,
  GENERATABLE_ASSET_KINDS,
  MAX_GENERATED_ASSETS,
  MODEL_TIERS,
  READING_BANDS,
  ROOM_KINDS,
  ROOM_SIZES,
  SOURCE_KINDS,
} from './catalogue'

export const SPEC_VERSION = 2 as const
export const SPEC_SCHEMA_ID = 'adventure-spec-v2.0'

export const MAX_STAGES = 3
export const MIN_STAKEHOLDERS = 3
export const MAX_STAKEHOLDERS = 4
export const MIN_ROOMS_PER_STAGE = 2
export const MAX_ROOMS_PER_STAGE = 5
export const MAX_AGENTS_PER_STAGE = 4
export const MAX_EVIDENCE_PER_STAGE = 6
export const MAX_OBJECTIVES_PER_STAGE = 8
export const MIN_DECISION_OPTIONS = 2
export const MAX_DECISION_OPTIONS = 4
export const MAX_ENDINGS = 4

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

/** Same safe identifier grammar as the PoC: lowercase slug, ≤48 chars. */
export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const idSchema = z.string().min(1).max(48).regex(ID_PATTERN, 'must be a lowercase slug (a-z, 0-9, hyphens)')

const text = (max: number) => z.string().trim().min(1).max(max)

/**
 * A page-accurate pointer into an uploaded source (FR-3). `quote` is a short
 * verbatim excerpt so the span can be verified against the extracted page text
 * (D2) and shown in the debrief (FR-19).
 */
export const sourceSpanSchema = z.object({
  sourceId: idSchema,
  page: z.number().int().min(1),
  quote: text(400),
})
export type SourceSpan = z.infer<typeof sourceSpanSchema>

/**
 * Grounding record: what documented history a piece of content rests on, and
 * which explicit simulation assumptions fill the gaps. At least one of the two
 * must be present — silent invention is not representable (FR-3).
 */
const groundingFields = {
  spans: z.array(sourceSpanSchema).max(8),
  assumptionIds: z.array(idSchema).max(8),
}
const requireGrounding = (value: { spans: unknown[]; assumptionIds: unknown[] }, ctx: z.RefinementCtx) => {
  if (value.spans.length + value.assumptionIds.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'must cite at least one source span or one simulation assumption',
      path: ['spans'],
    })
  }
}

export const groundingSchema = z.object(groundingFields).superRefine(requireGrounding)
export type Grounding = z.infer<typeof groundingSchema>

const grounded = (max: number) => z.object({ text: text(max), ...groundingFields }).superRefine(requireGrounding)
export type GroundedText = z.infer<ReturnType<typeof grounded>>

// ---------------------------------------------------------------------------
// adventure-level records
// ---------------------------------------------------------------------------

export const readingLevelSchema = z
  .object({
    band: z.enum(READING_BANDS),
    ageMin: z.number().int().min(7).max(19),
    ageMax: z.number().int().min(7).max(19),
  })
  .refine((r) => r.ageMin <= r.ageMax, { message: 'ageMin must be ≤ ageMax', path: ['ageMax'] })
export type ReadingLevel = z.infer<typeof readingLevelSchema>

export const playerSchema = z.object({
  name: text(80),
  role: text(120),
  brief: text(1500),
})

/** Metadata of an uploaded source. Written by ingest (D1), never by the planner. */
export const sourceRecordSchema = z.object({
  id: idSchema,
  title: text(160),
  kind: z.enum(SOURCE_KINDS),
  pageCount: z.number().int().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 hex'),
})
export type SourceRecord = z.infer<typeof sourceRecordSchema>

/** An explicit simulation assumption: an invented detail, named so the debrief can flag it. */
export const assumptionSchema = z.object({
  id: idSchema,
  text: text(500),
  rationale: text(500),
})
export type Assumption = z.infer<typeof assumptionSchema>

export const ambientOverlaySchema = z.object({
  id: z.enum(AMBIENT_OVERLAYS),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
})
export type AmbientOverlay = z.infer<typeof ambientOverlaySchema>

/**
 * A historical stakeholder as an adventure-wide identity. Per-stage placement,
 * public position and private context live on `stages[].agents[]` so the same
 * person can hold a grudge from stage 1 into stage 3.
 */
export const stakeholderSchema = z.object({
  id: idSchema,
  name: text(80),
  role: text(120),
  summary: grounded(600),
})
export type Stakeholder = z.infer<typeof stakeholderSchema>

/**
 * Asset eligibility (FR-6b). Only these entries may ever hit the image model.
 * `kind` is a closed enum of scene/story-specific things; terrain, structural
 * and UI art cannot be expressed here and therefore cannot be requested.
 */
export const assetEligibilitySchema = z.object({
  id: idSchema,
  kind: z.enum(GENERATABLE_ASSET_KINDS),
  /** The spec entity this asset depicts: a stakeholder (portrait), room (landmark) or evidence (prop). */
  entityId: idSchema,
  subject: text(120),
  /** Visual brief for the image model. Delimited data, never instructions. */
  prompt: text(600),
})
export type AssetEligibility = z.infer<typeof assetEligibilitySchema>

// ---------------------------------------------------------------------------
// stage-level records
// ---------------------------------------------------------------------------

export const roomSchema = z.object({
  id: idSchema,
  name: text(100),
  purpose: text(400),
  kind: z.enum(ROOM_KINDS),
  size: z.enum(ROOM_SIZES),
  doorDefault: z.enum(['open', 'closed']),
  /** A named, story-specific feature of the room (a gallows, a treaty table). Null for plain rooms. */
  landmark: z.object({ name: text(100), description: text(300) }).nullable(),
})
export type Room = z.infer<typeof roomSchema>

/**
 * Private context (PRD D8). Server-side only — this object must never appear in
 * a client payload (FR-21). The Turn API's `findForbiddenKeys` lists
 * `privateContext` and `knowledgeHorizon` for exactly this reason.
 */
export const privateContextSchema = z
  .object({
    persona: text(800),
    motivations: text(800),
    hiddenInterests: text(800),
    /** What this person could plausibly know at this point in time — and not more. */
    knowledgeHorizon: text(800),
    ...groundingFields,
  })
  .superRefine(requireGrounding)
export type PrivateContext = z.infer<typeof privateContextSchema>

export const agentSchema = z.object({
  id: idSchema,
  stakeholderId: idSchema,
  startRoomId: idSchema,
  publicPosition: grounded(600),
  privateContext: privateContextSchema,
  modelTier: z.enum(MODEL_TIERS),
})
export type Agent = z.infer<typeof agentSchema>

export const evidenceSchema = z.object({
  id: idSchema,
  name: text(120),
  roomId: idSchema,
  /** Must carry ≥1 source span: evidence is documented history by definition. */
  content: z
    .object({ text: text(1500), spans: z.array(sourceSpanSchema).min(1).max(8), assumptionIds: z.array(idSchema).max(8) })
    .superRefine(requireGrounding),
})
export type Evidence = z.infer<typeof evidenceSchema>

export const objectiveSchema = z.object({
  id: idSchema,
  title: text(160),
  /** Objective ids that must be complete first. Acyclic. */
  requires: z.array(idSchema).max(8),
  /** An agent id or evidence id in the same stage. */
  targetId: idSchema,
})
export type Objective = z.infer<typeof objectiveSchema>

export const branchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), stageId: idSchema }),
  z.object({ kind: z.literal('ending'), endingId: idSchema }),
])
export type BranchTarget = z.infer<typeof branchTargetSchema>

/**
 * A decision option the Resolver may offer (FR-14). Preconditions are objective
 * ids; the Resolver re-derives availability from state on every turn. Outcomes
 * are never previewed here (PRD D11) — the option only says where play goes next.
 */
export const decisionOptionSchema = z.object({
  id: idSchema,
  label: text(160),
  stance: z.enum(DECISION_STANCES),
  preconditions: z.array(idSchema).max(8),
  branchTarget: branchTargetSchema,
})
export type DecisionOption = z.infer<typeof decisionOptionSchema>

export const decisionSchema = z.object({
  id: idSchema,
  title: text(160),
  prompt: text(600),
  roomId: idSchema,
  requires: z.array(idSchema).min(1).max(8),
  options: z.array(decisionOptionSchema).min(MIN_DECISION_OPTIONS).max(MAX_DECISION_OPTIONS),
})
export type Decision = z.infer<typeof decisionSchema>

export const stageSchema = z.object({
  id: idSchema,
  index: z.number().int().min(0).max(MAX_STAGES - 1),
  title: text(120),
  sharedContext: grounded(2500),
  /** Seconds. `null` inherits `defaultTimerSeconds`; `0` disables the timer for this stage (D12/FR-16). */
  timerSeconds: z.number().int().min(0).max(3600).nullable(),
  /** `null` inherits the adventure-level overlay (FR-15a). */
  ambientOverlay: ambientOverlaySchema.nullable(),
  spawnRoomId: idSchema,
  rooms: z.array(roomSchema).min(MIN_ROOMS_PER_STAGE).max(MAX_ROOMS_PER_STAGE),
  agents: z.array(agentSchema).min(1).max(MAX_AGENTS_PER_STAGE),
  evidence: z.array(evidenceSchema).min(1).max(MAX_EVIDENCE_PER_STAGE),
  objectives: z.array(objectiveSchema).min(1).max(MAX_OBJECTIVES_PER_STAGE),
  decision: decisionSchema,
})
export type Stage = z.infer<typeof stageSchema>

export const endingSchema = z.object({
  id: idSchema,
  title: text(120),
  /** What happens in the simulation when play reaches this ending. */
  summary: text(1500),
  /** What actually happened, with citations (FR-19). */
  historicalOutcome: grounded(1500),
  /** Where the simulated path diverged from the record. */
  divergence: text(1000),
  reflectionQuestions: z.array(text(300)).min(2).max(4),
})
export type Ending = z.infer<typeof endingSchema>

// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------

const adventureSpecShape = {
  version: z.literal(SPEC_VERSION),
  id: idSchema,
  title: text(120),
  setting: text(200),
  description: text(1500),
  readingLevel: readingLevelSchema,
  learningObjectives: z.array(text(300)).min(1).max(6),
  player: playerSchema,
  sources: z.array(sourceRecordSchema).min(1).max(12),
  /** Shared historical context every agent and the player receive (PRD D8). */
  sharedContext: grounded(4000),
  assumptions: z.array(assumptionSchema).max(30),
  stakeholders: z.array(stakeholderSchema).min(MIN_STAKEHOLDERS).max(MAX_STAKEHOLDERS),
  /** Adventure-wide timer default in seconds; 0 disables (D12/FR-16). */
  defaultTimerSeconds: z.number().int().min(0).max(3600),
  /** Adventure-wide ambient default; stages may override (FR-15a). */
  ambientOverlay: ambientOverlaySchema,
  stages: z.array(stageSchema).min(1).max(MAX_STAGES),
  endings: z.array(endingSchema).min(1).max(MAX_ENDINGS),
  assetEligibility: z.array(assetEligibilitySchema).max(MAX_GENERATED_ASSETS),
}

export const adventureSpecObjectSchema = z.object(adventureSpecShape)
export type AdventureSpecShape = z.infer<typeof adventureSpecObjectSchema>

/**
 * Cross-reference and structural checks that a JSON Schema cannot express.
 * Every issue carries a JSON path so the repair loop can hand the planner a
 * precise list of what to fix (FR-4).
 */
export function refineAdventureSpec(spec: AdventureSpecShape, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', message, path })

  // -- global id uniqueness ---------------------------------------------------
  const seen = new Map<string, string>()
  const register = (id: string, path: (string | number)[]) => {
    const where = path.join('.')
    const previous = seen.get(id)
    if (previous) issue(path, `duplicate id "${id}" (also at ${previous})`)
    else seen.set(id, where)
  }
  register(spec.id, ['id'])
  spec.sources.forEach((s, i) => register(s.id, ['sources', i, 'id']))
  spec.assumptions.forEach((a, i) => register(a.id, ['assumptions', i, 'id']))
  spec.stakeholders.forEach((s, i) => register(s.id, ['stakeholders', i, 'id']))
  spec.endings.forEach((e, i) => register(e.id, ['endings', i, 'id']))
  spec.assetEligibility.forEach((a, i) => register(a.id, ['assetEligibility', i, 'id']))
  spec.stages.forEach((stage, si) => {
    register(stage.id, ['stages', si, 'id'])
    stage.rooms.forEach((r, i) => register(r.id, ['stages', si, 'rooms', i, 'id']))
    stage.agents.forEach((a, i) => register(a.id, ['stages', si, 'agents', i, 'id']))
    stage.evidence.forEach((e, i) => register(e.id, ['stages', si, 'evidence', i, 'id']))
    stage.objectives.forEach((o, i) => register(o.id, ['stages', si, 'objectives', i, 'id']))
    register(stage.decision.id, ['stages', si, 'decision', 'id'])
    stage.decision.options.forEach((o, i) => register(o.id, ['stages', si, 'decision', 'options', i, 'id']))
  })

  const sourceById = new Map(spec.sources.map((s) => [s.id, s]))
  const assumptionIds = new Set(spec.assumptions.map((a) => a.id))
  const stakeholderIds = new Set(spec.stakeholders.map((s) => s.id))
  const endingIds = new Set(spec.endings.map((e) => e.id))
  const stageById = new Map(spec.stages.map((s) => [s.id, s]))

  // -- grounding references ---------------------------------------------------
  const checkGrounding = (g: { spans: SourceSpan[]; assumptionIds: string[] }, path: (string | number)[]) => {
    g.spans.forEach((span, i) => {
      const source = sourceById.get(span.sourceId)
      if (!source) issue([...path, 'spans', i, 'sourceId'], `unknown source "${span.sourceId}"`)
      else if (span.page > source.pageCount)
        issue([...path, 'spans', i, 'page'], `page ${span.page} is beyond source "${source.id}" (${source.pageCount} pages)`)
    })
    g.assumptionIds.forEach((id, i) => {
      if (!assumptionIds.has(id)) issue([...path, 'assumptionIds', i], `unknown assumption "${id}"`)
    })
  }
  checkGrounding(spec.sharedContext, ['sharedContext'])
  spec.stakeholders.forEach((s, i) => checkGrounding(s.summary, ['stakeholders', i, 'summary']))
  spec.endings.forEach((e, i) => checkGrounding(e.historicalOutcome, ['endings', i, 'historicalOutcome']))

  // -- stages -----------------------------------------------------------------
  const targetedStages = new Set<string>()
  const targetedEndings = new Set<string>()
  const placedStakeholders = new Set<string>()

  spec.stages.forEach((stage, si) => {
    const path = ['stages', si]
    if (stage.index !== si) issue([...path, 'index'], `stage index must be ${si} (stages are ordered)`)

    const roomIds = new Set(stage.rooms.map((r) => r.id))
    const agentIds = new Set(stage.agents.map((a) => a.id))
    const evidenceIds = new Set(stage.evidence.map((e) => e.id))
    const objectiveIds = new Set(stage.objectives.map((o) => o.id))

    if (!roomIds.has(stage.spawnRoomId)) issue([...path, 'spawnRoomId'], `unknown room "${stage.spawnRoomId}" in this stage`)
    checkGrounding(stage.sharedContext, [...path, 'sharedContext'])

    const stageStakeholders = new Set<string>()
    stage.agents.forEach((agent, i) => {
      const p = [...path, 'agents', i]
      if (!stakeholderIds.has(agent.stakeholderId)) issue([...p, 'stakeholderId'], `unknown stakeholder "${agent.stakeholderId}"`)
      if (stageStakeholders.has(agent.stakeholderId))
        issue([...p, 'stakeholderId'], `stakeholder "${agent.stakeholderId}" appears twice in this stage`)
      stageStakeholders.add(agent.stakeholderId)
      placedStakeholders.add(agent.stakeholderId)
      if (!roomIds.has(agent.startRoomId)) issue([...p, 'startRoomId'], `unknown room "${agent.startRoomId}" in this stage`)
      checkGrounding(agent.publicPosition, [...p, 'publicPosition'])
      checkGrounding(agent.privateContext, [...p, 'privateContext'])
    })

    stage.evidence.forEach((item, i) => {
      const p = [...path, 'evidence', i]
      if (!roomIds.has(item.roomId)) issue([...p, 'roomId'], `unknown room "${item.roomId}" in this stage`)
      checkGrounding(item.content, [...p, 'content'])
    })

    // A closed door can only be opened from inside (D7), so a closed room nobody starts in
    // is sealed for the whole stage — and the runtime refuses to build such a world.
    const occupiedAtStart = new Set([stage.spawnRoomId, ...stage.agents.map((a) => a.startRoomId)])
    stage.rooms.forEach((room, i) => {
      if (room.doorDefault === 'closed' && !occupiedAtStart.has(room.id))
        issue(
          [...path, 'rooms', i, 'doorDefault'],
          `room "${room.id}" starts closed with nobody inside, so it can never be opened: place an agent in it, or make its door open`,
        )
    })

    const objectiveById = new Map(stage.objectives.map((o) => [o.id, o]))
    stage.objectives.forEach((objective, i) => {
      const p = [...path, 'objectives', i]
      if (!agentIds.has(objective.targetId) && !evidenceIds.has(objective.targetId))
        issue([...p, 'targetId'], `"${objective.targetId}" is not an agent or evidence id in this stage`)
      objective.requires.forEach((dep, j) => {
        if (dep === objective.id) issue([...p, 'requires', j], 'objective cannot require itself')
        else if (!objectiveIds.has(dep)) issue([...p, 'requires', j], `unknown objective "${dep}" in this stage`)
      })
    })
    // cycle detection over the objective graph
    const state = new Map<string, 'visiting' | 'done'>()
    const visit = (id: string, trail: string[]): void => {
      const s = state.get(id)
      if (s === 'done') return
      if (s === 'visiting') {
        issue([...path, 'objectives'], `objective dependency cycle: ${[...trail, id].join(' -> ')}`)
        return
      }
      state.set(id, 'visiting')
      objectiveById.get(id)?.requires.forEach((dep) => visit(dep, [...trail, id]))
      state.set(id, 'done')
    }
    stage.objectives.forEach((o) => visit(o.id, []))

    const decision = stage.decision
    const dp = [...path, 'decision']
    if (!roomIds.has(decision.roomId)) issue([...dp, 'roomId'], `unknown room "${decision.roomId}" in this stage`)
    decision.requires.forEach((dep, j) => {
      if (!objectiveIds.has(dep)) issue([...dp, 'requires', j], `unknown objective "${dep}" in this stage`)
    })
    // every objective must feed the decision, otherwise it is dead content
    const reachable = new Set<string>()
    const collect = (id: string) => {
      if (reachable.has(id)) return
      reachable.add(id)
      objectiveById.get(id)?.requires.forEach(collect)
    }
    decision.requires.forEach(collect)
    stage.objectives.forEach((o, i) => {
      if (!reachable.has(o.id))
        issue([...path, 'objectives', i, 'id'], `objective "${o.id}" is not (transitively) required by the stage decision`)
    })

    const isLast = si === spec.stages.length - 1
    decision.options.forEach((option, i) => {
      const op = [...dp, 'options', i]
      option.preconditions.forEach((dep, j) => {
        if (!objectiveIds.has(dep)) issue([...op, 'preconditions', j], `unknown objective "${dep}" in this stage`)
      })
      const target = option.branchTarget
      if (target.kind === 'stage') {
        const next = stageById.get(target.stageId)
        if (!next) issue([...op, 'branchTarget', 'stageId'], `unknown stage "${target.stageId}"`)
        else if (next.index <= stage.index)
          issue([...op, 'branchTarget', 'stageId'], `branch must move forward (stage ${next.index} is not after ${stage.index})`)
        else targetedStages.add(target.stageId)
        if (isLast) issue([...op, 'branchTarget'], 'options in the final stage must branch to an ending')
      } else {
        if (!endingIds.has(target.endingId)) issue([...op, 'branchTarget', 'endingId'], `unknown ending "${target.endingId}"`)
        else targetedEndings.add(target.endingId)
      }
    })
  })

  spec.stages.forEach((stage, si) => {
    if (si > 0 && !targetedStages.has(stage.id)) issue(['stages', si, 'id'], `stage "${stage.id}" is unreachable: no option branches to it`)
  })
  spec.endings.forEach((ending, i) => {
    if (!targetedEndings.has(ending.id)) issue(['endings', i, 'id'], `ending "${ending.id}" is unreachable: no option branches to it`)
  })
  spec.stakeholders.forEach((s, i) => {
    if (!placedStakeholders.has(s.id)) issue(['stakeholders', i, 'id'], `stakeholder "${s.id}" never appears as an agent in any stage`)
  })

  // -- asset eligibility (FR-6b) ----------------------------------------------
  const roomIdsAll = new Set(spec.stages.flatMap((s) => s.rooms.map((r) => r.id)))
  const evidenceIdsAll = new Set(spec.stages.flatMap((s) => s.evidence.map((e) => e.id)))
  const assetEntities = new Set<string>()
  spec.assetEligibility.forEach((asset, i) => {
    const p = ['assetEligibility', i]
    const entity = ASSET_KIND_ENTITY[asset.kind]
    const pool = entity === 'stakeholder' ? stakeholderIds : entity === 'room' ? roomIdsAll : evidenceIdsAll
    if (!pool.has(asset.entityId)) issue([...p, 'entityId'], `${asset.kind} must reference a ${entity} id; "${asset.entityId}" is not one`)
    if (assetEntities.has(asset.entityId)) issue([...p, 'entityId'], `entity "${asset.entityId}" already has a generated asset`)
    assetEntities.add(asset.entityId)
  })
}

export const adventureSpecSchema = adventureSpecObjectSchema.superRefine(refineAdventureSpec)
export type AdventureSpec = z.infer<typeof adventureSpecSchema>

// ---------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------

export interface SpecIssue {
  path: string
  message: string
}

export type SpecValidation = { ok: true; spec: AdventureSpec } | { ok: false; issues: SpecIssue[] }

export function formatIssuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '$' : `$.${path.map(String).join('.')}`
}

/** Validate untrusted JSON as an Adventure Spec v2. Never throws. */
export function validateAdventureSpec(value: unknown): SpecValidation {
  const parsed = adventureSpecSchema.safeParse(value)
  if (parsed.success) return { ok: true, spec: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ path: formatIssuePath(i.path), message: i.message })),
  }
}

/**
 * Validate a version that was already published. Published versions are frozen
 * and in-flight attempts depend on them, so they are held to the shape only:
 * an authoring rule added later must not retire an adventure teachers are
 * already running. Never use this to accept new authoring.
 */
export function validatePublishedSpec(value: unknown): SpecValidation {
  const parsed = adventureSpecObjectSchema.safeParse(value)
  if (parsed.success) return { ok: true, spec: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ path: formatIssuePath(i.path), message: i.message })),
  }
}

/** Effective per-stage values after inheritance (timer D12, overlay FR-15a). */
export function resolveStageSettings(spec: AdventureSpec, stage: Stage): { timerSeconds: number; ambientOverlay: AmbientOverlay } {
  return {
    timerSeconds: stage.timerSeconds ?? spec.defaultTimerSeconds,
    ambientOverlay: stage.ambientOverlay ?? spec.ambientOverlay,
  }
}

/**
 * Public projection of a spec: everything the client may see. Strips every
 * `privateContext` (FR-21). Kept here so the shape of "public" is defined next
 * to the shape of "private".
 */
export function publicProjection(spec: AdventureSpec) {
  return {
    ...spec,
    stages: spec.stages.map((stage) => ({
      ...stage,
      agents: stage.agents.map(({ privateContext: _private, ...agent }) => agent),
    })),
  }
}
