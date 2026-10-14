/**
 * Reachability explorer: a depth-first search over what a student can do, run through the real `step`. It
 * tries investigation moves before deciding, so it reaches the deepest (most informed) defining moments
 * first, and stops as soon as every ending has a witness path.
 *
 * Moves are abstract and complete enough to reach every ending the rules allow:
 * - convey(character, discovery): walk to the character, talk, and have the check confirm one revealable discovery;
 * - select(document, keyPassage): pick up the document and select a key passage;
 * - pass(note, character): show a note to a character, when some trigger, slant or condition cares about that pair;
 * - decide(act, prediction): start the defining moment, choose an act, and predict.
 * Challenged claims are left out: they only ever lower stances, which never opens a path in these rules.
 *
 * States are memoised on the parts that decide what can happen next, and every visited view goes through
 * `leakIssues`, so a hidden field reaching the client fails the test on the path that exposed it.
 */
import { FakeLlmClient, createRng, type LlmRequest } from '@adventure/orchestration'
import type { Action, PlayerView } from '@adventure/play-contract'

import { createState, step, type Condition, type EngineSpec, type EngineState, type PostTurnAction } from '../../src'

type Move =
  | { kind: 'convey'; characterId: string; discoveryId: string }
  | { kind: 'select'; documentId: string; start: number; end: number }
  | { kind: 'pass'; discoveryId: string; characterId: string }
  | { kind: 'decide'; actId: string; outcomeId: string }

export interface ExploreResult {
  states: number
  endings: Map<string, Move[]>
  /** Open (non-closed) endings at the final defining moment, for every state that reached it. */
  openAtFinal: number[]
  leaks: string[]
  truncated: boolean
}

const NOW = Date.UTC(2026, 9, 14, 3, 0, 0)

function collectDiscovered(condition: Condition | undefined, out: Set<string>): void {
  if (condition === undefined) return
  if ('all' in condition) condition.all.forEach((inner) => collectDiscovered(inner, out))
  else if ('any' in condition) condition.any.forEach((inner) => collectDiscovered(inner, out))
  else if ('not' in condition) collectDiscovered(condition.not, out)
  else if ('discovered' in condition) out.add(condition.discovered)
  else if ('notePassed' in condition) out.add(condition.notePassed.discoveryId)
}

function allConditions(spec: EngineSpec): (Condition | undefined)[] {
  return [
    ...spec.discoveries.map((discovery) => discovery.condition),
    ...spec.triggers.map((trigger) => trigger.requires),
    ...spec.definingMoments.flatMap((moment) => [...moment.rules.map((rule) => rule.when), ...moment.acts.flatMap((act) => act.secret?.unlock ?? [])]),
  ]
}

/**
 * Discoveries some rule reacts to. Learning any other discovery changes nothing the rules can see, so the search
 * skips them (they are still covered by the leak check on every view, and by the scripted walkthrough).
 */
export function relevantDiscoveries(spec: EngineSpec): Set<string> {
  const ids = new Set<string>()
  for (const condition of allConditions(spec)) collectDiscovered(condition, ids)
  for (const trigger of spec.triggers) {
    if ('notePassed' in trigger.on) ids.add(trigger.on.notePassed)
    if ('discovered' in trigger.on) ids.add(trigger.on.discovered)
  }
  for (const character of spec.characters) for (const slant of character.slants) slant.contradictedBy.forEach((id) => ids.add(id))
  return ids
}

function collectNotePassed(condition: Condition | undefined, out: Set<string>): void {
  if (condition === undefined) return
  if ('all' in condition) condition.all.forEach((inner) => collectNotePassed(inner, out))
  else if ('any' in condition) condition.any.forEach((inner) => collectNotePassed(inner, out))
  else if ('not' in condition) collectNotePassed(condition.not, out)
  else if ('notePassed' in condition) out.add(`${condition.notePassed.discoveryId}>${condition.notePassed.characterId}`)
}

/** The (note, character) pairs worth passing: some rule reacts to them. */
function relevantPasses(spec: EngineSpec): Set<string> {
  const pairs = new Set<string>()
  for (const trigger of spec.triggers) if ('notePassed' in trigger.on) pairs.add(`${trigger.on.notePassed}>${trigger.characterId}`)
  for (const character of spec.characters) for (const slant of character.slants) for (const id of slant.contradictedBy) pairs.add(`${id}>${character.id}`)
  for (const condition of allConditions(spec)) collectNotePassed(condition, pairs)
  return pairs
}

function signature(state: EngineState, relevant: Set<string>): string {
  return JSON.stringify([
    state.phase,
    state.stageIndex,
    state.discovered.filter((id) => relevant.has(id)).sort(),
    Object.entries(state.characters).map(([id, character]) => `${id}:${character.stanceId}`).sort(),
    state.passedOn.map((passed) => `${passed.discoveryId}>${passed.characterId}`).sort(),
    [...state.confrontedSlants].sort(),
    state.outcomes,
    [...state.closedEndings].sort(),
    state.endingId,
  ])
}

class Driver {
  private conveyed: string[] = []
  readonly llm = new FakeLlmClient({ replies: [(request: LlmRequest) => this.respond(request)] })
  constructor(
    readonly spec: EngineSpec,
    private readonly onView: (view: PlayerView, state: EngineState) => void,
  ) {}

  private respond(request: LlmRequest): string {
    if (request.schemaName === 'v3_character_reply') return JSON.stringify({ reply: 'Hm.' })
    const conveyed = this.conveyed
    this.conveyed = []
    return JSON.stringify({ conveyed, assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: 'none', reason: null } })
  }

  async act(state: EngineState, action: Action | PostTurnAction): Promise<EngineState> {
    const result = await step({ spec: this.spec, state, action }, { llm: this.llm, now: NOW, rng: createRng('explore') })
    this.onView(result.view, result.state)
    return result.state
  }

  async checkAll(state: EngineState, conveyed: string[]): Promise<EngineState> {
    let next = state
    for (const pending of [...next.pendingChecks]) {
      next = await this.act(next, {
        type: 'postTurn',
        messageId: pending.messageId,
        result: { conveyed: pending.revealable.some((fact) => conveyed.includes(fact.id)) ? conveyed : [], assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: 'none', reason: null } },
      })
    }
    return next
  }

  async goTo(state: EngineState, roomId: string): Promise<EngineState> {
    return state.playerRoomId === roomId ? state : this.act(state, { type: 'enterRoom', roomId })
  }
}

function availableMoves(spec: EngineSpec, state: EngineState, passes: Set<string>, relevant: Set<string>): Move[] {
  const moves: Move[] = []
  const stage = spec.stages[state.stageIndex]
  if (stage === undefined) return moves
  for (const discovery of spec.discoveries) {
    if (state.discovered.includes(discovery.id) || !relevant.has(discovery.id)) continue
    if ('documentId' in discovery.holder) {
      const { documentId, keyPassageId } = discovery.holder
      const reachable = state.heldDocuments.includes(documentId) || state.documentRooms[documentId] !== undefined
      const passage = spec.documents.find((document) => document.id === documentId)?.keyPassages.find((candidate) => candidate.id === keyPassageId)
      if (reachable && passage !== undefined) moves.push({ kind: 'select', documentId, start: passage.start, end: passage.end })
    } else if (discovery.stageId === stage.id && state.characters[discovery.holder.characterId]?.roomId) {
      moves.push({ kind: 'convey', characterId: discovery.holder.characterId, discoveryId: discovery.id })
    }
  }
  for (const note of state.notes) {
    for (const character of spec.characters) {
      if (!state.characters[character.id]?.roomId) continue
      if (!passes.has(`${note.discoveryId}>${character.id}`)) continue
      if (state.passedOn.some((passed) => passed.discoveryId === note.discoveryId && passed.characterId === character.id)) continue
      moves.push({ kind: 'pass', discoveryId: note.discoveryId, characterId: character.id })
    }
  }
  const moment = spec.definingMoments.find((candidate) => candidate.id === stage.definingMomentId)
  for (const act of moment?.acts ?? []) moves.push({ kind: 'decide', actId: act.id, outcomeId: '' })
  return moves
}

/** Apply one move. Returns null when the move turned out not to be possible (e.g. a condition not met). */
async function apply(driver: Driver, spec: EngineSpec, state: EngineState, move: Move): Promise<EngineState | null> {
  try {
    if (move.kind === 'convey') {
      const roomId = state.characters[move.characterId]?.roomId as string
      let next = await driver.goTo(state, roomId)
      next = await driver.act(next, { type: 'message', characterId: move.characterId, text: 'Tell me about it.' })
      next = await driver.checkAll(next, [move.discoveryId])
      return next.discovered.includes(move.discoveryId) ? next : null
    }
    if (move.kind === 'select') {
      let next = state
      if (!next.heldDocuments.includes(move.documentId)) {
        next = await driver.goTo(next, next.documentRooms[move.documentId] as string)
        next = await driver.act(next, { type: 'openDocument', documentId: move.documentId })
      }
      const before = next.discovered.length
      next = await driver.act(next, { type: 'selectPassage', documentId: move.documentId, start: move.start, end: move.end })
      return next.discovered.length > before ? next : null
    }
    if (move.kind === 'pass') {
      let next = await driver.goTo(state, state.characters[move.characterId]?.roomId as string)
      const note = next.notes.find((candidate) => candidate.discoveryId === move.discoveryId)
      if (note === undefined) return null
      next = await driver.act(next, { type: 'insertNote', characterId: move.characterId, noteId: note.id })
      return driver.checkAll(next, [])
    }
    let next = await driver.act(state, { type: 'endStage' })
    if (!next.moment?.availableActIds.includes(move.actId)) return null
    next = await driver.act(next, { type: 'act', actId: move.actId })
    return next
  } catch (error) {
    if (error instanceof Error && error.name === 'EngineError') return null
    throw error
  }
}

export async function explore(
  spec: EngineSpec,
  leakIssues: (spec: EngineSpec, view: PlayerView, state: EngineState) => string[],
  limit = 5000,
): Promise<ExploreResult> {
  const leaks: string[] = []
  const driver = new Driver(spec, (view, state) => {
    for (const issue of leakIssues(spec, view, state)) if (leaks.length < 20) leaks.push(issue)
  })
  const passes = relevantPasses(spec)
  const relevant = relevantDiscoveries(spec)
  const finalMomentId = spec.stages.at(-1)?.definingMomentId
  const endings = new Map<string, Move[]>()
  const openAtFinal: number[] = []
  const seen = new Set<string>()

  let start = createState(spec, 'explore')
  start = await driver.act(start, { type: 'continue' })
  start = await driver.act(start, { type: 'continue' })
  const queue: { state: EngineState; path: Move[] }[] = [{ state: start, path: [] }]
  seen.add(signature(start, relevant))
  let truncated = false

  while (queue.length > 0) {
    if (seen.size >= limit) {
      truncated = true
      break
    }
    const { state, path } = queue.pop() as { state: EngineState; path: Move[] }
    const children: { state: EngineState; path: Move[] }[] = []
    for (const move of availableMoves(spec, state, passes, relevant)) {
      const afterMove = await apply(driver, spec, state, move)
      if (afterMove === null) continue
      // A decision fans out over every prediction option, then plays on into the next stage or the ending.
      const branches: { state: EngineState; move: Move }[] = []
      if (move.kind === 'decide') {
        const moment = spec.definingMoments.find((candidate) => candidate.id === afterMove.moment?.momentId)
        if (moment?.id === finalMomentId) {
          openAtFinal.push(spec.endings.filter((ending) => !afterMove.closedEndings.includes(ending.id) && ending.type !== 'secret').length)
        }
        const option = moment?.outcomes.find((outcome) => outcome.secret !== true && !afterMove.closedEndings.includes(outcome.endingId ?? ''))
        const predicted = await driver.act(afterMove, { type: 'predict', outcomeId: option?.id ?? '' })
        branches.push({ state: predicted, move: { ...move, outcomeId: predicted.outcomes[moment?.id ?? ''] ?? '' } })
      } else branches.push({ state: afterMove, move })

      for (const branch of branches) {
        let next = branch.state
        const nextPath = [...path, branch.move]
        if (next.phase === 'stage' && next.stageIntroPending) next = await driver.act(next, { type: 'continue' })
        if (next.phase === 'epilogue') {
          const endingId = next.endingId ?? 'none'
          if (!endings.has(endingId)) endings.set(endingId, nextPath)
          continue
        }
        const key = signature(next, relevant)
        if (seen.has(key)) continue
        seen.add(key)
        children.push({ state: next, path: nextPath })
      }
    }
    // Last pushed is explored first: keep the order of `availableMoves` (investigation before decisions).
    queue.push(...children.reverse())
    if (endings.size === spec.endings.length) break
  }
  return { states: seen.size, endings, openAtFinal, leaks, truncated }
}

/** Strings and keys that must never reach the client in the given state. */
export function leakIssues(spec: EngineSpec, view: PlayerView, state: EngineState): string[] {
  const json = JSON.stringify(view)
  const issues: string[] = []
  const forbid = (text: string, why: string) => {
    if (text.length >= 12 && json.includes(text)) issues.push(`${why}: ${text.slice(0, 60)}`)
  }
  for (const key of ['"keyPassages"', '"demeanour"', '"privateAgenda"', '"contradictedBy"', '"rules"', '"slants"']) {
    if (json.includes(key)) issues.push(`key ${key} in view`)
  }
  for (const character of spec.characters) {
    forbid(character.persona.privateAgenda, 'persona agenda')
    forbid(character.persona.knewThen, 'persona horizon')
    for (const withheld of character.persona.withholds) forbid(withheld, 'persona withholds')
    for (const stance of character.stances) forbid(stance.demeanour, 'stance demeanour')
    for (const slant of character.slants) forbid(slant.claim, 'slant claim')
  }
  const endgame = state.phase === 'interview' || state.phase === 'reveal'
  if (!endgame) {
    for (const discovery of spec.discoveries) {
      if (state.discovered.includes(discovery.id)) continue
      forbid(discovery.text, 'undiscovered text')
      forbid(discovery.note, 'undiscovered note')
    }
  }
  for (const moment of spec.definingMoments) {
    const resolved = state.outcomes[moment.id] !== undefined
    for (const outcome of moment.outcomes) {
      if (!resolved) forbid(outcome.summary, 'unresolved outcome')
      if (outcome.secret && state.endingId !== outcome.endingId) forbid(outcome.predictionText, 'secret prediction')
    }
    for (const act of moment.acts) {
      const offered = state.moment?.momentId === moment.id && state.moment.availableActIds.includes(act.id)
      const chosen = state.acts[moment.id] === act.id
      if (act.secret !== undefined && !offered && !chosen && !endgame) forbid(act.text, 'locked secret act')
    }
  }
  for (const ending of spec.endings) if (ending.id !== state.endingId) forbid(ending.epilogue, 'unreached epilogue')
  return issues
}

/**
 * The fewest non-secret endings left open at the final defining moment, over every combination of earlier
 * outcomes (P9.10). Static: only earlier outcomes close endings, so no search is needed.
 */
export function minOpenAtFinal(spec: EngineSpec): number {
  const finalId = spec.stages.at(-1)?.definingMomentId
  const earlier = spec.definingMoments.filter((moment) => moment.id !== finalId)
  let combos: string[][] = [[]]
  for (const moment of earlier) combos = combos.flatMap((closed) => moment.outcomes.map((outcome) => [...closed, ...outcome.closesEndingIds]))
  return Math.min(...combos.map((closed) => spec.endings.filter((ending) => ending.type !== 'secret' && !closed.includes(ending.id)).length))
}
