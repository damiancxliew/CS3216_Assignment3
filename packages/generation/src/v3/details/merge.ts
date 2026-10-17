/**
 * Merge the skeleton + the four detail outputs into a draft AdventureSpec. Fields owned by the
 * endings/reveal passes are filled by `withPendingEndingsFields` placeholders.
 */
import type { AdventureSpec, CheckIssue, Condition, SkeletonShape, SpecCharacter, SpecDiscovery, SpecDocument, SpecEnding, SpecMoment, SpecStage, SpecStoryEvent, SpecTrigger } from '@adventure/spec-v3'

import { citations, pairs, toCondition, toEffect, toDocument, toWhen } from './schema'
import type { LinkLlmOutput, MinorsLlmOutput, PersonaLlmOutput, StageDetailsLlmOutput } from './schema'

export interface DetailsParts {
  stages: Map<string, StageDetailsLlmOutput>
  personas: Map<string, PersonaLlmOutput>
  minors: MinorsLlmOutput | null
  link: LinkLlmOutput
}

export interface MergeResult {
  draft: AdventureSpec
  warnings: CheckIssue[]
  slantedDocuments: { stageId: string; documentId: string; note: string }[]
}

/** Fields the endings pass overwrites — placeholder text/structure so the draft validates. */
export function withPendingEndingsFields(moment: SkeletonShape['definingMoments'][number]): SpecMoment {
  return {
    ...moment,
    nudge: '',
    finalCallNarration: '',
    acts: moment.acts.map((act) => ({ ...act, reaction: '' })),
    outcomes: moment.outcomes.map((outcome) => ({ ...outcome, predictionText: '', because: '' })),
  }
}

const pendingEnding = (ending: SkeletonShape['endings'][number]): SpecEnding => ({
  ...ending,
  epilogue: '',
  interview: {
    interviewer: '',
    question: '',
    verdicts: [1, 2, 3].map((n) => ({ id: `${ending.id}-pending-v${n}`, text: '', counterPoints: [] })),
    generalCounter: '',
  },
})

const emptyToUndefined = <T>(value: T | ''): T | undefined => (value === '' ? undefined : value)

/** drop angles whose discovery is gone (e.g. merged away) and dedupe identical ones. */
const dedupeHintAngles = (angles: AdventureSpec['hintAngles'], discoveries: SpecDiscovery[]): AdventureSpec['hintAngles'] => {
  const live = new Set(discoveries.map((d) => d.id))
  const seen = new Set<string>()
  return angles.filter((angle) => {
    if (!live.has(angle.discoveryId)) return false
    const key = `${angle.discoveryId}:${angle.kind}:${angle.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeDetails(skeleton: SkeletonShape, parts: DetailsParts): MergeResult {
  const warnings: CheckIssue[] = []
  const slantedDocuments: MergeResult['slantedDocuments'] = []
  const warn = (code: string, path: string, message: string) => warnings.push({ code, path, message })

  // --- stages, documents, discoveries ------------------------------------------------------
  const documents: SpecDocument[] = []
  const discoveries: SpecDiscovery[] = []
  const storyEvents: SpecStoryEvent[] = []
  const openQuestions: AdventureSpec['openQuestions'] = []
  const hintAngles: AdventureSpec['hintAngles'] = []

  const stages: SpecStage[] = skeleton.stages.map((stage) => {
    const output = parts.stages.get(stage.id)
    if (output === undefined) throw new Error(`no details output for stage '${stage.id}'`)

    const docStubs = new Map(skeleton.documents.map((d) => [d.id, d]))
    const written = new Set<string>()
    for (const doc of output.documents) {
      const stub = docStubs.get(doc.id)
      const base = toDocument(doc)
      documents.push(
        stub === undefined
          ? base
          : { ...base, id: stub.id, kind: stub.kind, title: stub.title, real: stub.real },
      )
      written.add(doc.id)
      if (doc.slanted && doc.slantNote !== null && doc.slantNote.trim() !== '')
        slantedDocuments.push({ stageId: stage.id, documentId: doc.id, note: doc.slantNote })
    }

    const coreLinkByDiscovery = new Map(output.coreLinks.map((l) => [l.discoveryId, l.keyPassageId]))
    for (const discovery of skeleton.discoveries.filter((d) => d.stageId === stage.id)) {
      if (!('documentId' in discovery.holder)) continue
      discoveries.push({ ...discovery, holder: { documentId: discovery.holder.documentId, keyPassageId: coreLinkByDiscovery.get(discovery.id) ?? '' } })
    }
    for (const discovery of output.discoveries) {
      const topic = emptyToUndefined(discovery.topic)
      discoveries.push({
        id: discovery.id,
        stageId: stage.id,
        holder: { documentId: discovery.documentId, keyPassageId: discovery.keyPassageId },
        text: discovery.text,
        note: discovery.note,
        ...(topic !== undefined ? { topic } : {}),
        core: false,
        sourceLabel: discovery.sourceLabel,
        citations: citations(discovery.citations),
      })
    }

    const stageCoreIds = skeleton.discoveries.filter((d) => d.stageId === stage.id).map((d) => d.id)
    for (const event of output.storyEvents) {
      const base = { id: event.id, stageId: stage.id, when: toWhen(event.when, stageCoreIds), text: event.text }
      switch (event.effect) {
        case 'summons':
          storyEvents.push({ ...base, effect: 'summons', characterId: event.characterId! })
          break
        case 'move':
          storyEvents.push({ ...base, effect: 'move', characterId: event.characterId!, toRoomId: event.toRoomId! })
          break
        case 'deliverDocument':
          storyEvents.push({
            ...base,
            effect: 'deliverDocument',
            documentId: event.documentId!,
            ...(event.characterId !== null ? { characterId: event.characterId } : {}),
          })
          break
        case 'news':
          storyEvents.push({ ...base, effect: 'news' })
          break
        case 'beginMoment':
          storyEvents.push({ ...base, effect: 'beginMoment' })
          break
      }
    }
    for (const question of output.openQuestions) openQuestions.push({ id: question.id, stageId: stage.id, text: question.text, discoveryIds: question.discoveryIds })
    hintAngles.push(...output.hintAngles)

    return {
      id: stage.id,
      title: stage.title,
      timePlace: stage.timePlace,
      centralQuestion: stage.centralQuestion,
      openingNarration: output.openingNarration,
      rooms: stage.rooms,
      startRoomId: stage.startRoomId,
      placement: stage.placement,
      documentPlacement: pairs(output.documentPlacement, 'documentId', 'roomId'),
      situations: output.situations.map((situation) => ({
        whenOutcome: { momentId: situation.momentId, outcomeId: situation.outcomeId },
        ...(situation.placement !== null ? { placement: pairs(situation.placement, 'characterId', 'roomId') } : {}),
        ...(situation.documentPlacement !== null ? { documentPlacement: pairs(situation.documentPlacement, 'documentId', 'roomId') } : {}),
        ...(situation.openingNarration !== null ? { openingNarration: situation.openingNarration } : {}),
      })),
      definingMomentId: stage.definingMomentId,
    }
  })

  // --- characters ----------------------------------------------------------------------------
  const triggers: SpecTrigger[] = []
  const linkContradictions = new Map<string, string[]>()
  for (const link of parts.link.slantLinks) linkContradictions.set(link.slantId, link.contradictedBy)

  const droppedSlants = new Set<string>()

  const toSpecDiscovery = (
    discovery: { id: string; stageId: string; text: string; note: string; topic: string; sourceLabel: string; citations: { sourceId: string; quote: string | null }[] | null },
    holder: SpecDiscovery['holder'],
    condition: Condition | undefined,
  ): SpecDiscovery => {
    const topic = emptyToUndefined(discovery.topic)
    return {
      id: discovery.id,
      stageId: discovery.stageId,
      holder,
      text: discovery.text,
      note: discovery.note,
      ...(topic !== undefined ? { topic } : {}),
      core: false,
      ...(condition !== undefined ? { condition } : {}),
      sourceLabel: discovery.sourceLabel,
      citations: citations(discovery.citations),
    }
  }

  const characters: SpecCharacter[] = skeleton.characters.map((character) => {
    const base = {
      id: character.id,
      name: character.name,
      title: character.title,
      real: character.real,
      tier: character.tier,
    }
    const skeletonPersona = {
      publicPosition: character.persona.publicPosition,
      privateAgenda: character.persona.privateAgenda,
    }

    const buildSlants = (raw: { id: string; claim: string; contradictedBy: string[]; unlocksDiscoveryId?: string | null }[]) => {
      const slants: SpecCharacter['slants'] = []
      raw.forEach((slant) => {
        const contradictedBy = [...new Set([...slant.contradictedBy, ...(linkContradictions.get(slant.id) ?? [])])]
        const unlocks = slant.unlocksDiscoveryId
        slants.push({
          id: slant.id,
          claim: slant.claim,
          contradictedBy,
          ...(unlocks !== null && unlocks !== undefined && unlocks !== '' ? { unlocksDiscoveryId: unlocks } : {}),
        })
      })
      return slants
    }

    if (character.tier === 'major') {
      const output = parts.personas.get(character.id)
      if (output === undefined) throw new Error(`no persona output for '${character.id}'`)
      const stances = output.stances.map((stance, i) => ({
        id: `s${i + 1}`,
        label: stance.label,
        demeanour: stance.demeanour,
        ...(stance.hidden ? { hidden: true } : {}),
      }))
      for (const held of skeleton.discoveries.filter((d) => 'characterId' in d.holder && d.holder.characterId === character.id)) {
        const requires = output.coreConditions.find((c) => c.discoveryId === held.id)?.requires
        const condition = requires === undefined ? undefined : toCondition(requires, character.id)
        discoveries.push({ ...held, holder: { characterId: character.id }, ...(condition !== undefined ? { condition } : {}) })
      }
      for (const discovery of output.discoveries)
        discoveries.push(toSpecDiscovery(discovery, { characterId: character.id }, toCondition(discovery.requires, character.id)))
      for (const trigger of output.triggers) {
        triggers.push({
          id: trigger.id,
          characterId: character.id,
          on: { [trigger.on.kind]: trigger.on.id } as SpecTrigger['on'],
          ...(trigger.requires !== null ? { requires: toCondition(trigger.requires, character.id) } : {}),
          effect: toEffect(trigger.effect),
          ...(trigger.handsOver.length > 0 ? { handsOver: trigger.handsOver } : {}),
          notice: trigger.notice,
        })
      }
      return {
        ...base,
        persona: {
          voice: output.persona.voice,
          phrases: output.persona.phrases.map((phrase) => ({ text: phrase.text, sourceLabel: phrase.sourceLabel, citations: citations(phrase.citations) })),
          knewThen: output.persona.knewThen,
          wantsFromStudent: output.persona.wantsFromStudent,
          withholds: output.persona.withholds,
          ...skeletonPersona,
        },
        stances,
        initialStanceId: `s${output.initialStance}`,
        slants: buildSlants(output.slants),
        trustNotice: output.trustNotice,
      }
    }

    const minor = parts.minors?.characters.find((c) => c.characterId === character.id)
    if (minor === undefined) throw new Error(`no minors output for '${character.id}'`)
    for (const held of skeleton.discoveries.filter((d) => 'characterId' in d.holder && d.holder.characterId === character.id)) discoveries.push({ ...held, holder: { characterId: character.id } })
    for (const discovery of minor.discoveries)
      discoveries.push(toSpecDiscovery(discovery, { characterId: character.id }, discovery.requires.discoveries.length > 0 ? toCondition({ discoveries: discovery.requires.discoveries, stanceAtLeast: null }, character.id) : undefined))
    return {
      ...base,
      persona: {
        voice: minor.persona.voice,
        phrases: minor.persona.phrases.map((phrase) => ({ text: phrase.text, sourceLabel: phrase.sourceLabel, citations: citations(phrase.citations) })),
        knewThen: minor.persona.knewThen,
        wantsFromStudent: minor.persona.wantsFromStudent,
        withholds: minor.persona.withholds,
        ...skeletonPersona,
      },
      stances: [],
      initialStanceId: null,
      slants: buildSlants(minor.slants),
    }
  })

  // link noteTriggers → triggers (after persona triggers, so persona wins a (characterId, on) tie)
  for (const trigger of parts.link.noteTriggers)
    triggers.push({ id: trigger.id, characterId: trigger.characterId, on: { notePassed: trigger.discoveryId }, effect: toEffect(trigger.effect), notice: trigger.notice })

  // --- link duplicates: drop the merged-away discoveries and remap every reference -------------
  const dropToKeep = new Map<string, string>()
  for (const dup of parts.link.duplicates) for (const id of dup.drop) dropToKeep.set(id, dup.keep)
  if (dropToKeep.size > 0) {
    const remapId = (id: string) => dropToKeep.get(id) ?? id
    const remapCondition = (condition: Condition): Condition => {
      if ('all' in condition) return { all: condition.all.map(remapCondition) }
      if ('any' in condition) return { any: condition.any.map(remapCondition) }
      if ('not' in condition) return { not: remapCondition(condition.not) }
      if ('discovered' in condition) return { discovered: remapId(condition.discovered) }
      if ('notePassed' in condition) return { notePassed: { ...condition.notePassed, discoveryId: remapId(condition.notePassed.discoveryId) } }
      return condition
    }
    const dedupe = (ids: string[]) => [...new Set(ids)]
    for (const [drop, keep] of dropToKeep) warn('discovery-merged', 'discoveries', `'${drop}' merged into '${keep}'`)

    for (const d of discoveries) {
      if (d.condition !== undefined) d.condition = remapCondition(d.condition)
    }
    for (const trigger of triggers) {
      if ('notePassed' in trigger.on) trigger.on = { notePassed: remapId(trigger.on.notePassed) }
      else if ('discovered' in trigger.on) trigger.on = { discovered: remapId(trigger.on.discovered) }
      if (trigger.requires !== undefined) trigger.requires = remapCondition(trigger.requires)
    }
    for (const event of storyEvents) if ('condition' in event.when) event.when = { condition: remapCondition(event.when.condition) }
    for (const question of openQuestions) question.discoveryIds = dedupe(question.discoveryIds.map(remapId))
    for (const angle of hintAngles) angle.discoveryId = remapId(angle.discoveryId)
    for (const character of characters)
      character.slants = character.slants.map((slant) => ({ ...slant, contradictedBy: dedupe(slant.contradictedBy.map(remapId)) }))
    for (let i = discoveries.length - 1; i >= 0; i--) if (dropToKeep.has(discoveries[i]!.id)) discoveries.splice(i, 1)
  }

  // one drop path: a slant needs a contradiction held by a document or another character (glossary)
  for (const character of characters) {
    const heldIds = new Set(discoveries.filter((d) => 'characterId' in d.holder && d.holder.characterId === character.id).map((d) => d.id))
    character.slants = character.slants.map((slant) => ({ ...slant, contradictedBy: slant.contradictedBy.filter((id) => !heldIds.has(id)) }))
    character.slants = character.slants.filter((slant) => {
      if (slant.contradictedBy.length === 0) {
        droppedSlants.add(slant.id)
        warn('slant-dropped', `characters.${characters.indexOf(character)}.slants`, `slant '${slant.id}' has no contradicting discovery held by a document or another character`)
        return false
      }
      return true
    })
  }

  // after remapping, two triggers may share (characterId, on) — keep the first (persona before link)
  const keptTriggers = triggers.filter((trigger, i) => {
    const onKey = `${trigger.characterId}:${JSON.stringify(trigger.on)}`
    const earlier = triggers.findIndex((t) => `${t.characterId}:${JSON.stringify(t.on)}` === onKey)
    if (earlier !== i) {
      warn('trigger-merged', 'triggers', `trigger '${trigger.id}' duplicates '${triggers[earlier]!.id}' on ${onKey}`)
      return false
    }
    if ('slantConfronted' in trigger.on && droppedSlants.has(trigger.on.slantConfronted)) {
      warn('slant-dropped', 'triggers', `trigger '${trigger.id}' dropped: its slant was dropped`)
      return false
    }
    return true
  })

  const draft: AdventureSpec = {
    id: skeleton.id,
    title: skeleton.title,
    readingLevel: skeleton.readingLevel,
    ...(skeleton.arc !== undefined ? { arc: skeleton.arc } : {}),
    timer: { enabled: true, stageMinutes: skeleton.stages.map(() => 30 / skeleton.stages.length) },
    role: skeleton.role,
    stages,
    characters,
    discoveries,
    documents,
    triggers: keptTriggers,
    definingMoments: skeleton.definingMoments.map(withPendingEndingsFields),
    endings: skeleton.endings.map(pendingEnding),
    teacherQuestions: [],
    sources: skeleton.sources.map((s) => ({ ...s })),
    conflicts: [],
    storyEvents,
    openQuestions,
    hintAngles: dedupeHintAngles(hintAngles, discoveries),
  }
  return { draft, warnings, slantedDocuments }
}
