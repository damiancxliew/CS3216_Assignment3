/**
 * Every id a spec refers to must exist. A small stand-in for the reference part of Yi Hao's `checkSpec`, so the
 * engine's fixtures are checked before `spec-v3` lands.
 */
import type { Condition, EngineSpec } from '../../src'

export function referenceIssues(spec: EngineSpec): string[] {
  const issues: string[] = []
  const ids = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id))
  const characters = ids(spec.characters)
  const discoveries = ids(spec.discoveries)
  const documents = ids(spec.documents)
  const endings = ids(spec.endings)
  const moments = ids(spec.definingMoments)
  const stages = ids(spec.stages)
  const slants = new Set(spec.characters.flatMap((character) => character.slants.map((slant) => slant.id)))
  const stances = new Map(spec.characters.map((character) => [character.id, new Set(character.stances.map((stance) => stance.id))]))
  const outcomes = new Map(spec.definingMoments.map((moment) => [moment.id, new Set(moment.outcomes.map((outcome) => outcome.id))]))
  const acts = new Map(spec.definingMoments.map((moment) => [moment.id, new Set(moment.acts.map((act) => act.id))]))
  const rooms = new Set(spec.stages.flatMap((stage) => stage.rooms.map((room) => room.id)))
  const need = (ok: boolean, what: string) => {
    if (!ok) issues.push(what)
  }
  const condition = (value: Condition | undefined, at: string): void => {
    if (value === undefined) return
    if ('all' in value) return value.all.forEach((inner) => condition(inner, at))
    if ('any' in value) return value.any.forEach((inner) => condition(inner, at))
    if ('not' in value) return condition(value.not, at)
    if ('discovered' in value) return need(discoveries.has(value.discovered), `${at}: discovery ${value.discovered}`)
    if ('stanceAtLeast' in value || 'stanceIs' in value) {
      const { characterId, stanceId } = 'stanceAtLeast' in value ? value.stanceAtLeast : value.stanceIs
      return need(stances.get(characterId)?.has(stanceId) === true, `${at}: stance ${characterId}/${stanceId}`)
    }
    if ('notePassed' in value) {
      need(discoveries.has(value.notePassed.discoveryId), `${at}: discovery ${value.notePassed.discoveryId}`)
      return need(characters.has(value.notePassed.characterId), `${at}: character ${value.notePassed.characterId}`)
    }
    if ('slantConfronted' in value) return need(slants.has(value.slantConfronted), `${at}: slant ${value.slantConfronted}`)
    if ('act' in value) return need(acts.get(value.act.momentId)?.has(value.act.actId) === true, `${at}: act ${value.act.actId}`)
    if ('outcome' in value) return need(outcomes.get(value.outcome.momentId)?.has(value.outcome.outcomeId) === true, `${at}: outcome ${value.outcome.outcomeId}`)
    if ('inRoom' in value) return need(rooms.has(value.inRoom), `${at}: room ${value.inRoom}`)
  }

  for (const stage of spec.stages) {
    const stageRooms = new Set(stage.rooms.map((room) => room.id))
    need(stageRooms.has(stage.startRoomId), `${stage.id}: start room`)
    need(moments.has(stage.definingMomentId), `${stage.id}: defining moment`)
    for (const [characterId, roomId] of Object.entries(stage.placement)) {
      need(characters.has(characterId), `${stage.id}: placed character ${characterId}`)
      need(stageRooms.has(roomId), `${stage.id}: room ${roomId}`)
    }
    for (const [documentId, roomId] of Object.entries(stage.documentPlacement)) {
      need(documents.has(documentId), `${stage.id}: placed document ${documentId}`)
      need(roomId === 'held' || stageRooms.has(roomId), `${stage.id}: room ${roomId}`)
    }
    for (const situation of stage.situations) {
      need(outcomes.get(situation.whenOutcome.momentId)?.has(situation.whenOutcome.outcomeId) === true, `${stage.id}: situation outcome`)
      for (const [characterId, stanceId] of Object.entries(situation.stances ?? {})) need(stances.get(characterId)?.has(stanceId) === true, `${stage.id}: situation stance ${stanceId}`)
    }
  }
  for (const character of spec.characters) {
    if (character.tier === 'major') {
      need(character.stances.length >= 3 && character.stances.length <= 5, `${character.id}: 3–5 stances`)
      need(character.initialStanceId !== null && stances.get(character.id)?.has(character.initialStanceId) === true, `${character.id}: initial stance`)
      need(character.stances.slice(0, -1).every((stance) => stance.hidden !== true), `${character.id}: only the top stance may be hidden`)
    } else need(character.stances.length === 0, `${character.id}: minor characters have no stances`)
    for (const slant of character.slants) {
      for (const id of slant.contradictedBy) need(discoveries.has(id), `${slant.id}: contradicting discovery ${id}`)
      if (slant.unlocksDiscoveryId !== undefined) need(discoveries.has(slant.unlocksDiscoveryId), `${slant.id}: unlocked discovery`)
    }
  }
  for (const discovery of spec.discoveries) {
    need(stages.has(discovery.stageId), `${discovery.id}: stage`)
    if ('characterId' in discovery.holder) need(characters.has(discovery.holder.characterId), `${discovery.id}: holder`)
    else {
      const { documentId, keyPassageId } = discovery.holder
      need(spec.documents.find((document) => document.id === documentId)?.keyPassages.some((passage) => passage.id === keyPassageId) === true, `${discovery.id}: key passage`)
    }
    condition(discovery.condition, discovery.id)
  }
  for (const document of spec.documents) {
    for (const passage of document.keyPassages) {
      need(passage.start < passage.end && passage.end <= document.body.length, `${document.id}/${passage.id}: offsets`)
      need(spec.discoveries.some((discovery) => 'keyPassageId' in discovery.holder && discovery.holder.keyPassageId === passage.id), `${passage.id}: links to a discovery`)
    }
  }
  for (const trigger of spec.triggers) {
    need(characters.has(trigger.characterId), `${trigger.id}: character`)
    if ('notePassed' in trigger.on) need(discoveries.has(trigger.on.notePassed), `${trigger.id}: note`)
    if ('discovered' in trigger.on) need(discoveries.has(trigger.on.discovered), `${trigger.id}: discovery`)
    if ('slantConfronted' in trigger.on) need(slants.has(trigger.on.slantConfronted), `${trigger.id}: slant`)
    if ('toStance' in trigger.effect) need(stances.get(trigger.characterId)?.has(trigger.effect.toStance) === true, `${trigger.id}: stance`)
    for (const id of trigger.handsOver ?? []) need(documents.has(id), `${trigger.id}: document ${id}`)
    condition(trigger.requires, trigger.id)
  }
  for (const moment of spec.definingMoments) {
    need(characters.has(moment.deciderId), `${moment.id}: decider`)
    need(stages.has(moment.stageId), `${moment.id}: stage`)
    for (const act of moment.acts) {
      need(moment.rules.some((rule) => rule.actId === act.id && rule.when === undefined), `${act.id}: fallback rule`)
      for (const unlock of act.secret?.unlock ?? []) condition(unlock, act.id)
    }
    for (const rule of moment.rules) {
      need(acts.get(moment.id)?.has(rule.actId) === true, `${moment.id}: rule act ${rule.actId}`)
      need(outcomes.get(moment.id)?.has(rule.outcomeId) === true, `${moment.id}: rule outcome ${rule.outcomeId}`)
      condition(rule.when, `${moment.id}/${rule.actId}`)
    }
    for (const outcome of moment.outcomes) {
      for (const id of outcome.closesEndingIds) need(endings.has(id), `${outcome.id}: closes ${id}`)
      if (outcome.endingId !== undefined) need(endings.has(outcome.endingId), `${outcome.id}: ending`)
    }
  }
  for (const ending of spec.endings) {
    for (const verdict of ending.interview.verdicts) for (const id of verdict.counterPoints) need(discoveries.has(id) || documents.has(id), `${ending.id}/${verdict.id}: counter-point ${id}`)
  }
  return issues
}
