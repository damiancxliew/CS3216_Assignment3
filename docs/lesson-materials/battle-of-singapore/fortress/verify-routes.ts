// Plays every route through the real engine with scripted character replies.
// Run: npx vite-node --config vitest.config.ts docs/lesson-materials/battle-of-singapore/fortress/verify-routes.ts
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { EngineSpec } from '../../../../packages/engine/src/index.ts'
import { Harness } from '../../../../packages/engine/tests/fixtures/harness.ts'

const folder = new URL('.', import.meta.url).pathname
const spec = EngineSpec.parse(JSON.parse(fs.readFileSync(folder + 'adventure.json', 'utf8')).spec)
const text = (id: string) => spec.discoveries.find(d => d.id === id)!.text

async function room(g: Harness, id: string) { if (g.state.playerRoomId !== id) await g.act({ type: 'enterRoom', roomId: id }) }
async function read(g: Harness, id: string) {
  const doc = spec.documents.find(d => d.id === id)!
  if (g.state.discovered.includes(doc.readingCheck!.discoveryId)) return
  await room(g, g.state.documentRooms[id]!)
  await g.act({ type: 'openDocument', documentId: id })
  const q = doc.readingCheck!.variants[g.state.readingChecks?.[id]?.variantIndex ?? 0]!
  await g.act({ type: 'submitReadingCheck', documentId: id, questionId: q.id, choiceId: q.correctOptionId, ...q.support[0]! })
  await g.act({ type: 'closeDocument', documentId: id })
  assert(g.state.discovered.includes(doc.readingCheck!.discoveryId), `reading ${id}`)
}
async function say(g: Harness, who: string, facts: string[]) {
  await room(g, g.state.characters[who]!.roomId!)
  g.replyText = facts.length ? facts.map(text).join(' ') : 'I cannot say yet.'
  await g.say(who, 'What can you tell me?', { conveyed: facts, substantive: true })
  for (const id of facts) assert(g.state.discovered.includes(id), `missing ${id}`)
}
/** The character tries to say something it should not be able to share yet. */
async function blocked(g: Harness, who: string, fact: string) {
  await room(g, g.state.characters[who]!.roomId!)
  g.replyText = text(fact)
  await g.say(who, 'Tell me everything.', { conveyed: [fact], substantive: true })
  assert(!g.state.discovered.includes(fact), `${who} must not be able to share ${fact} yet`)
}
async function show(g: Harness, who: string, note: string, conveyed: string[]) {
  await room(g, g.state.characters[who]!.roomId!)
  g.replyText = conveyed.length ? conveyed.map(text).join(' ') : 'I see.'
  await g.act({ type: 'insertNote', characterId: who, noteId: g.noteFor(note), text: 'What do you make of this?' })
  await g.check({ conveyed, substantive: true })
  for (const id of conveyed) assert(g.state.discovered.includes(id), `missing ${id} after showing ${note}`)
}

// Stage 1: what Sam says, and which of Percival's two reasons Sam has answered with a note.
// The raw Gemas report does not move him: he needs Singh's account. The line Sam picks never matters.
const briefings = ['a-report', 'a-ask'].flatMap(act => [
  { act, shown: [], outcome: 'o-plan-kept' },
  { act, shown: ['d-gemas'], outcome: 'o-plan-kept' },
  { act, shown: ['d-troops'], outcome: 'o-partly' },
  { act, shown: ['d-arjun-retreat'], outcome: 'o-partly' },
  { act, shown: ['d-troops', 'd-arjun-retreat'], outcome: 'o-convinced' },
  { act, shown: ['d-gemas', 'd-arjun-retreat', 'd-troops'], outcome: 'o-convinced' },
])
const answers = { 'a-no-way': 'e-no-way', 'a-counterattack': 'e-counterattack', 'a-hold-on': 'e-hold-on' } as const
const recalls = { 'o-plan-kept': 'd-recall-kept', 'o-partly': 'd-recall-partly', 'o-convinced': 'd-recall-convinced' } as const
const stances = ['percival-confident', 'percival-doubtful', 'percival-convinced']
const routes: object[] = []

for (const briefing of briefings) for (const [answer, ending] of Object.entries(answers)) for (const readFleetEarly of [false, true]) {
  const g = new Harness(spec)
  await g.start()
  await assert.rejects(() => g.act({ type: 'endStage' }), 'stage 1 cannot end before preparation')
  await assert.rejects(() => say(g, 'percival', []), 'Percival needs the report on his desk first')

  // The report on Percival's desk unlocks him; he states his two reasons.
  await read(g, 'doc-troops')
  await say(g, 'percival', ['d-percival-east', 'd-percival-numbers'])
  assert.equal(g.state.characters.percival!.stanceId, 'percival-confident')

  // Arjun explains the retreat only after being shown the Gemas note.
  await read(g, 'doc-gemas')
  await blocked(g, 'arjun', 'd-arjun-retreat')
  await show(g, 'arjun', 'd-gemas', ['d-arjun-retreat'])
  if (readFleetEarly) await read(g, 'doc-fleet')

  // Each note answers one of Percival's reasons and moves him one step.
  let step = 0
  for (const note of briefing.shown) {
    await show(g, 'percival', note, [])
    if (note !== 'd-gemas') step++
    assert.equal(g.state.characters.percival!.stanceId, stances[step], `after showing ${note}`)
  }
  if (briefing.outcome === 'o-convinced') assert.equal(g.state.moment?.status, 'choosing', 'the decision opens by itself once Percival is convinced')
  else { assert.equal(g.state.moment, null); await g.act({ type: 'endStage' }) }
  await g.act({ type: 'act', actId: briefing.act })
  assert.equal(g.state.moment!.outcomeId, briefing.outcome, `${briefing.act} with ${briefing.shown.join('+') || 'no notes'}`)
  await g.act({ type: 'predict', outcomeId: briefing.outcome })
  await g.act({ type: 'continue' })
  assert.equal(g.state.stageIndex, 1)
  assert.equal(g.state.stageOpening, spec.stages[1]!.situations.find(s => s.whenOutcome.outcomeId === briefing.outcome)!.openingNarration)

  // Stage 2: Percival hands out the job automatically and can be spoken to at once.
  await read(g, 'doc-battlebox')
  assert(g.state.transcript.some(m => m.text.includes('Is there any way to keep fighting?')), 'Percival gives the task automatically')
  await assert.rejects(() => g.act({ type: 'endStage' }), 'stage 2 cannot end before preparation')
  const recall = recalls[briefing.outcome as keyof typeof recalls]
  await say(g, 'percival', ['d-percival-situation', recall])
  for (const other of Object.values(recalls)) if (other !== recall) await blocked(g, 'percival', other)
  // Showing stage 1 evidence again must not move him (his stage 1 reactions are stage 1 only).
  await show(g, 'percival', 'd-troops', [])
  assert.equal(g.state.characters.percival!.stanceId, 'percival-convinced')

  // Way out 2: Singh hopes for help until shown the fleet note.
  await read(g, 'doc-fleet')
  await say(g, 'arjun', ['d-arjun-hope'])
  await blocked(g, 'arjun', 'd-no-help')
  await show(g, 'arjun', 'd-fleet', ['d-no-help'])
  // Way out 1: Bennett rejects a counterattack.
  await say(g, 'bennett', ['d-bennett'])
  await say(g, 'hamid', ['d-hamid-pasir'])
  // Way out 3: Mrs Ong explains the city only after seeing Goodman's diary.
  await blocked(g, 'ong', 'd-no-city')
  await show(g, 'ong', 'd-goodman', ['d-no-city'])
  for (const idea of ['a counterattack', 'holding on for help', 'fighting on in the city'])
    assert(g.state.transcript.some(m => m.text.startsWith(`Idea checked: ${idea}`)), `progress line for ${idea}`)
  assert.equal(g.state.moment?.status, 'choosing', 'the decision opens by itself once every idea is checked')
  await g.act({ type: 'act', actId: answer })
  await g.act({ type: 'predict', outcomeId: g.state.moment!.outcomeId! })
  assert.equal(g.state.phase, 'epilogue')
  assert.equal(g.state.endingId, ending)
  const end = spec.endings.find(e => e.id === ending)!
  assert(end.epilogue.includes('decided to surrender'), 'every ending reaches the historical surrender')
  await g.act({ type: 'continue' })
  await g.act({ type: 'interviewAnswer', verdictId: end.interview.verdicts[1]!.id, evidenceNoteIds: [g.noteFor('d-fleet'), g.noteFor('d-troops')], text: 'There was no fleet and the troops were exhausted.' })
  assert(g.state.interview.pushBack, 'interviewer pushes back')
  await g.act({ type: 'interviewAnswer', verdictId: end.interview.verdicts[1]!.id, evidenceNoteIds: [], text: 'Both sides matter.' })
  await g.act({ type: 'continue' })
  assert.equal(g.state.phase, 'reveal')
  routes.push({ briefing: `${briefing.act}${briefing.shown.length ? ' + ' + briefing.shown.join(' + ') : ''}`, stage1: briefing.outcome, answer, ending })
}
console.log(JSON.stringify({
  routes: routes.length,
  stage1: [...new Set(routes.map((r: any) => `${r.briefing} -> ${r.stage1}`))],
  endings: [...new Set(routes.map((r: any) => `${r.answer} -> ${r.ending}`))],
}, null, 2))
