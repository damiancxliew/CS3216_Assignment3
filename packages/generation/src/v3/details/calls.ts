/**
 * The four detail calls — stage, persona (one per major), minors (one call for all), link —
 * each with its own repair loop identical to the skeleton pass: same system prompt, user turn =
 * original message + previous raw JSON + the issues as a repair message.
 */
import type { CheckIssue, SkeletonShape } from '@adventure/spec-v3'
import type { z } from 'zod'

import type { ExtractedDocument } from '../../ingest/types'
import type { LlmClient, LlmUsage } from '../../llm/client'
import { estimateCostUsd, ZERO_USAGE } from '../../llm/client'
import { sourceTexts } from '../grounding'
import { V3_MODEL } from '../config'
import type { PartResume } from '../parts'
import { MAX_REPAIRS, skeletonRepairMessage, sourcesBlock } from '../skeleton/index'
import { linkIssues, minorsIssues, personaIssues, stageIssues } from './checks'
import type { LinkContext } from './checks'
import { fillPrompt, LINK_SYSTEM_PROMPT, MINORS_SYSTEM_PROMPT, PERSONA_SYSTEM_PROMPT, STAGE_DETAILS_SYSTEM_PROMPT } from './prompt'
import type { LinkLlmOutput, MinorsLlmOutput, PersonaLlmOutput, StageDetailsLlmOutput } from './schema'
import { detailsJsonSchema, LinkLlmOutput as LinkWire, MinorsLlmOutput as MinorsWire, PersonaLlmOutput as PersonaWire, StageDetailsLlmOutput as StageWire } from './schema'

export const DETAILS_MODEL = V3_MODEL
export const LINK_MODEL = V3_MODEL

export interface DetailCallMetrics {
  label: string
  model: string
  latencyMs: number
  usage: LlmUsage
  costUsd: number | null
  issueCount: number
}

export interface DetailCallOptions {
  llm: LlmClient
  model?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | null
  maxOutputTokens?: number
}

export interface CallResult<T> {
  output?: T
  /** raw text of the last reply (for repair follow-ups) */
  raw: string | null
  issues: CheckIssue[]
  warnings: CheckIssue[]
  calls: DetailCallMetrics[]
  /** Post-merge repair: re-run this call with `issues` as the repair issues (previous raw included). */
  rerun: (issues: CheckIssue[]) => Promise<CallResult<T>>
}

interface CallConfig<T> {
  label: string
  schemaName: string
  schema: z.ZodType<T>
  system: string
  user: string
  check: (output: T) => { errors: CheckIssue[]; warnings: CheckIssue[] }
}

export async function runCall<T>(
  config: CallConfig<T>,
  opts: DetailCallOptions,
  defaults: { model: string; reasoningEffort: 'low' | 'medium' | 'high' },
  from?: PartResume,
): Promise<CallResult<T>> {
  const model = opts.model ?? defaults.model
  const reasoningEffort = opts.reasoningEffort === undefined ? defaults.reasoningEffort : opts.reasoningEffort
  const maxOutputTokens = opts.maxOutputTokens ?? 16_000
  const jsonSchema = detailsJsonSchema(config.schema)

  const calls: DetailCallMetrics[] = []
  let raw: string | null = null

  const invoke = async (userTurn: string): Promise<{ output?: T; issues: CheckIssue[]; warnings: CheckIssue[] }> => {
    const response = await opts.llm.completeJson({
      model,
      system: config.system,
      user: userTurn,
      schemaName: config.schemaName,
      jsonSchema,
      maxOutputTokens,
      reasoningEffort,
    })
    raw = response.text
    let issues: CheckIssue[]
    let warnings: CheckIssue[] = []
    let output: T | undefined
    if (response.refusal !== null || response.json === null || response.json === undefined) {
      issues = [{ code: 'llm-output', path: '', message: response.refusal ?? 'model returned no parseable JSON' }]
    } else {
      const parsed = config.schema.safeParse(response.json)
      if (!parsed.success) issues = parsed.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message }))
      else {
        const checked = config.check(parsed.data)
        issues = checked.errors
        warnings = checked.warnings
        output = parsed.data
      }
    }
    calls.push({
      label: config.label,
      model: response.model,
      latencyMs: response.latencyMs,
      usage: response.usage ?? ZERO_USAGE,
      costUsd: estimateCostUsd(response.model, response.usage ?? ZERO_USAGE),
      issueCount: issues.length,
    })
    return { ...(output !== undefined ? { output } : {}), issues, warnings }
  }

  const repairTurn = (issues: CheckIssue[]) =>
    `${config.user}\n\nYour previous output:\n\`\`\`json\n${raw ?? ''}\n\`\`\`\n\n${skeletonRepairMessage(issues)}`

  const makeResult = (out: { output?: T; issues: CheckIssue[]; warnings: CheckIssue[] }): CallResult<T> => ({
    ...out,
    raw,
    calls,
    rerun: async (repairIssues) => {
      let next = await invoke(repairTurn(repairIssues))
      for (let attempt = 0; next.issues.length > 0 && attempt < MAX_REPAIRS - 1; attempt++) next = await invoke(repairTurn(next.issues))
      return makeResult(next)
    },
  })

  if (from !== undefined) raw = JSON.stringify(from.output)
  let result = await invoke(from !== undefined ? repairTurn(from.issues) : config.user)
  for (let attempt = 0; result.issues.length > 0 && attempt < MAX_REPAIRS; attempt++) result = await invoke(repairTurn(result.issues))

  return makeResult(result)
}

// --- the four call kinds -------------------------------------------------------------

export interface DetailsShared {
  skeleton: SkeletonShape
  documents: ExtractedDocument[]
  readingLevel: 'sec' | 'jc'
}

const skeletonJsonBlock = (skeleton: SkeletonShape) => `\`\`\`json\n${JSON.stringify(skeleton, null, 2)}\n\`\`\``

export function generateStageDetails(stageId: string, shared: DetailsShared, opts: DetailCallOptions, from?: PartResume): Promise<CallResult<StageDetailsLlmOutput>> {
  const ctx = { skeleton: shared.skeleton, sources: sourceTexts(shared.documents) }
  return runCall(
    {
      label: `stage ${stageId}`,
      schemaName: 'stage_details_v3',
      schema: StageWire,
      system: fillPrompt(STAGE_DETAILS_SYSTEM_PROMPT, { readingLevel: shared.readingLevel, stageId }),
      user: `Write stage: ${stageId}\nReading level: ${shared.readingLevel}\n\n${skeletonJsonBlock(shared.skeleton)}\n\n${sourcesBlock(shared.documents)}`,
      check: (output) => stageIssues(stageId, output, ctx),
    },
    opts,
    { model: DETAILS_MODEL, reasoningEffort: 'medium' },
    from,
  )
}

export function generatePersona(characterId: string, shared: DetailsShared, opts: DetailCallOptions, from?: PartResume): Promise<CallResult<PersonaLlmOutput>> {
  const ctx = { skeleton: shared.skeleton, sources: sourceTexts(shared.documents) }
  const character = shared.skeleton.characters.find((c) => c.id === characterId)!
  const stageIds = shared.skeleton.stages.filter((s) => Object.keys(s.placement).includes(characterId)).map((s) => s.id)
  return runCall(
    {
      label: `persona ${characterId}`,
      schemaName: 'persona_v3',
      schema: PersonaWire,
      system: fillPrompt(PERSONA_SYSTEM_PROMPT, { readingLevel: shared.readingLevel, characterId }),
      user: `Write character: ${characterId} (${character.name})\nPresent in stages: ${stageIds.join(', ')}\nStances are numbered s1, s2, …\n\n${skeletonJsonBlock(shared.skeleton)}\n\n${sourcesBlock(shared.documents)}`,
      check: (output) => personaIssues(characterId, output, ctx),
    },
    opts,
    { model: DETAILS_MODEL, reasoningEffort: 'medium' },
    from,
  )
}

export function generateMinors(shared: DetailsShared, opts: DetailCallOptions, from?: PartResume): Promise<CallResult<MinorsLlmOutput>> {
  const ctx = { skeleton: shared.skeleton, sources: sourceTexts(shared.documents) }
  const list = shared.skeleton.characters
    .filter((c) => c.tier === 'minor')
    .map((c) => `${c.id} (${c.name})`)
    .join(', ')
  return runCall(
    {
      label: 'minors',
      schemaName: 'minors_v3',
      schema: MinorsWire,
      system: fillPrompt(MINORS_SYSTEM_PROMPT, { readingLevel: shared.readingLevel }),
      user: `Write these minor characters: ${list}\n\n${skeletonJsonBlock(shared.skeleton)}\n\n${sourcesBlock(shared.documents)}`,
      check: (output) => minorsIssues(output, ctx),
    },
    opts,
    { model: DETAILS_MODEL, reasoningEffort: 'medium' },
    from,
  )
}

export function linkDetails(context: LinkContext, shared: DetailsShared, opts: DetailCallOptions, from?: PartResume): Promise<CallResult<LinkLlmOutput>> {
  const compact = {
    characters: context.characters.map((c) => ({
      id: c.id,
      name: shared.skeleton.characters.find((x) => x.id === c.id)?.name ?? c.id,
      tier: c.tier,
      stageIds: c.stageIds,
      persona: c.persona,
      initialStanceId: c.initialStanceId,
      stances: c.stances,
      slants: c.slants.map((s) => {
        const external = s.contradictedBy.filter((id) => context.discoveries.find((d) => d.id === id)?.holder !== `character:${c.id}`)
        return {
          id: s.id,
          claim: s.claim,
          contradictedBy: s.contradictedBy,
          ...(external.length === 0 ? { note: 'needs evidence from a document or another character, or it will be dropped' } : {}),
        }
      }),
      triggers: context.triggers.filter((t) => t.characterId === c.id).map((t) => ({ on: t.on, requires: t.requires, effect: t.effect })),
    })),
    discoveries: context.discoveries.map((d) => ({ id: d.id, stageId: d.stageId, holder: d.holder, text: d.text })),
    stages: shared.skeleton.stages.map((s, i) => ({ id: s.id, order: i })),
  }
  return runCall(
    {
      label: 'link',
      schemaName: 'link_v3',
      schema: LinkWire,
      system: LINK_SYSTEM_PROMPT,
      user: JSON.stringify(compact),
      check: (output) => ({ errors: linkIssues(output, context), warnings: [] }),
    },
    opts,
    { model: LINK_MODEL, reasoningEffort: 'low' },
    from,
  )
}
