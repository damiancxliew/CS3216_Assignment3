/**
 * The skeleton spec: the structural first pass of generation — stages, cast, core discoveries,
 * document stubs, defining moments and endings — without the detail (personas, stances, triggers,
 * story events, …) a later pass adds. `checkSpec` is `checkSkeleton` plus detail-only rules, so a
 * full `AdventureSpec` is already a valid `SkeletonShape`.
 */
import { z } from 'zod'

import { DOCUMENT_KINDS, Role } from './shared.js'
import type { Condition, SpecIssue } from './index.js'

const Id = z.string().min(1)
const Text = z.string()

const DocumentKind = z.enum(DOCUMENT_KINDS)
export type DocumentKind = z.infer<typeof DocumentKind>

const Citation = z.strictObject({ sourceId: Id, quote: Text.optional() })

const Source = z.strictObject({
  id: Id,
  title: Text,
  origin: z.enum(['teacher', 'outside']),
  url: z.url().optional(),
})

/** Hand-written structural type both `AdventureSpec` and `z.infer<typeof SkeletonSpec>` satisfy. */
export interface SkeletonShape {
  id: string
  title: string
  readingLevel: 'sec' | 'jc'
  arc?: string | undefined
  role: z.infer<typeof Role>
  sources: z.infer<typeof Source>[]
  characters: {
    id: string
    name: string
    title: string
    real: boolean
    tier: 'major' | 'minor'
    persona: { publicPosition: string; privateAgenda: string }
  }[]
  stages: {
    id: string
    title: string
    timePlace: string
    centralQuestion: string
    rooms: { id: string; name: string; description: string }[]
    startRoomId: string
    placement: Record<string, string>
    definingMomentId: string
  }[]
  discoveries: {
    id: string
    stageId: string
    holder: { characterId: string } | { documentId: string; keyPassageId?: string | undefined }
    text: string
    note: string
    core: boolean
    sourceLabel: string
    citations?: z.infer<typeof Citation>[] | undefined
  }[]
  documents: { id: string; kind: DocumentKind; title: string; real: boolean }[]
  definingMoments: {
    id: string
    stageId: string
    deciderId: string
    scene: string
    acts: { id: string; text: string }[]
    outcomes: {
      id: string
      summary: string
      closesEndingIds: string[]
      endingId?: string | undefined
      secret?: boolean | undefined
      historical?: boolean | undefined
    }[]
    rules: { actId: string; outcomeId: string; when?: Condition | undefined }[]
    // (SkeletonShape.rule `when` accepts the full Condition type even though SkeletonSpec omits it.)
  }[]
  endings: {
    id: string
    type: 'historical' | 'alternative' | 'secret'
    title: string
    summary: string
    sourceLabel: string
    citations?: z.infer<typeof Citation>[] | undefined
  }[]
}

export const SkeletonSpec = z.strictObject({
  id: Id,
  title: Text,
  readingLevel: z.enum(['sec', 'jc']),
  arc: Text,
  role: Role,
  sources: z.array(Source).default([]),
  characters: z.array(
    z.strictObject({
      id: Id,
      name: Text,
      title: Text,
      real: z.boolean(),
      tier: z.enum(['major', 'minor']),
      persona: z.strictObject({ publicPosition: Text, privateAgenda: Text }),
    }),
  ),
  stages: z.array(
    z.strictObject({
      id: Id,
      title: Text,
      timePlace: Text,
      centralQuestion: Text,
      rooms: z.array(z.strictObject({ id: Id, name: Text, description: Text })),
      startRoomId: Id,
      placement: z.record(Id, Id),
      definingMomentId: Id,
    }),
  ),
  discoveries: z.array(
    z.strictObject({
      id: Id,
      stageId: Id,
      holder: z.union([z.strictObject({ characterId: Id }), z.strictObject({ documentId: Id })]),
      text: Text,
      note: Text,
      /** Every discovery in a skeleton is core; the detail pass may add non-core ones. */
      core: z.literal(true),
      sourceLabel: Text,
      citations: z.array(Citation).optional(),
    }),
  ),
  documents: z.array(z.strictObject({ id: Id, kind: DocumentKind, title: Text, real: z.boolean() })),
  definingMoments: z.array(
    z.strictObject({
      id: Id,
      stageId: Id,
      deciderId: Id,
      scene: Text,
      acts: z.array(z.strictObject({ id: Id, text: Text })),
      outcomes: z.array(
        z.strictObject({
          id: Id,
          summary: Text,
          closesEndingIds: z.array(Id).default([]),
          endingId: Id.optional(),
          secret: z.boolean().optional(),
          historical: z.boolean().optional(),
        }),
      ),
      rules: z.array(z.strictObject({ actId: Id, outcomeId: Id })),
    }),
  ),
  endings: z.array(
    z.strictObject({
      id: Id,
      type: z.enum(['historical', 'alternative', 'secret']),
      title: Text,
      summary: Text,
      sourceLabel: Text,
      citations: z.array(Citation).optional(),
    }),
  ),
})
export type SkeletonSpec = z.infer<typeof SkeletonSpec>

export type ValidateSkeletonResult = { ok: true; spec: SkeletonSpec } | { ok: false; issues: SpecIssue[] }

/** Structural validation of a skeleton — never throws. */
export function validateSkeleton(input: unknown): ValidateSkeletonResult {
  const result = SkeletonSpec.safeParse(input)
  if (result.success) return { ok: true, spec: result.data }
  return { ok: false, issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }
}

// compile-time proof that the zod schema satisfies the hand-written shape
const _zodToShape: SkeletonShape = null as unknown as SkeletonSpec
void _zodToShape
