/**
 * The final check-and-repair (#209): assemble the spec from saved parts, check it, redo each blamed part once from its
 * saved output (in parallel), reassemble and check again. A part whose own check still reports issues is redone too. It never throws on check errors: what is left is returned
 * for the teacher, and publish refuses a spec with errors.
 */
import { checkSpec, validateSpec } from '@adventure/spec-v3'
import type { AdventureSpec, CheckIssue, SkeletonShape } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'
import { generateMinors, generatePersona, generateStageDetails, linkDetails } from '../details/calls'
import type { CallResult, DetailCallMetrics, DetailCallOptions, DetailsShared } from '../details/calls'
import { assembleDetails, linkContextFromParts } from '../details/generate'
import { generateEnding, generateMoment } from '../endings/calls'
import type { EndingsShared } from '../endings/calls'
import { assembleEndings } from '../endings/generate'
import { revealCall } from '../reveal/generate'
import { mergeReveal } from '../reveal/merge'
import type { RevealLlmOutput } from '../reveal/schema'
import { partId } from '../parts'
import type { PartResume, Parts } from '../parts'
import { blame } from './blame'

export interface FinalRepairInput {
  skeleton: SkeletonShape
  documents: ExtractedDocument[]
  readingLevel?: 'sec' | 'jc'
  timerMinutes?: number | null
  parts: Parts
  frozen?: string[]
}

export interface FinalRepairResult {
  spec: AdventureSpec
  parts: Parts
  /** errors left after the repair round */
  errors: CheckIssue[]
  /** the left errors no part can be blamed for */
  unresolved: CheckIssue[]
  /** what each part's own check still reports, e.g. an obligation to the skeleton it missed; the spec check can't see these */
  partErrors: { part: string; issue: CheckIssue }[]
  /** parts redone, in the order they were blamed */
  repaired: string[]
  metrics: { calls: DetailCallMetrics[]; totalCostUsd: number }
}

interface Assembled {
  details: AdventureSpec
  /** details + endings, the reveal's input */
  endings: AdventureSpec
  spec: AdventureSpec
  slantedDocuments: { stageId: string; documentId: string; note: string }[]
}

/** The spec from saved parts, in code. Endings and reveal are applied once all their parts are saved. */
export function assembleSpec(input: Pick<FinalRepairInput, 'skeleton' | 'parts' | 'timerMinutes'>): Assembled {
  const { skeleton, parts } = input
  const details = assembleDetails(skeleton, parts, input.timerMinutes)
  const endingsSaved = [...skeleton.definingMoments.map((m) => partId.moment(m.id)), ...skeleton.endings.map((e) => partId.ending(e.id))].every((id) => parts[id] !== undefined)
  const endings = endingsSaved ? assembleEndings(details.draft, parts) : details.draft
  const reveal = parts[partId.reveal]
  const spec = endingsSaved && reveal !== undefined ? mergeReveal(endings, reveal.output as RevealLlmOutput) : endings
  return { details: details.draft, endings, spec, slantedDocuments: details.slantedDocuments }
}

export function specErrors(spec: AdventureSpec): CheckIssue[] {
  const validation = validateSpec(spec)
  return validation.ok ? checkSpec(validation.spec).errors : validation.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
}

function rerunPart(id: string, from: PartResume, input: FinalRepairInput, assembled: Assembled, opts: DetailCallOptions): Promise<CallResult<unknown>> | null {
  const readingLevel = input.readingLevel ?? input.skeleton.readingLevel
  const details: DetailsShared = { skeleton: input.skeleton, documents: input.documents, readingLevel }
  const endings: EndingsShared = { draft: assembled.details, documents: input.documents, readingLevel }
  const [kind, ...rest] = id.split(':')
  const target = rest.join(':')
  switch (kind) {
    case 'stage':
      return generateStageDetails(target, details, opts, from)
    case 'persona':
      return generatePersona(target, details, opts, from)
    case 'minors':
      return generateMinors(details, opts, from)
    case 'link':
      return linkDetails(linkContextFromParts(input.skeleton, input.parts), details, opts, from)
    case 'moment':
      return generateMoment(target, endings, opts, from)
    case 'ending':
      return generateEnding(target, endings, opts, from)
    case 'reveal':
      return revealCall({ draft: assembled.endings, sources: input.documents, slantedDocuments: assembled.slantedDocuments, readingLevel }, opts, from)
    default:
      return null
  }
}

const partErrorsOf = (parts: Parts) => Object.entries(parts).flatMap(([part, record]) => record.issues.map((issue) => ({ part, issue })))
const issueKey = (i: CheckIssue) => `${i.code}|${i.path}|${i.message}`

export async function finalRepair(input: FinalRepairInput, opts: DetailCallOptions): Promise<FinalRepairResult> {
  const calls: DetailCallMetrics[] = []
  const metrics = () => ({ calls, totalCostUsd: calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0) })
  const blameAll = (spec: AdventureSpec, parts: Parts, errors: CheckIssue[]) => {
    const blamed = new Map<string, CheckIssue[]>()
    const unresolved: CheckIssue[] = []
    for (const issue of errors) {
      const owners = blame(issue, { skeleton: input.skeleton, spec, parts })
      if (owners.length === 0) unresolved.push(issue)
      for (const owner of owners) blamed.set(owner, [...(blamed.get(owner) ?? []), issue])
    }
    return { blamed, unresolved }
  }

  const assembled = assembleSpec(input)
  const errors = specErrors(assembled.spec)
  const { blamed, unresolved } = blameAll(assembled.spec, input.parts, errors)
  for (const { part, issue } of partErrorsOf(input.parts)) {
    const list = blamed.get(part) ?? []
    if (!list.some((i) => issueKey(i) === issueKey(issue))) blamed.set(part, [...list, issue])
  }
  if (blamed.size === 0) return { spec: assembled.spec, parts: input.parts, errors, unresolved, partErrors: [], repaired: [], metrics: metrics() }

  const parts: Parts = { ...input.parts }
  const repaired = [...blamed.keys()].filter(id => !input.frozen?.includes(id))
  await Promise.all(
    repaired.map(async (id) => {
      const saved = input.parts[id]!
      const result = await rerunPart(id, { output: saved.output, issues: blamed.get(id)! }, input, assembled, opts)
      if (result === null) return
      calls.push(...result.calls)
      if (result.output !== undefined) parts[id] = { output: result.output, issues: result.issues }
    }),
  )

  const reassembled = assembleSpec({ ...input, parts })
  const left = specErrors(reassembled.spec)
  return { spec: reassembled.spec, parts, errors: left, unresolved: blameAll(reassembled.spec, parts, left).unresolved, partErrors: partErrorsOf(parts), repaired, metrics: metrics() }
}
