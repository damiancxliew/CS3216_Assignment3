/**
 * The endings-pass calls — one per defining moment and one per ending — each with the
 * shared repair loop from the details pass (same system prompt, user turn = original
 * message + previous raw JSON + the issues as a repair message).
 */
import type { AdventureSpec } from '@adventure/spec-v3'
import { unconditionalOutcomeIds } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'
import { runCall } from '../details/calls'
import { V3_MODEL } from '../config'
import type { PartResume } from '../parts'
import type { CallResult, DetailCallOptions } from '../details/calls'
import { detailsJsonSchema } from '../details/schema'
import { sourcesBlock } from '../skeleton/index'
import { buildMomentContext, endingIssues, momentIssues, secretActIds } from './checks'
import type { MomentContext } from './checks'
import { ENDING_SYSTEM_PROMPT, MOMENT_SYSTEM_PROMPT, fillEndingsPrompt } from './prompt'
import { EndingLlmOutput as EndingWire, MomentLlmOutput as MomentWire } from './schema'
import type { EndingLlmOutput, MomentLlmOutput } from './schema'

export const ENDINGS_MODEL = V3_MODEL

export interface EndingsShared {
  draft: AdventureSpec
  documents: ExtractedDocument[]
  readingLevel: 'sec' | 'jc'
}

function momentUserMessage(shared: EndingsShared, ctx: MomentContext): string {
  const { draft, momentId, stageIndex } = ctx
  const moment = draft.definingMoments.find((m) => m.id === momentId)!
  const secret = secretActIds(moment)
  const stage = draft.stages[stageIndex]!

  const compact = {
    moment: {
      id: moment.id,
      stage: { id: stage.id, title: stage.title, timePlace: stage.timePlace, centralQuestion: stage.centralQuestion },
      deciderId: moment.deciderId,
      scene: moment.scene,
      acts: moment.acts.map((a) => ({
        id: a.id,
        text: a.text,
        fallbackOutcomeId: unconditionalOutcomeIds(moment, a.id)[0] ?? null,
        alternateOutcomeIds: unconditionalOutcomeIds(moment, a.id).slice(1),
        ...(secret.has(a.id) ? { secret: true } : {}),
      })),
      outcomes: moment.outcomes.map((o) => ({
        id: o.id,
        summary: o.summary,
        endingId: o.endingId ?? null,
        closesEndingIds: o.closesEndingIds,
        historical: o.historical === true,
        secret: o.secret === true,
      })),
    },
    characters: draft.characters
      .filter((c) => (ctx.placedCharacters.get(c.id) ?? []).some((i) => i <= stageIndex))
      .map((c) => ({
        id: c.id,
        name: c.name,
        tier: c.tier,
        presentInCurrentStage: Object.hasOwn(stage.placement, c.id),
        persona: { voice: c.persona.voice, publicPosition: c.persona.publicPosition, privateAgenda: c.persona.privateAgenda, wantsFromStudent: c.persona.wantsFromStudent },
        stances: c.stances.map((s) => ({ id: s.id, label: s.label, hidden: s.hidden === true })),
        slants: c.slants.map((s) => ({ id: s.id, claim: s.claim, contradictedBy: s.contradictedBy })),
      })),
    discoveries: draft.discoveries
      .filter((d) => draft.stages.findIndex((s) => s.id === d.stageId) <= stageIndex)
      .map((d) => ({
        id: d.id,
        stageId: d.stageId,
        core: d.core,
        holder: 'characterId' in d.holder ? `character:${d.holder.characterId}` : `document:${d.holder.documentId}`,
        text: d.text,
        guarded: d.condition !== undefined,
      })),
    earlierMoments: draft.definingMoments
      .filter((m) => draft.stages.findIndex((s) => s.id === m.stageId) < stageIndex)
      .map((m) => ({ id: m.id, scene: m.scene, outcomes: m.outcomes.map((o) => ({ id: o.id, summary: o.summary })) })),
    endings: draft.endings.map((e) => ({ id: e.id, type: e.type, title: e.title, summary: e.summary })),
  }
  return `Write moment: ${momentId}\n\n${JSON.stringify(compact, null, 2)}\n\n${sourcesBlock(shared.documents)}`
}

export function generateMoment(momentId: string, shared: EndingsShared, opts: DetailCallOptions, from?: PartResume): Promise<CallResult<MomentLlmOutput>> {
  const ctx = buildMomentContext(shared.draft, momentId, new Set(shared.documents.map((d) => d.id)))
  return runCall(
    {
      label: `moment ${momentId}`,
      schemaName: 'moment_v3',
      schema: MomentWire,
      system: fillEndingsPrompt(MOMENT_SYSTEM_PROMPT, { readingLevel: shared.readingLevel, momentId }),
      user: momentUserMessage(shared, ctx),
      check: (output) => momentIssues(output, ctx),
    },
    opts,
    { model: ENDINGS_MODEL, reasoningEffort: 'medium' },
    from,
  )
}

export function generateEnding(endingId: string, shared: EndingsShared, opts: DetailCallOptions, from?: PartResume): Promise<CallResult<EndingLlmOutput>> {
  const { draft } = shared
  const ending = draft.endings.find((e) => e.id === endingId)!
  const leading = draft.definingMoments
    .map((moment) => ({
      id: moment.id,
      scene: moment.scene,
      acts: moment.acts.map((a) => ({ id: a.id, text: a.text })),
      outcomes: moment.outcomes.filter((o) => o.endingId === endingId).map((o) => ({ id: o.id, summary: o.summary })),
    }))
    .filter((m) => m.outcomes.length > 0)
  const compact = {
    role: { name: draft.role.name, position: draft.role.position },
    ending: {
      id: ending.id,
      type: ending.type,
      title: ending.title,
      summary: ending.summary,
      citations: ending.citations ?? [],
    },
    leadingFrom: leading,
    discoveries: draft.discoveries.map((d) => ({
      id: d.id,
      stageId: d.stageId,
      core: d.core,
      holder: 'characterId' in d.holder ? `character:${d.holder.characterId}` : `document:${d.holder.documentId}`,
      text: d.text,
      note: d.note,
    })),
    characterNames: draft.characters.map((c) => c.name),
  }
  return runCall(
    {
      label: `ending ${endingId}`,
      schemaName: 'ending_v3',
      schema: EndingWire,
      system: fillEndingsPrompt(ENDING_SYSTEM_PROMPT, { readingLevel: shared.readingLevel, endingId }),
      user: `Write ending: ${endingId}\n\n${JSON.stringify(compact, null, 2)}\n\n${sourcesBlock(shared.documents)}`,
      check: (output) => endingIssues(output, draft, endingId, new Set(shared.documents.map((d) => d.id))),
    },
    opts,
    { model: ENDINGS_MODEL, reasoningEffort: 'medium' },
    from,
  )
}
