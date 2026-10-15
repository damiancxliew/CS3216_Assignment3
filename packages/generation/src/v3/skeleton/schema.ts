/**
 * The LLM's skeleton output: same fields as `SkeletonSpec` but strict-structured-output
 * friendly — every field required, optionals expressed as `null`, placement as a pair list,
 * holder tagged by kind, and no `sources`/`core` (the code supplies both).
 */
import { z } from 'zod'
import type { SkeletonSpec } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'

const Text = z.string()
const Id = z.string()

const NullableCitation = z.object({ sourceId: Id, quote: Text.nullable() })

export const SkeletonLlmOutput = z.object({
  id: Id,
  title: Text,
  arc: Text,
  role: z.object({
    name: Text,
    position: Text,
    relationships: z.array(Text),
    reputation: Text,
    stakes: Text,
    privateBrief: z.object({ goals: z.array(Text), fears: z.array(Text), constraints: z.array(Text), knows: z.array(Text) }),
    situation: Text,
  }),
  characters: z.array(
    z.object({
      id: Id,
      name: Text,
      title: Text,
      real: z.boolean(),
      tier: z.enum(['major', 'minor']),
      persona: z.object({ publicPosition: Text, privateAgenda: Text }),
    }),
  ),
  stages: z.array(
    z.object({
      id: Id,
      title: Text,
      timePlace: Text,
      centralQuestion: Text,
      rooms: z.array(z.object({ id: Id, name: Text, description: Text })),
      startRoomId: Id,
      placement: z.array(z.object({ characterId: Id, roomId: Id })),
      definingMomentId: Id,
    }),
  ),
  discoveries: z.array(
    z.object({
      id: Id,
      stageId: Id,
      holder: z.object({ kind: z.enum(['character', 'document']), id: Id }),
      text: Text,
      note: Text,
      sourceLabel: Text,
      citations: z.array(NullableCitation).nullable(),
    }),
  ),
  documents: z.array(
    z.object({
      id: Id,
      kind: z.enum(['newspaper', 'letter', 'telegram', 'speech', 'minutes', 'memoir', 'treaty', 'report', 'other']),
      title: Text,
      real: z.boolean(),
    }),
  ),
  definingMoments: z.array(
    z.object({
      id: Id,
      stageId: Id,
      deciderId: Id,
      scene: Text,
      acts: z.array(z.object({ id: Id, text: Text })),
      outcomes: z.array(
        z.object({
          id: Id,
          summary: Text,
          closesEndingIds: z.array(Id),
          endingId: Id.nullable(),
          secret: z.boolean(),
          historical: z.boolean(),
        }),
      ),
      rules: z.array(z.object({ actId: Id, outcomeId: Id })),
    }),
  ),
  endings: z.array(
    z.object({
      id: Id,
      type: z.enum(['historical', 'alternative', 'secret']),
      title: Text,
      summary: Text,
      sourceLabel: Text,
      citations: z.array(NullableCitation).nullable(),
    }),
  ),
})
export type SkeletonLlmOutput = z.infer<typeof SkeletonLlmOutput>

export function skeletonOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SkeletonLlmOutput, { target: 'draft-2020-12', io: 'output' }) as Record<string, unknown>
}

const dropNull = <T>(value: T | null): T | undefined => (value === null ? undefined : value)

/** Convert the LLM's output to the SkeletonSpec shape; code supplies `sources` and `core`. */
export function toSkeleton(output: SkeletonLlmOutput, input: { readingLevel: 'sec' | 'jc'; documents: ExtractedDocument[] }): SkeletonSpec {
  const citations = (items: { sourceId: string; quote: string | null }[] | null) => {
    const list = items?.map((c) => (c.quote === null ? { sourceId: c.sourceId } : { sourceId: c.sourceId, quote: c.quote }))
    return list && list.length > 0 ? list : undefined
  }
  return {
    id: output.id,
    title: output.title,
    readingLevel: input.readingLevel,
    arc: output.arc,
    role: output.role,
    sources: input.documents.map((doc) => ({ id: doc.id, title: doc.title, origin: 'teacher' as const })),
    characters: output.characters,
    stages: output.stages.map((stage) => ({
      ...stage,
      placement: Object.fromEntries(stage.placement.map((p) => [p.characterId, p.roomId])),
    })),
    discoveries: output.discoveries.map((discovery) => ({
      id: discovery.id,
      stageId: discovery.stageId,
      holder: discovery.holder.kind === 'character' ? { characterId: discovery.holder.id } : { documentId: discovery.holder.id },
      text: discovery.text,
      note: discovery.note,
      core: true as const,
      sourceLabel: discovery.sourceLabel,
      citations: citations(discovery.citations),
    })),
    documents: output.documents,
    definingMoments: output.definingMoments.map((moment) => ({
      ...moment,
      outcomes: moment.outcomes.map((outcome) => {
        const out: {
          id: string
          summary: string
          closesEndingIds: string[]
          endingId?: string
          secret?: boolean
          historical?: boolean
        } = {
          id: outcome.id,
          summary: outcome.summary,
          closesEndingIds: outcome.closesEndingIds,
        }
        const endingId = dropNull(outcome.endingId)
        if (endingId !== undefined) out.endingId = endingId
        if (outcome.secret) out.secret = true
        if (outcome.historical) out.historical = true
        return out
      }),
    })),
    endings: output.endings.map((ending) => ({ ...ending, citations: citations(ending.citations) })),
  }
}
