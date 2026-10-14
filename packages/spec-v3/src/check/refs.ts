/**
 * Rule 1: every id a spec refers to must exist, ids are unique adventure-wide (except rooms,
 * which are per-stage, and stances, which are per-character), and the structural
 * invariants zod can't express hold (stance counts, fallback rules, passage offsets, timer length).
 *
 * Codes: `ref`, `duplicate-id`, `timer-stages`, `stance-count`, `initial-stance`, `hidden-stance`,
 * `minor-stances`, `fallback-rule`, `passage-offsets`, `passage-unlinked`.
 */
import type { AdventureSpec, CheckIssue, Condition } from '../index.js'

export function referenceIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })
  const ref = (ok: boolean, path: string, message: string) => {
    if (!ok) add('ref', path, message)
  }

  // --- id indexes -----------------------------------------------------------
  const stages = new Set(spec.stages.map((s) => s.id))
  const characters = new Set(spec.characters.map((c) => c.id))
  const discoveries = new Set(spec.discoveries.map((d) => d.id))
  const documents = new Set(spec.documents.map((d) => d.id))
  const endings = new Set(spec.endings.map((e) => e.id))
  const moments = new Set(spec.definingMoments.map((m) => m.id))
  const sources = new Set(spec.sources.map((s) => s.id))
  const rooms = new Set(spec.stages.flatMap((s) => s.rooms.map((r) => r.id)))
  const slants = new Set(spec.characters.flatMap((c) => c.slants.map((s) => s.id)))
  const stances = new Map(spec.characters.map((c) => [c.id, new Set(c.stances.map((s) => s.id))]))
  const outcomes = new Map(spec.definingMoments.map((m) => [m.id, new Set(m.outcomes.map((o) => o.id))]))
  const acts = new Map(spec.definingMoments.map((m) => [m.id, new Set(m.acts.map((a) => a.id))]))

  // --- duplicate-id: unique across the whole adventure (room ids are per-stage, stance ids
  // per-character, so neither is collected here) ---
  const allIds: { id: string; path: string }[] = []
  const collect = (id: string, path: string) => allIds.push({ id, path })
  spec.stages.forEach((s, i) => collect(s.id, `stages.${i}.id`))
  spec.characters.forEach((c, i) => {
    collect(c.id, `characters.${i}.id`)
    c.slants.forEach((s, j) => collect(s.id, `characters.${i}.slants.${j}.id`))
  })
  spec.discoveries.forEach((d, i) => collect(d.id, `discoveries.${i}.id`))
  spec.documents.forEach((d, i) => {
    collect(d.id, `documents.${i}.id`)
    d.keyPassages.forEach((p, j) => collect(p.id, `documents.${i}.keyPassages.${j}.id`))
  })
  spec.triggers.forEach((t, i) => collect(t.id, `triggers.${i}.id`))
  spec.definingMoments.forEach((m, i) => {
    collect(m.id, `definingMoments.${i}.id`)
    m.acts.forEach((a, j) => collect(a.id, `definingMoments.${i}.acts.${j}.id`))
    m.outcomes.forEach((o, j) => collect(o.id, `definingMoments.${i}.outcomes.${j}.id`))
  })
  spec.endings.forEach((e, i) => {
    collect(e.id, `endings.${i}.id`)
    e.interview.verdicts.forEach((v, j) => collect(v.id, `endings.${i}.interview.verdicts.${j}.id`))
  })
  spec.storyEvents.forEach((e, i) => collect(e.id, `storyEvents.${i}.id`))
  spec.openQuestions.forEach((q, i) => collect(q.id, `openQuestions.${i}.id`))
  spec.hintAngles.forEach((h, i) => collect(h.id, `hintAngles.${i}.id`))
  spec.sources.forEach((s, i) => collect(s.id, `sources.${i}.id`))
  spec.conflicts.forEach((c, i) => collect(c.id, `conflicts.${i}.id`))
  const seen = new Map<string, string>()
  for (const { id, path } of allIds) {
    const first = seen.get(id)
    if (first === undefined) seen.set(id, path)
    else add('duplicate-id', path, `id '${id}' is also used at ${first}`)
  }
  /** Every id anywhere (incl. stances) — for `conflicts.itemIds` membership. */
  const anyId = new Set(allIds.map((x) => x.id))
  spec.characters.forEach((c) => c.stances.forEach((s) => anyId.add(s.id)))

  // --- condition refs ---------------------------------------------------------
  const condition = (value: Condition | undefined, at: string): void => {
    if (value === undefined) return
    if ('all' in value) return value.all.forEach((inner) => condition(inner, at))
    if ('any' in value) return value.any.forEach((inner) => condition(inner, at))
    if ('not' in value) return condition(value.not, at)
    if ('discovered' in value) return ref(discoveries.has(value.discovered), at, `discovery '${value.discovered}' does not exist`)
    if ('stanceAtLeast' in value || 'stanceIs' in value) {
      const { characterId, stanceId } = 'stanceAtLeast' in value ? value.stanceAtLeast : value.stanceIs
      return ref(stances.get(characterId)?.has(stanceId) === true, at, `stance '${characterId}/${stanceId}' does not exist`)
    }
    if ('notePassed' in value) {
      ref(discoveries.has(value.notePassed.discoveryId), at, `discovery '${value.notePassed.discoveryId}' does not exist`)
      return ref(characters.has(value.notePassed.characterId), at, `character '${value.notePassed.characterId}' does not exist`)
    }
    if ('slantConfronted' in value) return ref(slants.has(value.slantConfronted), at, `slant '${value.slantConfronted}' does not exist`)
    if ('act' in value) return ref(acts.get(value.act.momentId)?.has(value.act.actId) === true, at, `act '${value.act.actId}' does not exist in moment '${value.act.momentId}'`)
    if ('outcome' in value)
      return ref(outcomes.get(value.outcome.momentId)?.has(value.outcome.outcomeId) === true, at, `outcome '${value.outcome.outcomeId}' does not exist in moment '${value.outcome.momentId}'`)
    if ('inRoom' in value) return ref(rooms.has(value.inRoom), at, `room '${value.inRoom}' does not exist`)
  }

  const citations = (items: { sourceId: string }[] | undefined, at: string) => {
    for (const c of items ?? []) ref(sources.has(c.sourceId), at, `source '${c.sourceId}' does not exist`)
  }

  // --- timer ------------------------------------------------------------------
  if (spec.timer.stageMinutes.length !== spec.stages.length)
    add('timer-stages', 'timer.stageMinutes', `stageMinutes has ${spec.timer.stageMinutes.length} entries for ${spec.stages.length} stages`)

  // --- stages -----------------------------------------------------------------
  spec.stages.forEach((stage, i) => {
    const at = `stages.${i}`
    const stageRooms = new Set<string>()
    stage.rooms.forEach((room, j) => {
      if (stageRooms.has(room.id)) add('duplicate-id', `${at}.rooms.${j}.id`, `room id '${room.id}' is used twice in stage '${stage.id}'`)
      else stageRooms.add(room.id)
    })
    ref(stageRooms.has(stage.startRoomId), `${at}.startRoomId`, `start room '${stage.startRoomId}' is not a room of stage '${stage.id}'`)
    const moment = spec.definingMoments.find((m) => m.id === stage.definingMomentId)
    ref(moment !== undefined, `${at}.definingMomentId`, `defining moment '${stage.definingMomentId}' does not exist`)
    if (moment !== undefined) ref(moment.stageId === stage.id, `${at}.definingMomentId`, `moment '${moment.id}' has stageId '${moment.stageId}', not '${stage.id}'`)
    for (const [characterId, roomId] of Object.entries(stage.placement)) {
      ref(characters.has(characterId), `${at}.placement.${characterId}`, `placed character '${characterId}' does not exist`)
      ref(stageRooms.has(roomId), `${at}.placement.${characterId}`, `room '${roomId}' is not a room of stage '${stage.id}'`)
    }
    for (const [documentId, roomId] of Object.entries(stage.documentPlacement)) {
      ref(documents.has(documentId), `${at}.documentPlacement.${documentId}`, `placed document '${documentId}' does not exist`)
      ref(roomId === 'held' || stageRooms.has(roomId), `${at}.documentPlacement.${documentId}`, `room '${roomId}' is not a room of stage '${stage.id}'`)
    }
    stage.situations.forEach((situation, j) => {
      ref(
        outcomes.get(situation.whenOutcome.momentId)?.has(situation.whenOutcome.outcomeId) === true,
        `${at}.situations.${j}.whenOutcome`,
        `outcome '${situation.whenOutcome.outcomeId}' does not exist in moment '${situation.whenOutcome.momentId}'`,
      )
      for (const [characterId, stanceId] of Object.entries(situation.stances ?? {}))
        ref(stances.get(characterId)?.has(stanceId) === true, `${at}.situations.${j}.stances.${characterId}`, `stance '${characterId}/${stanceId}' does not exist`)
      for (const [characterId, roomId] of Object.entries(situation.placement ?? {})) {
        ref(characters.has(characterId), `${at}.situations.${j}.placement.${characterId}`, `placed character '${characterId}' does not exist`)
        ref(stageRooms.has(roomId), `${at}.situations.${j}.placement.${characterId}`, `room '${roomId}' is not a room of stage '${stage.id}'`)
      }
      for (const [documentId, roomId] of Object.entries(situation.documentPlacement ?? {})) {
        ref(documents.has(documentId), `${at}.situations.${j}.documentPlacement.${documentId}`, `placed document '${documentId}' does not exist`)
        ref(roomId === 'held' || stageRooms.has(roomId), `${at}.situations.${j}.documentPlacement.${documentId}`, `room '${roomId}' is not a room of stage '${stage.id}'`)
      }
    })
  })

  // each defining moment is referenced by exactly one stage
  const momentRefs = new Map<string, number>()
  for (const stage of spec.stages) momentRefs.set(stage.definingMomentId, (momentRefs.get(stage.definingMomentId) ?? 0) + 1)
  spec.definingMoments.forEach((moment, i) => {
    const count = momentRefs.get(moment.id) ?? 0
    ref(count === 1, `definingMoments.${i}.id`, `moment '${moment.id}' is referenced by ${count} stages`)
  })

  // --- characters ---------------------------------------------------------------
  spec.characters.forEach((character, i) => {
    const at = `characters.${i}`
    if (character.tier === 'major') {
      if (character.stances.length < 3 || character.stances.length > 5)
        add('stance-count', `${at}.stances`, `major character '${character.id}' has ${character.stances.length} stances (3–5 required)`)
      if (character.initialStanceId === null || stances.get(character.id)?.has(character.initialStanceId) !== true)
        add('initial-stance', `${at}.initialStanceId`, `major character '${character.id}' has no valid initial stance`)
      character.stances.forEach((stance, j) => {
        if (stance.hidden === true && j !== character.stances.length - 1)
          add('hidden-stance', `${at}.stances.${j}.hidden`, `only the last stance of '${character.id}' may be hidden`)
      })
    } else if (character.stances.length !== 0)
      add('minor-stances', `${at}.stances`, `minor character '${character.id}' must have no stances`)
    character.slants.forEach((slant, j) => {
      for (const id of slant.contradictedBy) ref(discoveries.has(id), `${at}.slants.${j}.contradictedBy`, `discovery '${id}' does not exist`)
      if (slant.unlocksDiscoveryId !== undefined) ref(discoveries.has(slant.unlocksDiscoveryId), `${at}.slants.${j}.unlocksDiscoveryId`, `discovery '${slant.unlocksDiscoveryId}' does not exist`)
    })
    character.persona.phrases.forEach((phrase, j) => citations(phrase.citations, `${at}.persona.phrases.${j}.citations`))
  })

  // --- discoveries ----------------------------------------------------------------
  spec.discoveries.forEach((discovery, i) => {
    const at = `discoveries.${i}`
    ref(stages.has(discovery.stageId), `${at}.stageId`, `stage '${discovery.stageId}' does not exist`)
    if ('characterId' in discovery.holder) ref(characters.has(discovery.holder.characterId), `${at}.holder`, `holder character '${discovery.holder.characterId}' does not exist`)
    else {
      const { documentId, keyPassageId } = discovery.holder
      const doc = spec.documents.find((d) => d.id === documentId)
      ref(doc?.keyPassages.some((p) => p.id === keyPassageId) === true, `${at}.holder`, `key passage '${keyPassageId}' does not exist in document '${documentId}'`)
    }
    condition(discovery.condition, `${at}.condition`)
    citations(discovery.citations, `${at}.citations`)
  })

  // --- documents ------------------------------------------------------------------
  spec.documents.forEach((document, i) => {
    const at = `documents.${i}`
    document.keyPassages.forEach((passage, j) => {
      if (!(passage.start < passage.end && passage.end <= document.body.length))
        add('passage-offsets', `${at}.keyPassages.${j}`, `passage '${passage.id}' has invalid offsets ${passage.start}–${passage.end} in a body of length ${document.body.length}`)
      if (!spec.discoveries.some((d) => 'keyPassageId' in d.holder && d.holder.keyPassageId === passage.id))
        add('passage-unlinked', `${at}.keyPassages.${j}.id`, `key passage '${passage.id}' is not linked by any discovery`)
    })
    citations(document.citations, `${at}.citations`)
  })

  // --- triggers --------------------------------------------------------------------
  spec.triggers.forEach((trigger, i) => {
    const at = `triggers.${i}`
    ref(characters.has(trigger.characterId), `${at}.characterId`, `character '${trigger.characterId}' does not exist`)
    if ('notePassed' in trigger.on) ref(discoveries.has(trigger.on.notePassed), `${at}.on`, `discovery '${trigger.on.notePassed}' does not exist`)
    if ('discovered' in trigger.on) ref(discoveries.has(trigger.on.discovered), `${at}.on`, `discovery '${trigger.on.discovered}' does not exist`)
    if ('slantConfronted' in trigger.on) ref(slants.has(trigger.on.slantConfronted), `${at}.on`, `slant '${trigger.on.slantConfronted}' does not exist`)
    if ('toStance' in trigger.effect) ref(stances.get(trigger.characterId)?.has(trigger.effect.toStance) === true, `${at}.effect`, `stance '${trigger.characterId}/${trigger.effect.toStance}' does not exist`)
    for (const id of trigger.handsOver ?? []) ref(documents.has(id), `${at}.handsOver`, `document '${id}' does not exist`)
    condition(trigger.requires, `${at}.requires`)
  })

  // --- defining moments --------------------------------------------------------------
  spec.definingMoments.forEach((moment, i) => {
    const at = `definingMoments.${i}`
    ref(characters.has(moment.deciderId), `${at}.deciderId`, `decider '${moment.deciderId}' does not exist`)
    ref(stages.has(moment.stageId), `${at}.stageId`, `stage '${moment.stageId}' does not exist`)
    moment.acts.forEach((act, j) => {
      if (!moment.rules.some((rule) => rule.actId === act.id && rule.when === undefined))
        add('fallback-rule', `${at}.acts.${j}.id`, `act '${act.id}' has no fallback rule (a rule without 'when')`)
      for (const unlock of act.secret?.unlock ?? []) condition(unlock, `${at}.acts.${j}.secret.unlock`)
    })
    moment.rules.forEach((rule, j) => {
      ref(acts.get(moment.id)?.has(rule.actId) === true, `${at}.rules.${j}.actId`, `act '${rule.actId}' does not exist in moment '${moment.id}'`)
      ref(outcomes.get(moment.id)?.has(rule.outcomeId) === true, `${at}.rules.${j}.outcomeId`, `outcome '${rule.outcomeId}' does not exist in moment '${moment.id}'`)
      condition(rule.when, `${at}.rules.${j}.when`)
    })
    moment.outcomes.forEach((outcome, j) => {
      for (const id of outcome.closesEndingIds) ref(endings.has(id), `${at}.outcomes.${j}.closesEndingIds`, `ending '${id}' does not exist`)
      if (outcome.endingId !== undefined) ref(endings.has(outcome.endingId), `${at}.outcomes.${j}.endingId`, `ending '${outcome.endingId}' does not exist`)
    })
  })

  // --- endings ------------------------------------------------------------------------
  spec.endings.forEach((ending, i) => {
    const at = `endings.${i}`
    ending.interview.verdicts.forEach((verdict, j) => {
      for (const id of verdict.counterPoints)
        ref(discoveries.has(id) || documents.has(id), `${at}.interview.verdicts.${j}.counterPoints`, `counter-point '${id}' is not a discovery or document`)
    })
    citations(ending.citations, `${at}.citations`)
  })

  // --- story events ---------------------------------------------------------------------
  spec.storyEvents.forEach((event, i) => {
    const at = `storyEvents.${i}`
    const stage = spec.stages.find((s) => s.id === event.stageId)
    ref(stage !== undefined, `${at}.stageId`, `stage '${event.stageId}' does not exist`)
    if ('characterId' in event && event.characterId !== undefined) ref(characters.has(event.characterId), `${at}.characterId`, `character '${event.characterId}' does not exist`)
    if (event.effect === 'move') {
      const roomOk = stage !== undefined && stage.rooms.some((r) => r.id === event.toRoomId)
      ref(roomOk, `${at}.toRoomId`, `room '${event.toRoomId}' is not a room of stage '${event.stageId}'`)
    }
    if (event.effect === 'deliverDocument') ref(documents.has(event.documentId), `${at}.documentId`, `document '${event.documentId}' does not exist`)
    if ('condition' in event.when) condition(event.when.condition, `${at}.when.condition`)
  })

  // --- open questions / hint angles -------------------------------------------------------
  spec.openQuestions.forEach((question, i) => {
    const at = `openQuestions.${i}`
    ref(stages.has(question.stageId), `${at}.stageId`, `stage '${question.stageId}' does not exist`)
    question.discoveryIds.forEach((id, j) => {
      const discovery = spec.discoveries.find((d) => d.id === id)
      ref(discovery !== undefined, `${at}.discoveryIds.${j}`, `discovery '${id}' does not exist`)
      if (discovery !== undefined) ref(discovery.stageId === question.stageId, `${at}.discoveryIds.${j}`, `discovery '${id}' belongs to stage '${discovery.stageId}', not '${question.stageId}'`)
    })
  })
  spec.hintAngles.forEach((hint, i) => ref(discoveries.has(hint.discoveryId), `hintAngles.${i}.discoveryId`, `discovery '${hint.discoveryId}' does not exist`))

  // --- conflicts ---------------------------------------------------------------------------
  spec.conflicts.forEach((conflict, i) => {
    const at = `conflicts.${i}`
    ref(sources.has(conflict.sourceId), `${at}.sourceId`, `source '${conflict.sourceId}' does not exist`)
    conflict.itemIds.forEach((id, j) => ref(anyId.has(id), `${at}.itemIds.${j}`, `item '${id}' is not any id in the spec`))
  })

  return issues
}
