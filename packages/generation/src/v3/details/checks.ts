/**
 * Per-call checks for the details pass. Each list becomes the repair issues for that call only.
 * Reused codes: `ref`, `duplicate-id`, `stance-count`, `initial-stance`, `hidden-stance`,
 * `source-label`. Warnings (`document-mix`) are returned separately.
 */
import type { CheckIssue, SkeletonShape } from '@adventure/spec-v3'

import { citationQuotes, quoteInSource, quoteIssues } from '../grounding'
import type { LinkLlmOutput, MinorsLlmOutput, PersonaLlmOutput, StageDetailsLlmOutput } from './schema'

type Ctx = {
  skeleton: SkeletonShape
  sources: Map<string, string>
}

const issue = (code: string, path: string, message: string): CheckIssue => ({ code, path, message })

/** Same set as `skeletonIds` in spec-v3 (not exported): stages, characters, discoveries,
 * documents, moments, acts, outcomes, endings, sources. */
export function skeletonIdSet(skeleton: SkeletonShape): Set<string> {
  const ids = new Set<string>()
  for (const stage of skeleton.stages) ids.add(stage.id)
  for (const character of skeleton.characters) ids.add(character.id)
  for (const discovery of skeleton.discoveries) ids.add(discovery.id)
  for (const document of skeleton.documents) ids.add(document.id)
  for (const moment of skeleton.definingMoments) {
    ids.add(moment.id)
    for (const act of moment.acts) ids.add(act.id)
    for (const outcome of moment.outcomes) ids.add(outcome.id)
  }
  for (const ending of skeleton.endings) ids.add(ending.id)
  for (const source of skeleton.sources) ids.add(source.id)
  return ids
}

/** id-prefix + duplicate-id (within the call and against skeleton ids). `allowedIds` are
 * intentional skeleton-id reuses (e.g. document stubs) and skip the prefix rule. */
export function idIssues(
  items: { id: string; path: string }[],
  prefix: string,
  skelIds: Set<string>,
  allowedIds: Set<string> = new Set(),
): CheckIssue[] {
  const issues: CheckIssue[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!allowedIds.has(item.id) && !item.id.startsWith(`${prefix}-`))
      issues.push(issue('id-prefix', item.path, `id '${item.id}' must start with '${prefix}-'`))
    if (seen.has(item.id)) issues.push(issue('duplicate-id', item.path, `id '${item.id}' is used twice`))
    else if (skelIds.has(item.id) && !allowedIds.has(item.id))
      issues.push(issue('duplicate-id', item.path, `id '${item.id}' redefines a skeleton id`))
    seen.add(item.id)
  }
  return issues
}

function labelIssue(label: string, path: string, what: string): CheckIssue[] {
  return label.trim().length === 0 ? [issue('source-label', path, `${what} has an empty sourceLabel`)] : []
}

function phraseIssues(phrases: { text: string; sourceLabel: string; citations: { sourceId: string; quote: string | null }[] | null }[], at: string, sources: Map<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = []
  phrases.forEach((phrase, j) => {
    issues.push(...labelIssue(phrase.sourceLabel, `${at}.phrases.${j}.sourceLabel`, 'phrase'))
    issues.push(...quoteIssues(citationQuotes([{ path: `${at}.phrases.${j}`, citations: citationsOrUndefined(phrase.citations) }]), sources))
    // the phrase's own text must occur in at least one cited source
    const texts = (phrase.citations ?? []).filter((c) => sources.has(c.sourceId))
    if (texts.length > 0 && !texts.some((c) => quoteIssues([{ path: `${at}.phrases.${j}.text`, sourceId: c.sourceId, quote: phrase.text }], sources).length === 0))
      issues.push(issue('quote-not-in-source', `${at}.phrases.${j}.text`, 'phrase text does not occur in any cited source'))
  })
  return issues
}

const citationsOrUndefined = (items: { sourceId: string; quote: string | null }[] | null) =>
  items === null ? undefined : items.map((c) => (c.quote === null ? { sourceId: c.sourceId } : { sourceId: c.sourceId, quote: c.quote }))

const stageOrder = (skeleton: SkeletonShape) => new Map(skeleton.stages.map((s, i) => [s.id, i]))

// --- stage ---------------------------------------------------------------------

export function stageIssues(stageId: string, output: StageDetailsLlmOutput, ctx: Ctx): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const { skeleton, sources } = ctx
  const issues: CheckIssue[] = []
  const warnings: CheckIssue[] = []
  const stage = skeleton.stages.find((s) => s.id === stageId)
  if (stage === undefined) return { errors: [issue('ref', '', `stage '${stageId}' does not exist`)], warnings }
  const stageRooms = new Set(stage.rooms.map((r) => r.id))
  const stageChars = new Set(Object.keys(stage.placement))
  const skelIds = skeletonIdSet(skeleton)
  const stubDocs = new Map(skeleton.documents.map((d) => [d.id, d]))
  /** skeleton doc-held core discoveries of this stage: discoveryId → stub document id */
  const stageCores = skeleton.discoveries.filter((d) => d.stageId === stageId)
  const docHeldCores = stageCores.filter((d) => 'documentId' in d.holder)
  const stubDocIds = new Set(docHeldCores.map((d) => ('documentId' in d.holder ? d.holder.documentId : '')))

  // skeleton-changed + document presence
  const outDocs = new Map(output.documents.map((d) => [d.id, d]))
  for (const [i, doc] of output.documents.entries()) {
    const stub = stubDocs.get(doc.id)
    if (stub !== undefined) {
      if (doc.kind !== stub.kind || doc.title !== stub.title || doc.real !== stub.real)
        issues.push(issue('skeleton-changed', `documents.${i}`, `document '${doc.id}' must keep the skeleton stub's kind, title and real flag`))
    } else if (skelIds.has(doc.id)) {
      issues.push(issue('skeleton-changed', `documents.${i}.id`, `id '${doc.id}' redefines a skeleton id`))
    }
  }
  for (const discovery of docHeldCores) {
    const docId = (discovery.holder as { documentId: string }).documentId
    if (!outDocs.has(docId)) issues.push(issue('skeleton-changed', 'documents', `stub document '${docId}' held by core discovery '${discovery.id}' was not written`))
  }

  // ids: new documents, passages, discoveries, events, questions are `${stageId}-` prefixed
  const idItems: { id: string; path: string }[] = []
  output.documents.forEach((d, i) => {
    if (!stubDocIds.has(d.id)) idItems.push({ id: d.id, path: `documents.${i}.id` })
    d.keyPassages.forEach((p, j) => idItems.push({ id: p.id, path: `documents.${i}.keyPassages.${j}.id` }))
  })
  output.discoveries.forEach((d, i) => idItems.push({ id: d.id, path: `discoveries.${i}.id` }))
  output.storyEvents.forEach((e, i) => idItems.push({ id: e.id, path: `storyEvents.${i}.id` }))
  output.openQuestions.forEach((q, i) => idItems.push({ id: q.id, path: `openQuestions.${i}.id` }))
  issues.push(...idIssues(idItems, stageId, skelIds, stubDocIds))

  // key passages
  output.documents.forEach((doc, i) => {
    if (doc.keyPassages.length < 1 || doc.keyPassages.length > 2)
      issues.push(issue('passage-count', `documents.${i}.keyPassages`, `document '${doc.id}' has ${doc.keyPassages.length} key passages (1–2 required)`))
    doc.keyPassages.forEach((passage, j) => {
      if (!doc.body.includes(passage.text))
        issues.push(issue('passage-not-in-body', `documents.${i}.keyPassages.${j}`, `key passage '${passage.id}' text does not occur in the body`))
    })
  })

  // coreLinks: exactly one per doc-held core, pointing at a passage of its stub document
  for (const discovery of docHeldCores) {
    const docId = (discovery.holder as { documentId: string }).documentId
    const links = output.coreLinks.filter((l) => l.discoveryId === discovery.id)
    if (links.length !== 1) issues.push(issue('core-link', 'coreLinks', `core discovery '${discovery.id}' has ${links.length} core links (exactly 1 required)`))
    for (const link of links) {
      if (!outDocs.get(docId)?.keyPassages.some((p) => p.id === link.keyPassageId))
        issues.push(issue('core-link', 'coreLinks', `key passage '${link.keyPassageId}' is not a passage of document '${docId}'`))
    }
  }

  // passage-unlinked: each passage linked exactly once by a core link or a new discovery
  const linkedBy = new Map<string, number>()
  for (const link of output.coreLinks) linkedBy.set(link.keyPassageId, (linkedBy.get(link.keyPassageId) ?? 0) + 1)
  output.discoveries.forEach((d, i) => {
    const doc = outDocs.get(d.documentId)
    if (doc === undefined) issues.push(issue('ref', `discoveries.${i}.documentId`, `document '${d.documentId}' is not a document of this stage`))
    else if (!doc.keyPassages.some((p) => p.id === d.keyPassageId))
      issues.push(issue('ref', `discoveries.${i}.keyPassageId`, `key passage '${d.keyPassageId}' is not a passage of document '${d.documentId}'`))
    else linkedBy.set(d.keyPassageId, (linkedBy.get(d.keyPassageId) ?? 0) + 1)
  })
  output.documents.forEach((doc, i) =>
    doc.keyPassages.forEach((passage, j) => {
      if ((linkedBy.get(passage.id) ?? 0) !== 1)
        issues.push(issue('passage-unlinked', `documents.${i}.keyPassages.${j}.id`, `key passage '${passage.id}' is linked ${linkedBy.get(passage.id) ?? 0} times (exactly 1 required)`))
    }),
  )

  // placement: every document of the stage exactly once, rooms of this stage or 'held'
  {
    const placed = new Map<string, number>()
    output.documentPlacement.forEach((p, i) => {
      if (!outDocs.has(p.documentId)) issues.push(issue('ref', `documentPlacement.${i}.documentId`, `document '${p.documentId}' is not a document of this stage`))
      if (p.roomId !== 'held' && !stageRooms.has(p.roomId)) issues.push(issue('placement', `documentPlacement.${i}.roomId`, `room '${p.roomId}' is not a room of stage '${stageId}'`))
      placed.set(p.documentId, (placed.get(p.documentId) ?? 0) + 1)
    })
    for (const doc of output.documents) {
      if ((placed.get(doc.id) ?? 0) !== 1)
        issues.push(issue('placement', 'documentPlacement', `document '${doc.id}' is placed ${placed.get(doc.id) ?? 0} times (exactly 1 required)`))
    }
  }

  // slanted + document mix
  if (!output.documents.some((d) => d.slanted && d.slantNote !== null && d.slantNote.trim().length > 0))
    issues.push(issue('slanted-document', 'documents', `stage '${stageId}' has no slanted document`))
  const kinds = new Set(output.documents.map((d) => d.kind))
  if (output.documents.length < 2 || kinds.size < 2)
    warnings.push(issue('document-mix', 'documents', `stage '${stageId}' has ${output.documents.length} documents of ${kinds.size} kinds (want ≥2 of ≥2 kinds)`))

  // situations: only for stages after the first, earlier-stage outcomes, this stage's rooms/chars
  const order = stageOrder(skeleton)
  const isFirst = order.get(stageId) === 0
  if (isFirst && output.situations.length > 0) issues.push(issue('ref', 'situations', 'the first stage must have no situations'))
  output.situations.forEach((situation, i) => {
    const moment = skeleton.definingMoments.find((m) => m.id === situation.momentId)
    if (moment === undefined || (order.get(moment.stageId) ?? 0) >= (order.get(stageId) ?? 0))
      issues.push(issue('ref', `situations.${i}.momentId`, `moment '${situation.momentId}' is not a moment of an earlier stage`))
    else if (!moment.outcomes.some((o) => o.id === situation.outcomeId))
      issues.push(issue('ref', `situations.${i}.outcomeId`, `outcome '${situation.outcomeId}' is not an outcome of moment '${situation.momentId}'`))
    for (const [j, p] of (situation.placement ?? []).entries()) {
      if (!stageChars.has(p.characterId)) issues.push(issue('ref', `situations.${i}.placement.${j}.characterId`, `character '${p.characterId}' is not placed in stage '${stageId}'`))
      if (!stageRooms.has(p.roomId)) issues.push(issue('ref', `situations.${i}.placement.${j}.roomId`, `room '${p.roomId}' is not a room of stage '${stageId}'`))
    }
    for (const [j, p] of (situation.documentPlacement ?? []).entries()) {
      if (!outDocs.has(p.documentId)) issues.push(issue('ref', `situations.${i}.documentPlacement.${j}.documentId`, `document '${p.documentId}' is not a document of this stage`))
      if (p.roomId !== 'held' && !stageRooms.has(p.roomId)) issues.push(issue('ref', `situations.${i}.documentPlacement.${j}.roomId`, `room '${p.roomId}' is not a room of stage '${stageId}'`))
    }
  })

  // story events
  const stageDiscoveryIds = new Set([...stageCores.map((d) => d.id), ...output.discoveries.map((d) => d.id)])
  output.storyEvents.forEach((event, i) => {
    const at = `storyEvents.${i}`
    if (event.when.kind === 'atSeconds' && event.when.seconds === null) issues.push(issue('ref', `${at}.when.seconds`, 'atSeconds needs seconds'))
    if (event.when.kind === 'discovered') {
      if (event.when.discoveryId === null) issues.push(issue('ref', `${at}.when.discoveryId`, 'discovered needs a discoveryId'))
      else if (!stageDiscoveryIds.has(event.when.discoveryId)) issues.push(issue('ref', `${at}.when.discoveryId`, `discovery '${event.when.discoveryId}' is not a discovery of this stage`))
    }
    if ((event.effect === 'summons' || event.effect === 'move') && event.characterId === null)
      issues.push(issue('ref', `${at}.characterId`, `${event.effect} needs a characterId`))
    else if (event.characterId !== null && !stageChars.has(event.characterId))
      issues.push(issue('ref', `${at}.characterId`, `character '${event.characterId}' is not placed in stage '${stageId}'`))
    if (event.effect === 'move' && (event.toRoomId === null || !stageRooms.has(event.toRoomId)))
      issues.push(issue('ref', `${at}.toRoomId`, `room '${event.toRoomId}' is not a room of stage '${stageId}'`))
    if (event.effect === 'deliverDocument' && (event.documentId === null || !outDocs.has(event.documentId)))
      issues.push(issue('ref', `${at}.documentId`, `document '${event.documentId}' is not a document of this stage`))
    if (event.effect === 'beginMoment' && event.when.kind !== 'timerOut' && event.when.kind !== 'allCore')
      issues.push(issue('begin-moment', `${at}.when`, 'beginMoment must fire on timerOut or allCore'))
  })

  // open questions
  if (output.openQuestions.length === 0) issues.push(issue('open-questions', 'openQuestions', `stage '${stageId}' has no open questions`))
  output.openQuestions.forEach((q, i) =>
    q.discoveryIds.forEach((id, j) => {
      if (!stageDiscoveryIds.has(id)) issues.push(issue('ref', `openQuestions.${i}.discoveryIds.${j}`, `discovery '${id}' is not a discovery of this stage`))
    }),
  )

  // labels + grounding
  output.documents.forEach((doc, i) => issues.push(...labelIssue(doc.sourceLabel, `documents.${i}.sourceLabel`, `document '${doc.id}'`)))
  // G13.2: a document marked real must reproduce its cited source word for word, paragraph by paragraph.
  output.documents.forEach((doc, i) => {
    if (!doc.real) return
    const cited = (doc.citations ?? []).map((c) => c.sourceId).filter((id) => sources.has(id))
    if (cited.length === 0) {
      issues.push(issue('real-uncited', `documents.${i}.citations`, `real document '${doc.id}' cites no source text to check its wording against`))
      return
    }
    doc.body
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0)
      .forEach((paragraph, k) => {
        if (!cited.some((id) => quoteInSource(paragraph, sources.get(id) as string)))
          issues.push(issue('quote-not-in-source', `documents.${i}.body`, `paragraph ${k + 1} of real document '${doc.id}' does not occur word for word in its cited source`))
      })
  })
  output.discoveries.forEach((d, i) => issues.push(...labelIssue(d.sourceLabel, `discoveries.${i}.sourceLabel`, `discovery '${d.id}'`)))
  issues.push(
    ...quoteIssues(
      citationQuotes([
        ...output.documents.map((d, i) => ({ path: `documents.${i}`, citations: citationsOrUndefined(d.citations) })),
        ...output.discoveries.map((d, i) => ({ path: `discoveries.${i}`, citations: citationsOrUndefined(d.citations) })),
      ]),
      sources,
    ),
  )

  return { errors: issues, warnings }
}

// --- persona (one major character) -------------------------------------------------

export function personaIssues(characterId: string, output: PersonaLlmOutput, ctx: Ctx): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const { skeleton, sources } = ctx
  const issues: CheckIssue[] = []
  const character = skeleton.characters.find((c) => c.id === characterId)
  if (character === undefined) return { errors: [issue('ref', '', `character '${characterId}' does not exist`)], warnings: [] }
  const skelIds = skeletonIdSet(skeleton)
  const skelDiscoveryIds = new Set(skeleton.discoveries.map((d) => d.id))
  const skelDocIds = new Set(skeleton.documents.map((d) => d.id))
  const ownDiscoveryIds = new Set(output.discoveries.map((d) => d.id))
  const ownSlantIds = new Set(output.slants.map((s) => s.id))
  const stanceIds = new Set(output.stances.map((_, i) => `s${i + 1}`))
  const hiddenStance = output.stances.findIndex((s) => s.hidden)
  const stageIdsForCharacter = new Set(skeleton.stages.filter((s) => Object.keys(s.placement).includes(characterId)).map((s) => s.id))

  // stances
  if (output.stances.length < 3 || output.stances.length > 5)
    issues.push(issue('stance-count', 'stances', `major character '${characterId}' has ${output.stances.length} stances (3–5 required)`))
  if (output.initialStance < 1 || output.initialStance > output.stances.length || output.stances[output.initialStance - 1]?.hidden === true)
    issues.push(issue('initial-stance', 'initialStance', `initial stance ${output.initialStance} is out of range or hidden`))
  output.stances.forEach((stance, i) => {
    if (stance.hidden && i !== output.stances.length - 1) issues.push(issue('hidden-stance', `stances.${i}.hidden`, 'only the last stance may be hidden'))
  })
  if (output.trustNotice.trim().length === 0) issues.push(issue('trust-notice', 'trustNotice', 'trustNotice is empty'))
  if (output.triggers.length < 1) issues.push(issue('trigger-count', 'triggers', `character '${characterId}' has no triggers`))

  // coreConditions cover exactly this character's skeleton core discoveries
  const heldCores = skeleton.discoveries.filter((d) => d.core && 'characterId' in d.holder && d.holder.characterId === characterId).map((d) => d.id)
  const covered = new Set(output.coreConditions.map((c) => c.discoveryId))
  for (const id of heldCores) if (!covered.has(id)) issues.push(issue('core-condition', 'coreConditions', `skeleton core discovery '${id}' held by '${characterId}' has no coreCondition`))
  output.coreConditions.forEach((c, i) => {
    if (!heldCores.includes(c.discoveryId)) issues.push(issue('core-condition', `coreConditions.${i}.discoveryId`, `'${c.discoveryId}' is not a core discovery held by '${characterId}'`))
    if (c.requires.stanceAtLeast !== null) {
      const target = c.requires.stanceAtLeast
      if (!stanceIds.has(target)) issues.push(issue('ref', `coreConditions.${i}.requires.stanceAtLeast`, `stance '${target}' does not exist`))
      else if (hiddenStance >= 0 && target === `s${hiddenStance + 1}`) issues.push(issue('core-condition', `coreConditions.${i}.requires.stanceAtLeast`, 'a core condition may not require the hidden stance'))
    }
    for (const id of c.requires.discoveries)
      if (!skelDiscoveryIds.has(id) && !ownDiscoveryIds.has(id)) issues.push(issue('ref', `coreConditions.${i}.requires.discoveries`, `discovery '${id}' does not exist`))
  })

  // ids
  const idItems: { id: string; path: string }[] = []
  output.discoveries.forEach((d, i) => idItems.push({ id: d.id, path: `discoveries.${i}.id` }))
  output.slants.forEach((s, i) => idItems.push({ id: s.id, path: `slants.${i}.id` }))
  output.triggers.forEach((t, i) => idItems.push({ id: t.id, path: `triggers.${i}.id` }))
  issues.push(...idIssues(idItems, characterId, skelIds))

  // new discoveries
  output.discoveries.forEach((d, i) => {
    if (!stageIdsForCharacter.has(d.stageId)) issues.push(issue('ref', `discoveries.${i}.stageId`, `stage '${d.stageId}' does not place character '${characterId}'`))
    for (const id of d.requires.discoveries)
      if (!skelDiscoveryIds.has(id) && !ownDiscoveryIds.has(id)) issues.push(issue('ref', `discoveries.${i}.requires.discoveries`, `discovery '${id}' does not exist`))
    if (d.requires.stanceAtLeast !== null && !stanceIds.has(d.requires.stanceAtLeast))
      issues.push(issue('ref', `discoveries.${i}.requires.stanceAtLeast`, `stance '${d.requires.stanceAtLeast}' does not exist`))
    issues.push(...labelIssue(d.sourceLabel, `discoveries.${i}.sourceLabel`, `discovery '${d.id}'`))
  })

  // slants
  output.slants.forEach((slant, i) => {
    for (const id of slant.contradictedBy)
      if (!skelDiscoveryIds.has(id) && !ownDiscoveryIds.has(id)) issues.push(issue('ref', `slants.${i}.contradictedBy`, `discovery '${id}' does not exist`))
  })

  // triggers
  output.triggers.forEach((trigger, i) => {
    const at = `triggers.${i}`
    if (trigger.on.kind === 'slantConfronted') {
      if (!ownSlantIds.has(trigger.on.id)) issues.push(issue('ref', `${at}.on`, `slant '${trigger.on.id}' is not a slant of '${characterId}'`))
    } else if (!skelDiscoveryIds.has(trigger.on.id) && !ownDiscoveryIds.has(trigger.on.id))
      issues.push(issue('ref', `${at}.on`, `discovery '${trigger.on.id}' does not exist`))
    if (trigger.effect.kind === 'toStance' && (trigger.effect.stance === null || !stanceIds.has(trigger.effect.stance)))
      issues.push(issue('ref', `${at}.effect.stance`, `stance '${trigger.effect.stance}' does not exist`))
    if (trigger.effect.kind === 'stanceDelta' && trigger.effect.delta !== 1 && trigger.effect.delta !== -1)
      issues.push(issue('ref', `${at}.effect.delta`, `stanceDelta must be 1 or -1, got ${trigger.effect.delta}`))
    const requireCount = trigger.requires === null ? 0 : trigger.requires.discoveries.length + (trigger.requires.stanceAtLeast !== null ? 1 : 0)
    if (trigger.effect.kind === 'toStance' && trigger.effect.stance !== null && hiddenStance >= 0 && trigger.effect.stance === `s${hiddenStance + 1}` && requireCount < 2)
      issues.push(issue('hidden-stance-guard', `${at}.requires`, `a trigger into the hidden stance needs requires with ≥2 conditions, got ${requireCount}`))
    if (trigger.requires !== null) {
      for (const id of trigger.requires.discoveries)
        if (!skelDiscoveryIds.has(id) && !ownDiscoveryIds.has(id)) issues.push(issue('ref', `${at}.requires.discoveries`, `discovery '${id}' does not exist`))
      if (trigger.requires.stanceAtLeast !== null && !stanceIds.has(trigger.requires.stanceAtLeast))
        issues.push(issue('ref', `${at}.requires.stanceAtLeast`, `stance '${trigger.requires.stanceAtLeast}' does not exist`))
    }
    for (const id of trigger.handsOver) if (!skelDocIds.has(id)) issues.push(issue('ref', `${at}.handsOver`, `document '${id}' is not a skeleton document`))
  })

  // grounding: phrase texts + citations, discovery citations
  issues.push(...phraseIssues(output.persona.phrases, 'persona', sources))
  issues.push(...quoteIssues(citationQuotes(output.discoveries.map((d, i) => ({ path: `discoveries.${i}`, citations: citationsOrUndefined(d.citations) }))), sources))

  return { errors: issues, warnings: [] }
}

// --- minors -------------------------------------------------------------------------

export function minorsIssues(output: MinorsLlmOutput, ctx: Ctx): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const { skeleton, sources } = ctx
  const issues: CheckIssue[] = []
  const skelIds = skeletonIdSet(skeleton)
  const skelDiscoveryIds = new Set(skeleton.discoveries.map((d) => d.id))
  const skelMinors = skeleton.characters.filter((c) => c.tier === 'minor')
  const covered = new Set(output.characters.map((c) => c.characterId))
  for (const minor of skelMinors)
    if (!covered.has(minor.id)) issues.push(issue('ref', 'characters', `minor character '${minor.id}' is missing`))
  output.characters.forEach((entry, i) => {
    if (!skelMinors.some((c) => c.id === entry.characterId)) {
      issues.push(issue('ref', `characters.${i}.characterId`, `'${entry.characterId}' is not a skeleton minor character`))
      return
    }
    const at = `characters.${i}`
    const ownIds = new Set(entry.discoveries.map((d) => d.id))
    const stageIdsForCharacter = new Set(skeleton.stages.filter((s) => Object.keys(s.placement).includes(entry.characterId)).map((s) => s.id))
    if (entry.discoveries.length < 1 || entry.discoveries.length > 2)
      issues.push(issue('minor-discoveries', `${at}.discoveries`, `minor '${entry.characterId}' has ${entry.discoveries.length} discoveries (1–2 required)`))
    if (entry.slants.length > 1) issues.push(issue('ref', `${at}.slants`, `minor '${entry.characterId}' has ${entry.slants.length} slants (0–1 allowed)`))
    const idItems: { id: string; path: string }[] = []
    entry.discoveries.forEach((d, j) => {
      idItems.push({ id: d.id, path: `${at}.discoveries.${j}.id` })
      if (!stageIdsForCharacter.has(d.stageId)) issues.push(issue('ref', `${at}.discoveries.${j}.stageId`, `stage '${d.stageId}' does not place character '${entry.characterId}'`))
      for (const id of d.requires.discoveries)
        if (!skelDiscoveryIds.has(id) && !ownIds.has(id)) issues.push(issue('ref', `${at}.discoveries.${j}.requires.discoveries`, `discovery '${id}' does not exist`))
      issues.push(...labelIssue(d.sourceLabel, `${at}.discoveries.${j}.sourceLabel`, `discovery '${d.id}'`))
    })
    entry.slants.forEach((s, j) => {
      idItems.push({ id: s.id, path: `${at}.slants.${j}.id` })
      for (const id of s.contradictedBy)
        if (!skelDiscoveryIds.has(id) && !ownIds.has(id)) issues.push(issue('ref', `${at}.slants.${j}.contradictedBy`, `discovery '${id}' does not exist`))
      if (s.unlocksDiscoveryId !== null && !ownIds.has(s.unlocksDiscoveryId))
        issues.push(issue('ref', `${at}.slants.${j}.unlocksDiscoveryId`, `'${s.unlocksDiscoveryId}' is not one of '${entry.characterId}'s own discoveries`))
    })
    issues.push(...idIssues(idItems, entry.characterId, skelIds))
    issues.push(...phraseIssues(entry.persona.phrases, `${at}.persona`, sources))
    issues.push(...quoteIssues(citationQuotes(entry.discoveries.map((d, j) => ({ path: `${at}.discoveries.${j}`, citations: citationsOrUndefined(d.citations) }))), sources))
  })
  return { errors: issues, warnings: [] }
}

// --- link --------------------------------------------------------------------------

export interface LinkContext {
  /** every character: id, tier, assigned stance ids (s1..sN for majors), slants, stages placed in */
  characters: { id: string; tier: 'major' | 'minor'; stageIds: string[]; stances: string[]; slants: { id: string; claim: string; contradictedBy: string[]; unlocksDiscoveryId?: string | null }[] }[]
  discoveries: { id: string; stageId: string; holder: string; text: string; core: boolean }[]
  /** persona/minor triggers already written: characterId + on kind/id — link must not re-create them */
  triggers: { characterId: string; on: { kind: string; id: string } }[]
  stageOrder: Map<string, number>
}

export function linkIssues(output: LinkLlmOutput, ctx: LinkContext): CheckIssue[] {
  const issues: CheckIssue[] = []
  const characters = new Map(ctx.characters.map((c) => [c.id, c]))
  const discoveries = new Map(ctx.discoveries.map((d) => [d.id, d]))
  const slantOwner = new Map<string, string>()
  for (const c of ctx.characters) for (const slant of c.slants) slantOwner.set(slant.id, c.id)

  const seen = new Set<string>()
  const pairsSeen = new Set<string>()
  output.slantLinks.forEach((link, i) => {
    const ownerId = slantOwner.get(link.slantId)
    if (ownerId === undefined) {
      issues.push(issue('ref', `slantLinks.${i}.slantId`, `slant '${link.slantId}' does not exist`))
      return
    }
    const owner = characters.get(ownerId)!
    const latestStage = Math.max(...owner.stageIds.map((id) => ctx.stageOrder.get(id) ?? -1))
    for (const [j, id] of link.contradictedBy.entries()) {
      const discovery = discoveries.get(id)
      if (discovery === undefined) issues.push(issue('ref', `slantLinks.${i}.contradictedBy.${j}`, `discovery '${id}' does not exist`))
      else if (discovery.holder === `character:${ownerId}`)
        issues.push(issue('ref', `slantLinks.${i}.contradictedBy.${j}`, `discovery '${id}' is held by the slant's own character`))
      else if ((ctx.stageOrder.get(discovery.stageId) ?? 99) > latestStage)
        issues.push(issue('ref', `slantLinks.${i}.contradictedBy.${j}`, `discovery '${id}' is in a stage after '${ownerId}'s last appearance`))
    }
  })
  output.noteTriggers.forEach((trigger, i) => {
    const at = `noteTriggers.${i}`
    if (!trigger.id.startsWith('link-')) issues.push(issue('id-prefix', `${at}.id`, `link trigger id '${trigger.id}' must start with 'link-'`))
    if (seen.has(trigger.id)) issues.push(issue('duplicate-id', `${at}.id`, `id '${trigger.id}' is used twice`))
    seen.add(trigger.id)
    const character = characters.get(trigger.characterId)
    if (character === undefined || character.tier !== 'major') issues.push(issue('ref', `${at}.characterId`, `'${trigger.characterId}' is not a major character`))
    const discovery = discoveries.get(trigger.discoveryId)
    if (discovery === undefined) issues.push(issue('ref', `${at}.discoveryId`, `discovery '${trigger.discoveryId}' does not exist`))
    else if (discovery.holder === `character:${trigger.characterId}`) issues.push(issue('ref', `${at}.discoveryId`, `discovery '${trigger.discoveryId}' is held by that same character`))
    if (trigger.effect.kind === 'toStance' && (trigger.effect.stance === null || !(character?.stances.includes(trigger.effect.stance) ?? false)))
      issues.push(issue('ref', `${at}.effect.stance`, `stance '${trigger.effect.stance}' does not exist for '${trigger.characterId}'`))
    if (trigger.effect.kind === 'stanceDelta' && trigger.effect.delta !== 1 && trigger.effect.delta !== -1)
      issues.push(issue('ref', `${at}.effect.delta`, `stanceDelta must be 1 or -1, got ${trigger.effect.delta}`))
    const pair = `${trigger.characterId}:${trigger.discoveryId}`
    if (pairsSeen.has(pair) || ctx.triggers.some((t) => t.characterId === trigger.characterId && (t.on.kind === 'notePassed' || t.on.kind === 'discovered') && t.on.id === trigger.discoveryId))
      issues.push(issue('duplicate-trigger', at, `a trigger for '${trigger.characterId}' on discovery '${trigger.discoveryId}' already exists`))
    pairsSeen.add(pair)
  })

  // duplicates: merge same-fact discoveries — only character-held, non-core, non-unlocking drops
  const unlockIds = new Set(ctx.characters.flatMap((c) => c.slants.map((s) => s.unlocksDiscoveryId).filter((id): id is string => id !== null && id !== undefined)))
  const dropped = new Set<string>()
  const keeps = new Set<string>()
  output.duplicates.forEach((dup, i) => {
    const at = `duplicates.${i}`
    const keep = discoveries.get(dup.keep)
    if (keep === undefined) issues.push(issue('duplicate-merge', `${at}.keep`, `keep discovery '${dup.keep}' does not exist`))
    if (dropped.has(dup.keep)) issues.push(issue('duplicate-merge', `${at}.keep`, `keep '${dup.keep}' is itself dropped elsewhere`))
    keeps.add(dup.keep)
    for (const [j, id] of dup.drop.entries()) {
      const at2 = `${at}.drop.${j}`
      const drop = discoveries.get(id)
      if (drop === undefined) {
        issues.push(issue('duplicate-merge', at2, `drop discovery '${id}' does not exist`))
        continue
      }
      if (id === dup.keep) issues.push(issue('duplicate-merge', at2, `keep and drop are the same id '${id}'`))
      if (dropped.has(id)) issues.push(issue('duplicate-merge', at2, `discovery '${id}' is dropped twice`))
      if (keeps.has(id)) issues.push(issue('duplicate-merge', at2, `discovery '${id}' is a keep elsewhere`))
      if (keep !== undefined && drop.stageId !== keep.stageId) issues.push(issue('duplicate-merge', at2, `'${id}' is in stage '${drop.stageId}', keep is in '${keep.stageId}'`))
      if (drop.holder.startsWith('document:')) issues.push(issue('duplicate-merge', at2, `discovery '${id}' is document-held and cannot be dropped`))
      if (drop.core) issues.push(issue('duplicate-merge', at2, `core discovery '${id}' cannot be dropped`))
      if (unlockIds.has(id)) issues.push(issue('duplicate-merge', at2, `discovery '${id}' is unlocked by a slant and cannot be dropped`))
      dropped.add(id)
    }
  })
  return issues
}
