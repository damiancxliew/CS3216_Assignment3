/**
 * `checkSkeleton`: the rules that apply to a skeleton alone — and equally to a full
 * `AdventureSpec`, which is a valid `SkeletonShape` with identical paths. `checkSpec` runs
 * `checkSkeleton` plus the detail-only rules in `refs.ts`, `core.ts` and `labels.ts`.
 *
 * Skeleton codes: `ref`, `duplicate-id`, `core-missing`, `core-holder`, `core-holder-absent`,
 * `decider-absent`, `core-uncited`, `historical-uncited`, `room-count`, `outcome-count`,
 * `ending-mix`, `historical-outcome`, `rule-coverage`, `source-label`, `core-invented`,
 * plus everything in `endings.ts`. Warnings (guidance, never blocking): `stage-count`, `act-count`, `core-count`.
 */
import type { CheckResult, CheckIssue } from '../index.js'
import type { SkeletonShape } from '../skeleton.js'
import { endingIssues } from './endings.js'

/** The ids a skeleton defines. Exported so `checkSpec`'s detail rules can dedupe across both sets. */
export function skeletonIds(s: SkeletonShape): Set<string> {
  const ids = new Set<string>()
  for (const stage of s.stages) ids.add(stage.id)
  for (const character of s.characters) ids.add(character.id)
  for (const discovery of s.discoveries) ids.add(discovery.id)
  for (const document of s.documents) ids.add(document.id)
  for (const moment of s.definingMoments) {
    ids.add(moment.id)
    for (const act of moment.acts) ids.add(act.id)
    for (const outcome of moment.outcomes) ids.add(outcome.id)
  }
  for (const ending of s.endings) ids.add(ending.id)
  for (const source of s.sources) ids.add(source.id)
  return ids
}

export function checkSkeleton(spec: SkeletonShape): CheckResult {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })
  const ref = (ok: boolean, path: string, message: string, ids: string[]) => {
    if (!ok) issues.push({ code: 'ref', path, message, ids })
  }

  const stages = new Set(spec.stages.map((s) => s.id))
  const characters = new Set(spec.characters.map((c) => c.id))
  const documents = new Set(spec.documents.map((d) => d.id))
  const endings = new Set(spec.endings.map((e) => e.id))
  const moments = new Set(spec.definingMoments.map((m) => m.id))
  const sources = new Set(spec.sources.map((s) => s.id))
  const acts = new Map(spec.definingMoments.map((m) => [m.id, new Set(m.acts.map((a) => a.id))]))
  const outcomes = new Map(spec.definingMoments.map((m) => [m.id, new Set(m.outcomes.map((o) => o.id))]))

  // --- duplicate-id (skeleton set; rooms are per-stage) -----------------------
  {
    const seen = new Map<string, string>()
    const collect = (id: string, path: string) => {
      const first = seen.get(id)
      if (first === undefined) seen.set(id, path)
      else add('duplicate-id', path, `id '${id}' is also used at ${first}`)
    }
    spec.stages.forEach((s, i) => {
      collect(s.id, `stages.${i}.id`)
      const stageRooms = new Set<string>()
      s.rooms.forEach((room, j) => {
        if (stageRooms.has(room.id)) add('duplicate-id', `stages.${i}.rooms.${j}.id`, `room id '${room.id}' is used twice in stage '${s.id}'`)
        else stageRooms.add(room.id)
      })
    })
    spec.characters.forEach((c, i) => collect(c.id, `characters.${i}.id`))
    spec.discoveries.forEach((d, i) => collect(d.id, `discoveries.${i}.id`))
    spec.documents.forEach((d, i) => collect(d.id, `documents.${i}.id`))
    spec.definingMoments.forEach((m, i) => {
      collect(m.id, `definingMoments.${i}.id`)
      m.acts.forEach((a, j) => collect(a.id, `definingMoments.${i}.acts.${j}.id`))
      m.outcomes.forEach((o, j) => collect(o.id, `definingMoments.${i}.outcomes.${j}.id`))
    })
    spec.endings.forEach((e, i) => collect(e.id, `endings.${i}.id`))
    spec.sources.forEach((s, i) => collect(s.id, `sources.${i}.id`))
  }

  const warnings: CheckIssue[] = []
  const warn = (code: string, path: string, message: string) => warnings.push({ code, path, message })
  /** G13: a citation that grounds a core claim must quote its source; a bare source id proves nothing. */
  const quoted = (items: { sourceId: string; quote?: string | undefined }[] | undefined) => (items ?? []).some((c) => (c.quote ?? '').trim().length > 0)
  const citations = (items: { sourceId: string }[] | undefined, at: string) => {
    for (const c of items ?? []) ref(sources.has(c.sourceId), at, `source '${c.sourceId}' does not exist`, [c.sourceId])
  }

  // --- stages -----------------------------------------------------------------
  spec.stages.forEach((stage, i) => {
    const at = `stages.${i}`
    const stageRooms = new Set(stage.rooms.map((r) => r.id))
    if (!spec.discoveries.some((d) => d.stageId === stage.id && d.core))
      add('core-missing', `${at}.id`, `stage '${stage.id}' has no core discovery`)
    if (stage.rooms.length < 2 || stage.rooms.length > 5)
      add('room-count', `${at}.rooms`, `stage '${stage.id}' has ${stage.rooms.length} rooms (2–5 required)`)
    ref(stageRooms.has(stage.startRoomId), `${at}.startRoomId`, `start room '${stage.startRoomId}' is not a room of stage '${stage.id}'`, [stage.startRoomId, stage.id])
    const moment = spec.definingMoments.find((m) => m.id === stage.definingMomentId)
    ref(moment !== undefined, `${at}.definingMomentId`, `defining moment '${stage.definingMomentId}' does not exist`, [stage.definingMomentId])
    if (moment !== undefined) ref(moment.stageId === stage.id, `${at}.definingMomentId`, `moment '${moment.id}' has stageId '${moment.stageId}', not '${stage.id}'`, [moment.id, moment.stageId, stage.id])
    for (const [characterId, roomId] of Object.entries(stage.placement)) {
      ref(characters.has(characterId), `${at}.placement.${characterId}`, `placed character '${characterId}' does not exist`, [characterId])
      ref(stageRooms.has(roomId), `${at}.placement.${characterId}`, `room '${roomId}' is not a room of stage '${stage.id}'`, [roomId, stage.id])
    }
  })

  const momentRefs = new Map<string, number>()
  for (const stage of spec.stages) momentRefs.set(stage.definingMomentId, (momentRefs.get(stage.definingMomentId) ?? 0) + 1)
  spec.definingMoments.forEach((moment, i) => {
    const count = momentRefs.get(moment.id) ?? 0
    ref(count === 1, `definingMoments.${i}.id`, `moment '${moment.id}' is referenced by ${count} stages`, [moment.id])
  })

  // --- discoveries --------------------------------------------------------------
  const characterTier = new Map(spec.characters.map((c) => [c.id, c.tier]))
  const placementByStage = new Map(spec.stages.map((s) => [s.id, new Set(Object.keys(s.placement))]))
  spec.discoveries.forEach((discovery, i) => {
    const at = `discoveries.${i}`
    ref(stages.has(discovery.stageId), `${at}.stageId`, `stage '${discovery.stageId}' does not exist`, [discovery.stageId])
    const holder = discovery.holder
    if ('characterId' in holder) {
      ref(characters.has(holder.characterId), `${at}.holder`, `holder character '${holder.characterId}' does not exist`, [holder.characterId])
      if (discovery.core) {
        if (characterTier.get(holder.characterId) !== 'major')
          add('core-holder', `${at}.holder`, `core discovery '${discovery.id}' is held by a non-major character`)
        else if (placementByStage.get(discovery.stageId)?.has(holder.characterId) !== true)
          add('core-holder-absent', `${at}.holder`, `core discovery '${discovery.id}' is held by '${holder.characterId}', who is not placed in stage '${discovery.stageId}'`)
      }
    } else ref(documents.has(holder.documentId), `${at}.holder`, `holder document '${holder.documentId}' does not exist`, [holder.documentId])
    if (discovery.core && !quoted(discovery.citations))
      add('core-uncited', `${at}.citations`, `core discovery '${discovery.id}' has no citation with a quote (G13)`)
    if (discovery.sourceLabel.trim().length === 0) add('source-label', `${at}.sourceLabel`, `discovery '${discovery.id}' has an empty sourceLabel`)
    if (discovery.core && discovery.sourceLabel.trim().toLowerCase() === 'invented')
      add('core-invented', `${at}.sourceLabel`, `core discovery '${discovery.id}' is labelled 'invented'`)
    citations(discovery.citations, `${at}.citations`)
  })

  // --- defining moments -----------------------------------------------------------
  spec.definingMoments.forEach((moment, i) => {
    const at = `definingMoments.${i}`
    ref(characters.has(moment.deciderId), `${at}.deciderId`, `decider '${moment.deciderId}' does not exist`, [moment.deciderId])
    ref(stages.has(moment.stageId), `${at}.stageId`, `stage '${moment.stageId}' does not exist`, [moment.stageId])
    const decider = spec.characters.find((c) => c.id === moment.deciderId)
    if (decider !== undefined) {
      if (decider.tier !== 'major')
        add('decider-absent', `${at}.deciderId`, `decider '${moment.deciderId}' is not a major character`)
      else if (placementByStage.get(moment.stageId)?.has(moment.deciderId) !== true)
        add('decider-absent', `${at}.deciderId`, `decider '${moment.deciderId}' is not placed in stage '${moment.stageId}'`)
    }
    if (moment.outcomes.length < 3 || moment.outcomes.length > 4)
      add('outcome-count', `${at}.outcomes`, `moment '${moment.id}' has ${moment.outcomes.length} outcomes (3–4 required)`)
    if (moment.outcomes.filter((o) => o.historical === true).length !== 1)
      add('historical-outcome', `${at}.outcomes`, `moment '${moment.id}' must have exactly one historical outcome`)
    moment.acts.forEach((act, j) => {
      if (!moment.rules.some((rule) => rule.actId === act.id))
        add('rule-coverage', `${at}.acts.${j}.id`, `act '${act.id}' appears in no rule`)
    })
    moment.outcomes.forEach((outcome, j) => {
      if (!moment.rules.some((rule) => rule.outcomeId === outcome.id))
        add('rule-coverage', `${at}.outcomes.${j}.id`, `outcome '${outcome.id}' is targeted by no rule`)
      for (const id of outcome.closesEndingIds) ref(endings.has(id), `${at}.outcomes.${j}.closesEndingIds`, `ending '${id}' does not exist`, [id])
      if (outcome.endingId !== undefined) ref(endings.has(outcome.endingId), `${at}.outcomes.${j}.endingId`, `ending '${outcome.endingId}' does not exist`, [outcome.endingId])
    })
    moment.rules.forEach((rule, j) => {
      ref(acts.get(moment.id)?.has(rule.actId) === true, `${at}.rules.${j}.actId`, `act '${rule.actId}' does not exist in moment '${moment.id}'`, [rule.actId, moment.id])
      ref(outcomes.get(moment.id)?.has(rule.outcomeId) === true, `${at}.rules.${j}.outcomeId`, `outcome '${rule.outcomeId}' does not exist in moment '${moment.id}'`, [rule.outcomeId, moment.id])
    })
  })

  // --- endings ---------------------------------------------------------------------
  spec.endings.forEach((ending, i) => {
    const at = `endings.${i}`
    if (ending.type === 'historical' && !quoted(ending.citations))
      add('historical-uncited', `${at}.citations`, `historical ending '${ending.id}' has no citation with a quote (G13.4)`)
    if (ending.sourceLabel.trim().length === 0) add('source-label', `${at}.sourceLabel`, `ending '${ending.id}' has an empty sourceLabel`)
    citations(ending.citations, `${at}.citations`)
  })

  // ending-mix: the endings reachable from the final moment are exactly 1 historical,
  // 2–3 alternative and 0–1 secret.
  const finalMoment = spec.stages
    .map((s) => spec.definingMoments.find((m) => m.id === s.definingMomentId))
    .filter((m) => m !== undefined)
    .at(-1)
  if (finalMoment !== undefined) {
    const reachable = new Set<string>()
    const targeted = new Set(finalMoment.rules.map((r) => r.outcomeId))
    for (const outcome of finalMoment.outcomes)
      if (targeted.has(outcome.id) && outcome.endingId !== undefined) reachable.add(outcome.endingId)
    const counts = { historical: 0, alternative: 0, secret: 0 }
    for (const ending of spec.endings) if (reachable.has(ending.id)) counts[ending.type] += 1
    if (counts.historical !== 1 || counts.alternative < 2 || counts.alternative > 3 || counts.secret > 1)
      add(
        'ending-mix',
        'endings',
        `final moment reaches ${counts.historical} historical, ${counts.alternative} alternative and ${counts.secret} secret endings (need 1 / 2–3 / 0–1)`,
      )
  }

  // --- size guidance (warnings: they shape play, but don't make the spec unplayable) ----
  if (spec.stages.length > 3) warn('stage-count', 'stages', `${spec.stages.length} stages (at most 3 fit a 45-minute session, G2.2)`)
  spec.definingMoments.forEach((moment, i) => {
    const visible = moment.acts.filter((act) => !('secret' in act && act.secret !== undefined)).length
    if (visible < 2 || visible > 4) warn('act-count', `definingMoments.${i}.acts`, `moment '${moment.id}' offers ${visible} acts (2–4, P9.1)`)
  })
  spec.stages.forEach((stage, i) => {
    const core = spec.discoveries.filter((d) => d.stageId === stage.id && d.core).length
    if (core > 3) warn('core-count', `stages.${i}.id`, `stage '${stage.id}' has ${core} core discoveries (2–3, G17)`)
  })

  issues.push(...endingIssues(spec))
  return { errors: issues, warnings }
}
