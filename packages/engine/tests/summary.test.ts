import { ClassSummary, type GameEvent } from '@adventure/play-contract'
import { describe, expect, it } from 'vitest'

import { summarise } from '../src'
import { Harness } from './fixtures/harness'
import { mini } from './fixtures/mini'

/** Play mini to the reveal along one path, recording the events. */
async function play(path: { frank: boolean; verdicts: [string, string]; text?: string; abusive?: boolean; hint?: boolean }): Promise<GameEvent[]> {
  const game = new Harness(mini)
  await game.start()
  await game.say('a', 'What do you want?', { conveyed: ['d-a1'], ...(path.abusive ? { flagged: 'abusive' as const } : {}) })
  if (path.hint) game.events.push({ type: 'hint', at: 0, stageIndex: 0, level: 1, targetDiscoveryId: 'd-a2' }, { type: 'hint', at: 1, stageIndex: 0, level: 2, targetDiscoveryId: 'd-a2' })
  await game.act({ type: 'endStage' })
  await game.act({ type: 'act', actId: path.frank ? 'frank' : 'warn' })
  await game.act({ type: 'predict', outcomeId: 'o-agree' })
  await game.act({ type: 'continue' })
  await game.act({ type: 'endStage' })
  await game.act({ type: 'act', actId: path.frank ? 'recognise' : 'wait' })
  await game.act({ type: 'predict', outcomeId: path.frank ? 'o-hist' : 'o-alt1' })
  await game.act({ type: 'continue' })
  await game.act({ type: 'interviewAnswer', verdictId: path.verdicts[0], evidenceNoteIds: [game.noteFor('d-a1')] })
  await game.act({ type: 'interviewAnswer', verdictId: path.verdicts[1], evidenceNoteIds: [], ...(path.text ? { text: path.text } : {}) })
  await game.act({ type: 'continue' })
  return game.events
}

describe('summarise', () => {
  it('is empty but valid for a class with no attempts', () => {
    const summary = ClassSummary.parse(summarise(mini, []))
    expect(summary).toMatchObject({ adventureId: 'mini', attempts: 0, completed: 0, stuck: [], answers: [], flags: [] })
    expect(summary.endings.every((ending) => ending.count === 0)).toBe(true)
    expect(summary.discoveries.flatMap((holder) => holder.items).every((item) => item.found === 0)).toBe(true)
  })

  it('totals a class: predictions, verdicts and changes, evidence, discoveries, endings, stuck, flags', async () => {
    const attempts = [
      { attemptId: 'a1', events: await play({ frank: true, verdicts: ['yes', 'partly'], text: 'Only the rulers were asked.', hint: true }) },
      { attemptId: 'a2', events: await play({ frank: true, verdicts: ['no', 'no'], abusive: true }) },
      { attemptId: 'a3', events: await play({ frank: false, verdicts: ['partly', 'partly'], text: 'Hard to say.', hint: true }) },
      { attemptId: 'a4', events: [] },
    ]
    const summary = ClassSummary.parse(summarise(mini, attempts))
    expect(summary.attempts).toBe(4)
    expect(summary.completed).toBe(3)
    expect(summary.predictions[0]?.options.find((option) => option.outcomeId === 'o-agree')?.count).toBe(3)
    expect(summary.predictions[1]?.options.map((option) => option.outcomeId)).not.toContain('o-secret')
    expect(summary.endings.find((ending) => ending.endingId === 'e-hist')?.count).toBe(2)
    expect(summary.endings.find((ending) => ending.endingId === 'e-alt1')?.count).toBe(1)
    const hist = summary.verdicts.find((verdict) => verdict.endingId === 'e-hist')
    expect(hist?.options.find((option) => option.verdictId === 'yes')).toMatchObject({ initial: 1, final: 0 })
    expect(hist?.options.find((option) => option.verdictId === 'partly')).toMatchObject({ initial: 0, final: 1 })
    expect(hist?.changedAfterPushBack).toBe(1)
    expect(hist?.evidence).toEqual([{ discoveryId: 'd-a1', label: 'A wants a share.', count: 2 }])
    const aItems = summary.discoveries.find((holder) => holder.holderId === 'a')?.items
    expect(aItems?.find((item) => item.discoveryId === 'd-a1')?.found).toBe(3)
    expect(aItems?.find((item) => item.discoveryId === 'd-a2')?.found).toBe(0)
    expect(summary.stuck).toEqual([{ stageIndex: 0, targetDiscoveryId: 'd-a2', label: 'A fears Riau.', count: 2 }])
    expect(summary.flags).toEqual([{ attemptId: 'a2', count: 1 }])
  })

  it('keeps answers anonymous and the selection stable', async () => {
    const attempts = [
      { attemptId: 'secret-attempt-1', events: await play({ frank: true, verdicts: ['yes', 'no'], text: 'They were not asked.' }) },
      { attemptId: 'secret-attempt-2', events: await play({ frank: true, verdicts: ['no', 'no'], text: 'Not fair at all.' }) },
    ]
    const first = summarise(mini, attempts)
    expect(JSON.stringify(first.answers)).not.toContain('secret-attempt')
    expect(first.answers.map((answer) => answer.text).sort()).toEqual(['Not fair at all.', 'They were not asked.'])
    expect(summarise(mini, attempts).answers).toEqual(first.answers)
  })

  it('keeps first reading attempts separate from later recovery and counts each attempt once', () => {
    const spec = structuredClone(mini)
    const question = { id: 'q1', prompt: 'What does this support?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correctOptionId: 'a', support: [{ start: 0, end: 1 }], explanation: 'A source-grounded claim.' }
    spec.documents[0]!.readingCheck = { discoveryId: 'd-letter', variants: [question, { ...question, id: 'q2' }, { ...question, id: 'q3' }, { ...question, id: 'q4' }], recovery: { ...question, id: 'correction' }, recoveryDiscoveryIds: [] }
    const event = (correct: boolean, recovery = false): GameEvent => ({ type: 'readingCheck', at: 0, stageIndex: 0, documentId: 'letter', questionId: recovery ? 'correction' : 'q1', correct, recovery })
    const summary = ClassSummary.parse(summarise(spec, [
      { attemptId: 'first', events: [event(true), event(true)] },
      { attemptId: 'corrected', events: [event(false), event(true, true), event(true), event(true)] },
      { attemptId: 'reviewing', events: [event(false), event(true, true)] },
      { attemptId: 'alternate', events: [event(false), event(false), event(true)] },
      { attemptId: 'unopened', events: [] },
    ]))
    expect(summary.readingChecks).toEqual([{ documentId: 'letter', title: 'A letter', attempted: 4, firstAttemptCorrect: 1, completed: 3, recovered: 2 }])
    expect(summarise(mini, [])).not.toHaveProperty('readingChecks')
  })
})
