/**
 * Detail-only reference rules: everything `checkSpec` checks that a skeleton does not have —
 * situations, stances, slants, conditions, triggers, story events, open questions, hint angles,
 * conflicts, key passages, verdict counter-points and the detail `duplicate-id` set. The
 * skeleton-level refs (placement, moments, endings, discovery stage/holder, …) live in
 * `skeleton.ts` inside `checkSkeleton`.
 *
 * Codes: `ref`, `duplicate-id`, `timer-stages`, `stance-count`, `initial-stance`, `hidden-stance`,
 * `minor-stances`, `fallback-rule`, `passage-offsets`, `passage-unlinked`.
 */
import type { AdventureSpec, CheckIssue, Condition } from '../index.js'
import { skeletonIds } from './skeleton.js'

export function referenceIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })
  const ref = (ok: boolean, path: string, message: string, ids: string[]) => {
    if (!ok) issues.push({ code: 'ref', path, message, ids })
  }

  // --- id indexes -------------------------------------------------------------
  const discoveries = new Set(spec.discoveries.map((d) => d.id))
  const documents = new Set(spec.documents.map((d) => d.id))
  const rooms = new Set(spec.stages.flatMap((s) => s.rooms.map((r) => r.id)))
  const slants = new Set(spec.characters.flatMap((c) => c.slants.map((s) => s.id)))
  const stances = new Map(spec.characters.map((c) => [c.id, new Set(c.stances.map((s) => s.id))]))
  const outcomes = new Map(spec.definingMoments.map((m) => [m.id, new Set(m.outcomes.map((o) => o.id))]))
  const acts = new Map(spec.definingMoments.map((m) => [m.id, new Set(m.acts.map((a) => a.id))]))
  const sources = new Set(spec.sources.map((s) => s.id))

  // --- duplicate-id: the detail set. Skeleton ids are checked by checkSkeleton; here we only
  // report at detail-item paths, against the union of both sets, so nothing is reported twice
  // and cross-group collisions are still caught. ----------------------------------------------
  const seen = new Set(skeletonIds(spec))
  spec.stages.forEach((s) => s.rooms.forEach((r) => seen.add(r.id)))
  spec.characters.forEach((c) => c.stances.forEach((s) => seen.add(s.id)))
  const anyId = new Set(seen)
  const collect = (id: string, path: string) => {
    if (seen.has(id)) add('duplicate-id', path, `id '${id}' is already in use`)
    else seen.add(id)
  }
  spec.characters.forEach((c, i) => c.slants.forEach((s, j) => collect(s.id, `characters.${i}.slants.${j}.id`)))
  spec.documents.forEach((d, i) => d.keyPassages.forEach((p, j) => collect(p.id, `documents.${i}.keyPassages.${j}.id`)))
  spec.triggers.forEach((t, i) => collect(t.id, `triggers.${i}.id`))
  spec.endings.forEach((e, i) => e.interview.verdicts.forEach((v, j) => collect(v.id, `endings.${i}.interview.verdicts.${j}.id`)))
  spec.storyEvents.forEach((e, i) => collect(e.id, `storyEvents.${i}.id`))
  spec.openQuestions.forEach((q, i) => collect(q.id, `openQuestions.${i}.id`))
  spec.hintAngles.forEach((h, i) => collect(h.id, `hintAngles.${i}.id`))
  spec.conflicts.forEach((c, i) => collect(c.id, `conflicts.${i}.id`))

  // --- condition refs -----------------------------------------------------------
  const condition = (value: Condition | undefined, at: string): void => {
    if (value === undefined) return
    if ('all' in value) return value.all.forEach((inner) => condition(inner, at))
    if ('any' in value) return value.any.forEach((inner) => condition(inner, at))
    if ('not' in value) return condition(value.not, at)
    if ('discovered' in value) return ref(discoveries.has(value.discovered), at, `discovery '${value.discovered}' does not exist`, [value.discovered])
    if ('stanceAtLeast' in value || 'stanceIs' in value) {
      const { characterId, stanceId } = 'stanceAtLeast' in value ? value.stanceAtLeast : value.stanceIs
      return ref(stances.get(characterId)?.has(stanceId) === true, at, `stance '${characterId}/${stanceId}' does not exist`, [characterId, stanceId])
    }
    if ('notePassed' in value) {
      ref(discoveries.has(value.notePassed.discoveryId), at, `discovery '${value.notePassed.discoveryId}' does not exist`, [value.notePassed.discoveryId])
      return ref(spec.characters.some((c) => c.id === value.notePassed.characterId), at, `character '${value.notePassed.characterId}' does not exist`, [value.notePassed.characterId])
    }
    if ('slantConfronted' in value) return ref(slants.has(value.slantConfronted), at, `slant '${value.slantConfronted}' does not exist`, [value.slantConfronted])
    if ('act' in value) return ref(acts.get(value.act.momentId)?.has(value.act.actId) === true, at, `act '${value.act.actId}' does not exist in moment '${value.act.momentId}'`, [value.act.actId, value.act.momentId])
    if ('outcome' in value)
      return ref(outcomes.get(value.outcome.momentId)?.has(value.outcome.outcomeId) === true, at, `outcome '${value.outcome.outcomeId}' does not exist in moment '${value.outcome.momentId}'`, [value.outcome.outcomeId, value.outcome.momentId])
    if ('inRoom' in value) return ref(rooms.has(value.inRoom), at, `room '${value.inRoom}' does not exist`, [value.inRoom])
  }

  const citations = (items: { sourceId: string }[] | undefined, at: string) => {
    for (const c of items ?? []) ref(sources.has(c.sourceId), at, `source '${c.sourceId}' does not exist`, [c.sourceId])
  }

  // --- timer --------------------------------------------------------------------
  if (spec.timer.stageMinutes.length !== spec.stages.length)
    add('timer-stages', 'timer.stageMinutes', `stageMinutes has ${spec.timer.stageMinutes.length} entries for ${spec.stages.length} stages`)

  // --- stage document placement + situations --------------------------------------
  spec.stages.forEach((stage, i) => {
    const at = `stages.${i}`
    const stageRooms = new Set(stage.rooms.map((r) => r.id))
    for (const [documentId, roomId] of Object.entries(stage.documentPlacement)) {
      ref(documents.has(documentId), `${at}.documentPlacement.${documentId}`, `placed document '${documentId}' does not exist`, [documentId])
      ref(roomId === 'held' || stageRooms.has(roomId), `${at}.documentPlacement.${documentId}`, `room '${roomId}' is not a room of stage '${stage.id}'`, [roomId, stage.id])
    }
    stage.situations.forEach((situation, j) => {
      ref(
        outcomes.get(situation.whenOutcome.momentId)?.has(situation.whenOutcome.outcomeId) === true,
        `${at}.situations.${j}.whenOutcome`,
        `outcome '${situation.whenOutcome.outcomeId}' does not exist in moment '${situation.whenOutcome.momentId}'`, [situation.whenOutcome.outcomeId, situation.whenOutcome.momentId],
      )
      for (const [characterId, stanceId] of Object.entries(situation.stances ?? {}))
        ref(stances.get(characterId)?.has(stanceId) === true, `${at}.situations.${j}.stances.${characterId}`, `stance '${characterId}/${stanceId}' does not exist`, [characterId, stanceId])
      for (const [characterId, roomId] of Object.entries(situation.placement ?? {})) {
        ref(spec.characters.some((c) => c.id === characterId), `${at}.situations.${j}.placement.${characterId}`, `placed character '${characterId}' does not exist`, [characterId])
        ref(stageRooms.has(roomId), `${at}.situations.${j}.placement.${characterId}`, `room '${roomId}' is not a room of stage '${stage.id}'`, [roomId, stage.id])
      }
      for (const [documentId, roomId] of Object.entries(situation.documentPlacement ?? {})) {
        ref(documents.has(documentId), `${at}.situations.${j}.documentPlacement.${documentId}`, `placed document '${documentId}' does not exist`, [documentId])
        ref(roomId === 'held' || stageRooms.has(roomId), `${at}.situations.${j}.documentPlacement.${documentId}`, `room '${roomId}' is not a room of stage '${stage.id}'`, [roomId, stage.id])
      }
    })
  })

  // --- characters -------------------------------------------------------------------
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
      for (const id of slant.contradictedBy) ref(discoveries.has(id), `${at}.slants.${j}.contradictedBy`, `discovery '${id}' does not exist`, [id])
      if (slant.unlocksDiscoveryId !== undefined) ref(discoveries.has(slant.unlocksDiscoveryId), `${at}.slants.${j}.unlocksDiscoveryId`, `discovery '${slant.unlocksDiscoveryId}' does not exist`, [slant.unlocksDiscoveryId])
    })
    character.persona.phrases.forEach((phrase, j) => citations(phrase.citations, `${at}.persona.phrases.${j}.citations`))
  })

  // --- discoveries: the document-held key passage and the condition ---------------------
  spec.discoveries.forEach((discovery, i) => {
    const at = `discoveries.${i}`
    if (!('characterId' in discovery.holder)) {
      const { documentId, keyPassageId } = discovery.holder
      const doc = spec.documents.find((d) => d.id === documentId)
      ref(doc?.keyPassages.some((p) => p.id === keyPassageId) === true, `${at}.holder`, `key passage '${keyPassageId}' does not exist in document '${documentId}'`, [keyPassageId, documentId])
    }
    condition(discovery.condition, `${at}.condition`)
  })

  // --- documents ---------------------------------------------------------------------
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

  // --- triggers ------------------------------------------------------------------------
  spec.triggers.forEach((trigger, i) => {
    const at = `triggers.${i}`
    ref(spec.characters.some((c) => c.id === trigger.characterId), `${at}.characterId`, `character '${trigger.characterId}' does not exist`, [trigger.characterId])
    if ('notePassed' in trigger.on) ref(discoveries.has(trigger.on.notePassed), `${at}.on`, `discovery '${trigger.on.notePassed}' does not exist`, [trigger.on.notePassed])
    if ('discovered' in trigger.on) ref(discoveries.has(trigger.on.discovered), `${at}.on`, `discovery '${trigger.on.discovered}' does not exist`, [trigger.on.discovered])
    if ('slantConfronted' in trigger.on) ref(slants.has(trigger.on.slantConfronted), `${at}.on`, `slant '${trigger.on.slantConfronted}' does not exist`, [trigger.on.slantConfronted])
    if ('toStance' in trigger.effect) ref(stances.get(trigger.characterId)?.has(trigger.effect.toStance) === true, `${at}.effect`, `stance '${trigger.characterId}/${trigger.effect.toStance}' does not exist`, [trigger.characterId, trigger.effect.toStance])
    for (const id of trigger.handsOver ?? []) ref(documents.has(id), `${at}.handsOver`, `document '${id}' does not exist`, [id])
    condition(trigger.requires, `${at}.requires`)
  })

  // --- defining moments: the detail half -------------------------------------------------
  spec.definingMoments.forEach((moment, i) => {
    const at = `definingMoments.${i}`
    moment.acts.forEach((act, j) => {
      if (!moment.rules.some((rule) => rule.actId === act.id && rule.when === undefined))
        add('fallback-rule', `${at}.acts.${j}.id`, `act '${act.id}' has no fallback rule (a rule without 'when')`)
      for (const unlock of act.secret?.unlock ?? []) condition(unlock, `${at}.acts.${j}.secret.unlock`)
    })
    moment.rules.forEach((rule, j) => condition(rule.when, `${at}.rules.${j}.when`))
  })

  // --- endings: interview counter-points ----------------------------------------------------
  spec.endings.forEach((ending, i) => {
    const at = `endings.${i}`
    ending.interview.verdicts.forEach((verdict, j) => {
      for (const id of verdict.counterPoints)
        ref(discoveries.has(id) || documents.has(id), `${at}.interview.verdicts.${j}.counterPoints`, `counter-point '${id}' is not a discovery or document`, [id])
    })
  })

  // --- story events ----------------------------------------------------------------------------
  spec.storyEvents.forEach((event, i) => {
    const at = `storyEvents.${i}`
    const stage = spec.stages.find((s) => s.id === event.stageId)
    ref(stage !== undefined, `${at}.stageId`, `stage '${event.stageId}' does not exist`, [event.stageId])
    if ('characterId' in event && event.characterId !== undefined) ref(spec.characters.some((c) => c.id === event.characterId), `${at}.characterId`, `character '${event.characterId}' does not exist`, [event.characterId])
    if (event.effect === 'move') {
      const roomOk = stage !== undefined && stage.rooms.some((r) => r.id === event.toRoomId)
      ref(roomOk, `${at}.toRoomId`, `room '${event.toRoomId}' is not a room of stage '${event.stageId}'`, [event.toRoomId, event.stageId])
    }
    if (event.effect === 'deliverDocument') ref(documents.has(event.documentId), `${at}.documentId`, `document '${event.documentId}' does not exist`, [event.documentId])
    if ('condition' in event.when) condition(event.when.condition, `${at}.when.condition`)
  })

  // --- open questions / hint angles ----------------------------------------------------------------
  const stages = new Set(spec.stages.map((s) => s.id))
  spec.openQuestions.forEach((question, i) => {
    const at = `openQuestions.${i}`
    ref(stages.has(question.stageId), `${at}.stageId`, `stage '${question.stageId}' does not exist`, [question.stageId])
    question.discoveryIds.forEach((id, j) => {
      const discovery = spec.discoveries.find((d) => d.id === id)
      ref(discovery !== undefined, `${at}.discoveryIds.${j}`, `discovery '${id}' does not exist`, [id])
      if (discovery !== undefined) ref(discovery.stageId === question.stageId, `${at}.discoveryIds.${j}`, `discovery '${id}' belongs to stage '${discovery.stageId}', not '${question.stageId}'`, [id, discovery.stageId, question.stageId])
    })
  })
  spec.hintAngles.forEach((hint, i) => ref(discoveries.has(hint.discoveryId), `hintAngles.${i}.discoveryId`, `discovery '${hint.discoveryId}' does not exist`, [hint.discoveryId]))

  // --- conflicts -------------------------------------------------------------------------------------
  spec.conflicts.forEach((conflict, i) => {
    const at = `conflicts.${i}`
    ref(sources.has(conflict.sourceId), `${at}.sourceId`, `source '${conflict.sourceId}' does not exist`, [conflict.sourceId])
    conflict.itemIds.forEach((id, j) => ref(anyId.has(id) || spec.characters.some((c) => c.id === id) || rooms.has(id), `${at}.itemIds.${j}`, `item '${id}' is not any id in the spec`, [id]))
  })

  return issues
}
