/**
 * `summarise(spec, attempts) → ClassSummary` [T2.1–T2.7]. Pure: class totals from each attempt's recorded events.
 *
 * - Counts are per attempt, not per event: a student shown three hints about the same thing counts once.
 * - Nothing records whether a prediction was right (P3.6, C4).
 * - Anonymised answers carry no attempt id, and are picked with a seed from the adventure id, so the same
 *   class gives the same selection on every load.
 * - Flags are per attempt, so the platform can show them for that student (T5).
 */
import { createRng } from '@adventure/orchestration'
import type { ClassSummary, GameEvent, GameEventOf } from '@adventure/play-contract'

import type { EngineSpec } from '../spec'

export const MAX_ANSWERS = 8

export interface AttemptEvents {
  attemptId: string
  events: readonly GameEvent[]
}

function ofType<T extends GameEvent['type']>(events: readonly GameEvent[], type: T): GameEventOf<T>[] {
  return events.filter((event): event is GameEventOf<T> => event.type === type)
}

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}

export function summarise(spec: EngineSpec, attempts: readonly AttemptEvents[]): ClassSummary {
  const discoveryLabel = (id: string | null) => (id === null ? 'Nothing in particular' : (spec.discoveries.find((discovery) => discovery.id === id)?.text ?? id))
  const characterName = (id: string) => spec.characters.find((character) => character.id === id)?.name ?? id

  // Where students got stuck (T2.1).
  const stuck = new Map<string, { stageIndex: number; targetDiscoveryId: string | null; count: number }>()
  for (const { events } of attempts) {
    const keys = new Set(ofType(events, 'hint').map((hint) => JSON.stringify([hint.stageIndex ?? 0, hint.targetDiscoveryId])))
    for (const key of keys) {
      const [stageIndex, targetDiscoveryId] = JSON.parse(key) as [number, string | null]
      const entry = stuck.get(key) ?? { stageIndex, targetDiscoveryId, count: 0 }
      entry.count += 1
      stuck.set(key, entry)
    }
  }

  // How predictions split (T2.2): the last prediction per attempt per moment.
  const predictions = spec.definingMoments.map((moment) => {
    const counts = new Map<string, number>()
    for (const { events } of attempts) {
      const prediction = last(ofType(events, 'prediction').filter((event) => event.momentId === moment.id))
      if (prediction !== undefined) counts.set(prediction.outcomeId, (counts.get(prediction.outcomeId) ?? 0) + 1)
    }
    return {
      momentId: moment.id,
      stageIndex: Math.max(0, spec.stages.findIndex((stage) => stage.definingMomentId === moment.id)),
      question: `What will ${characterName(moment.deciderId)} decide?`,
      options: moment.outcomes.filter((outcome) => outcome.secret !== true).map((outcome) => ({ outcomeId: outcome.id, label: outcome.predictionText, count: counts.get(outcome.id) ?? 0 })),
    }
  })

  // Interview verdicts (T2.3) and anonymised answers (T2.6).
  const answers: ClassSummary['answers'] = []
  const verdicts = spec.endings.map((ending) => {
    const initial = new Map<string, number>()
    const final = new Map<string, number>()
    const evidence = new Map<string, number>()
    let changed = 0
    for (const { events } of attempts) {
      const mine = ofType(events, 'verdict').filter((event) => event.endingId === ending.id)
      const first = mine.find((event) => event.stage === 'initial')
      const response = last(mine.filter((event) => event.stage === 'final'))
      if (first === undefined) continue
      initial.set(first.verdictId, (initial.get(first.verdictId) ?? 0) + 1)
      const settled = response ?? first
      final.set(settled.verdictId, (final.get(settled.verdictId) ?? 0) + 1)
      if (response !== undefined && response.verdictId !== first.verdictId) changed += 1
      const noteToDiscovery = new Map(ofType(events, 'discovery').map((event) => [event.noteId, event.discoveryId]))
      const used = new Set(mine.flatMap((event) => event.evidenceNoteIds).map((noteId) => noteToDiscovery.get(noteId)).filter((id): id is string => id !== undefined))
      for (const id of used) evidence.set(id, (evidence.get(id) ?? 0) + 1)
      const text = response?.text ?? first.text
      if (text !== null && text.trim().length > 0) {
        answers.push({ endingId: ending.id, verdictLabel: ending.interview.verdicts.find((verdict) => verdict.id === settled.verdictId)?.text ?? settled.verdictId, text: text.trim() })
      }
    }
    return {
      endingId: ending.id,
      question: ending.interview.question,
      options: ending.interview.verdicts.map((verdict) => ({ verdictId: verdict.id, label: verdict.text, initial: initial.get(verdict.id) ?? 0, final: final.get(verdict.id) ?? 0 })),
      changedAfterPushBack: changed,
      evidence: [...evidence.entries()].sort((a, b) => b[1] - a[1]).map(([discoveryId, count]) => ({ discoveryId, label: discoveryLabel(discoveryId), count })),
    }
  })

  // Discoveries found or missed, per holder (T2.4).
  const found = new Map<string, number>()
  for (const { events } of attempts) for (const id of new Set(ofType(events, 'discovery').map((event) => event.discoveryId))) found.set(id, (found.get(id) ?? 0) + 1)
  const holders = new Map<string, { holderId: string; holderName: string; items: ClassSummary['discoveries'][number]['items'] }>()
  for (const discovery of spec.discoveries) {
    const holderId = 'characterId' in discovery.holder ? discovery.holder.characterId : discovery.holder.documentId
    const holderName = 'characterId' in discovery.holder ? characterName(holderId) : (spec.documents.find((document) => document.id === holderId)?.title ?? holderId)
    const entry = holders.get(holderId) ?? { holderId, holderName, items: [] }
    entry.items.push({ discoveryId: discovery.id, label: discovery.text, core: discovery.core, found: found.get(discovery.id) ?? 0 })
    holders.set(holderId, entry)
  }

  // Endings reached (T2.5).
  const reached = new Map<string, number>()
  let completed = 0
  for (const { events } of attempts) {
    const ending = last(ofType(events, 'outcome').filter((event) => event.endingId !== null))
    if (ending?.endingId) reached.set(ending.endingId, (reached.get(ending.endingId) ?? 0) + 1)
    if (ofType(events, 'phase').some((event) => event.to === 'reveal')) completed += 1
  }

  // Anonymised answers: a seeded shuffle, then the first few.
  const rng = createRng(spec.id)
  for (let i = answers.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i)
    ;[answers[i], answers[j]] = [answers[j] as (typeof answers)[number], answers[i] as (typeof answers)[number]]
  }

  const checkedDocuments = spec.documents.filter((document) => document.readingCheck !== undefined)
  const readingChecks = checkedDocuments.map((document) => {
    let attempted = 0, firstAttemptCorrect = 0, completed = 0, recovered = 0
    for (const { events } of attempts) {
      const submissions = ofType(events, 'readingCheck').filter((event) => event.documentId === document.id && !event.recovery)
      const first = submissions[0]
      if (first === undefined) continue
      attempted += 1
      if (first.correct) firstAttemptCorrect += 1
      if (submissions.some((event) => event.correct)) {
        completed += 1
        if (!first.correct) recovered += 1
      }
    }
    return { documentId: document.id, title: document.title, attempted, firstAttemptCorrect, completed, recovered }
  })

  return {
    adventureId: spec.id,
    attempts: attempts.length,
    completed,
    ...(checkedDocuments.length === 0 ? {} : { readingChecks }),
    stuck: [...stuck.values()]
      .sort((a, b) => b.count - a.count || a.stageIndex - b.stageIndex)
      .map((entry) => ({ ...entry, label: discoveryLabel(entry.targetDiscoveryId) })),
    predictions,
    verdicts,
    discoveries: [...holders.values()],
    endings: spec.endings.map((ending) => ({ endingId: ending.id, label: ending.title, type: ending.type, count: reached.get(ending.id) ?? 0 })),
    answers: answers.slice(0, MAX_ANSWERS),
    flags: attempts
      .map(({ attemptId, events }) => ({ attemptId, count: ofType(events, 'flag').length }))
      .filter((entry) => entry.count > 0),
  }
}
