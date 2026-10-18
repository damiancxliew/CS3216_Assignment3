/**
 * Which part to redo for a check error (#209). Plain code, no model: a path only says where an error shows up, so a
 * missing id the skeleton planned is blamed on the part that had to produce it, and anything else on the part that
 * wrote the element at the path. Errors no part can fix come back with no parts, for the teacher to see.
 */
import type { AdventureSpec, CheckIssue, SkeletonShape } from '@adventure/spec-v3'

import { partId } from '../parts'
import type { Parts } from '../parts'

export interface BlameContext {
  skeleton: SkeletonShape
  spec: AdventureSpec
  parts: Parts
}

/** Skeleton-level errors: no generated part can fix them. */
const SKELETON_LEVEL = new Set(['historical-missing', 'paths-overflow'])

export function characterPart(skeleton: SkeletonShape, characterId: string): string | null {
  const character = skeleton.characters.find((c) => c.id === characterId)
  if (character === undefined) return null
  return character.tier === 'major' ? partId.persona(character.id) : partId.minors
}

/** The part the skeleton makes responsible for a planned id, or null when the id isn't planned. */
export function plannedProducer(id: string, ctx: BlameContext): string | null {
  const { skeleton, parts } = ctx
  const discovery = skeleton.discoveries.find((d) => d.id === id)
  if (discovery !== undefined)
    return 'characterId' in discovery.holder ? characterPart(skeleton, discovery.holder.characterId) : partId.stage(discovery.stageId)
  if (skeleton.documents.some((d) => d.id === id)) {
    for (const stage of skeleton.stages) {
      const output = parts[partId.stage(stage.id)]?.output as { documents?: { id: string }[] } | undefined
      if (output?.documents?.some((d) => d.id === id)) return partId.stage(stage.id)
    }
    const holding = skeleton.discoveries.find((d) => 'documentId' in d.holder && d.holder.documentId === id)
    return holding !== undefined ? partId.stage(holding.stageId) : null
  }
  if (skeleton.definingMoments.some((m) => m.id === id)) return partId.moment(id)
  if (skeleton.endings.some((e) => e.id === id)) return partId.ending(id)
  return null
}

/** Generated ids carry their part's prefix: `<stageId>-`, `<characterId>-` or `link-`. */
export function prefixProducer(id: string, ctx: BlameContext): string | null {
  if (id.startsWith('link-')) return partId.link
  const owners = [
    ...ctx.skeleton.stages.map((s) => ({ prefix: `${s.id}-`, part: partId.stage(s.id) })),
    ...ctx.skeleton.characters.map((c) => ({ prefix: `${c.id}-`, part: characterPart(ctx.skeleton, c.id)! })),
  ]
    .filter((o) => id.startsWith(o.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  return owners[0]?.part ?? null
}

const producerOf = (id: string, ctx: BlameContext) => plannedProducer(id, ctx) ?? prefixProducer(id, ctx)

/** The part that wrote the element at `path`. */
export function pathOwner(path: string, ctx: BlameContext): string | null {
  const { spec, skeleton } = ctx
  const [head, index] = path.split('.')
  const i = Number(index)
  switch (head) {
    case 'stages': {
      const stage = spec.stages[i]
      return stage !== undefined ? partId.stage(stage.id) : null
    }
    case 'documents':
    case 'discoveries':
    case 'hintAngles': {
      const item = (spec[head] as { id: string }[])[i]
      return item !== undefined ? producerOf(item.id, ctx) : null
    }
    case 'characters': {
      const character = spec.characters[i]
      return character !== undefined ? characterPart(skeleton, character.id) : null
    }
    case 'triggers': {
      const trigger = spec.triggers[i]
      if (trigger === undefined) return null
      return trigger.id.startsWith('link-') ? partId.link : characterPart(skeleton, trigger.characterId)
    }
    case 'storyEvents':
    case 'openQuestions': {
      const item = (spec[head] as { stageId: string }[])[i]
      return item !== undefined ? partId.stage(item.stageId) : null
    }
    case 'definingMoments': {
      const moment = spec.definingMoments[i]
      return moment !== undefined ? partId.moment(moment.id) : null
    }
    case 'endings': {
      const ending = spec.endings[i]
      return ending !== undefined ? partId.ending(ending.id) : null
    }
    case 'reveal':
    case 'teacherQuestions':
      return partId.reveal
    default:
      return null
  }
}

function specIds(spec: AdventureSpec): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value !== null && typeof value === 'object') {
      const id = (value as { id?: unknown }).id
      if (typeof id === 'string') ids.add(id)
      Object.values(value).forEach(walk)
    }
  }
  walk(spec)
  return ids
}

/** The saved parts to redo for `issue`; empty when no part can fix it. */
export function blame(issue: CheckIssue, ctx: BlameContext): string[] {
  const keep = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => id !== null && ctx.parts[id] !== undefined))]
  if (SKELETON_LEVEL.has(issue.code)) return []
  if (issue.code === 'ref' && issue.ids !== undefined && issue.ids.length > 0) {
    const named = issue.ids[0]!
    // a planned id that no part produced is the producer's fault; a dangling or mismatched one is the referrer's
    const producer = specIds(ctx.spec).has(named) ? null : plannedProducer(named, ctx)
    return keep([producer ?? pathOwner(issue.path, ctx)])
  }
  if (issue.code === 'core-unreachable') {
    // reachability needs both the discovery's own condition and its stage's documents and placement
    const discovery = ctx.spec.discoveries[Number(issue.path.split('.')[1])]
    if (discovery === undefined) return []
    const planned = ctx.skeleton.discoveries.find((d) => d.id === discovery.id)
    return keep([producerOf(discovery.id, ctx), planned !== undefined ? partId.stage(planned.stageId) : null])
  }
  if (issue.code === 'historical-unreachable') return keep(ctx.skeleton.definingMoments.map((m) => partId.moment(m.id)))
  return keep([pathOwner(issue.path, ctx)])
}
