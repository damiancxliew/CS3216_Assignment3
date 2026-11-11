// Plays every route through the real engine with scripted character replies.
// Run: npx vite-node --config vitest.config.ts docs/lesson-materials/battle-of-singapore/fortress/verify-routes.ts
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { EngineSpec } from '../../../../packages/engine/src/index.ts'
import { Harness } from '../../../../packages/engine/tests/fixtures/harness.ts'

const folder = new URL('.', import.meta.url).pathname
const spec = EngineSpec.parse(JSON.parse(fs.readFileSync(folder + 'adventure.json', 'utf8')).spec)
const text = (id: string) => spec.discoveries.find(d => d.id === id)!.text
const eventText = (id: string) => spec.storyEvents.find(e => e.id === id)!.text

async function room(g: Harness, id: string) { if (g.state.playerRoomId !== id) await g.act({ type: 'enterRoom', roomId: id }) }
async function read(g: Harness, id: string) {
  const doc = spec.documents.find(d => d.id === id)!
  if (g.state.discovered.includes(doc.readingCheck!.discoveryId)) return
  if (!g.state.heldDocuments.includes(id)) await room(g, g.state.documentRooms[id]!)
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
  for (const id of facts) assert(g.state.discovered.includes(id), `${who} should share ${id}`)
}
/** The character tries to say something it should not be able to share now. */
async function blocked(g: Harness, who: string, fact: string) {
  await room(g, g.state.characters[who]!.roomId!)
  g.replyText = text(fact)
  await g.say(who, 'Tell me everything.', { conveyed: [fact], substantive: true })
  assert(!g.state.discovered.includes(fact), `${who} must not be able to share ${fact} now`)
}
async function show(g: Harness, who: string, note: string, conveyed: string[] = []) {
  await room(g, g.state.characters[who]!.roomId!)
  g.replyText = conveyed.length ? conveyed.map(text).join(' ') : 'I see.'
  await g.act({ type: 'insertNote', characterId: who, noteId: g.noteFor(note), text: 'What do you make of this?' })
  await g.check({ conveyed, substantive: true })
  for (const id of conveyed) assert(g.state.discovered.includes(id), `missing ${id} after showing ${note}`)
}
const offered = (g: Harness) => g.state.moment?.availableActIds ?? []
const fired = (g: Harness, id: string) => g.state.firedStoryEvents.includes(id)
const said = (g: Harness, id: string) => g.state.transcript.some(m => m.text === eventText(id))
const stance = (g: Harness, who: string) => g.state.characters[who]!.stanceId
const percivalStances = ['percival-confident', 'percival-doubtful', 'percival-convinced']
// At most one story beat per player action; "way out checked" ticks do not count.
const ticks = new Set(['ev-s2-counterattack', 'ev-s2-help', 'ev-s2-city'])
function harness() {
  const g = new Harness(spec)
  const act = g.act.bind(g)
  g.act = async (action: Parameters<Harness['act']>[0]) => {
    const before = g.state.firedStoryEvents.length
    const view = await act(action)
    const fresh = g.state.firedStoryEvents.slice(before).filter(id => !ticks.has(id))
    assert(fresh.length <= 1, `story beats bunched on one action: ${fresh.join(', ')}`)
    return view
  }
  return g
}

// ---------- stage 1: two reasons, two routes each; the city; and the advice ----------
type Men = 'none' | 'd-troops' | 'd-arjun-tired' | 'both'
type East = 'none' | 'd-gemas' | 'd-arjun-retreat' | 'both'
type Ong = 'none' | 'converted' | 'shown'
type S1 = { men: Men; east: East; ong: Ong; via: 'd-fleet' | 'd-fortress' | 'd-troops'; act: string; outcome: string; step: number; secret: boolean; arjunFirst: boolean }
const notesFor = (men: Men, east: East) => [
  ...(men === 'both' ? ['d-troops', 'd-arjun-tired'] : men === 'none' ? [] : [men]),
  ...(east === 'both' ? ['d-gemas', 'd-arjun-retreat'] : east === 'none' ? [] : [east]),
]
function expectedS1(act: string, step: number): string {
  if (act === 'a-keep-east') return 'o-plan-kept'
  if (act === 'a-move-nw') return step < 2 ? 'o-refused' : 'o-convinced'
  if (act === 'a-check-nw') return step < 1 ? 'o-refused' : 'o-check'
  return 'o-convinced'
}
const s1Cases: S1[] = []
const vias = ['d-fleet', 'd-fortress', 'd-troops'] as const
let k = 0
for (const men of ['none', 'd-troops', 'd-arjun-tired', 'both'] as Men[]) for (const east of ['none', 'd-gemas', 'd-arjun-retreat', 'both'] as East[]) for (const ong of ['none', 'converted', 'shown'] as Ong[]) {
  const step = (men === 'none' ? 0 : 1) + (east === 'none' ? 0 : 1)
  const secret = step === 2 && ong === 'shown'
  for (const act of ['a-keep-east', 'a-move-nw', 'a-check-nw', ...(secret ? ['a-side-by-side'] : [])]) {
    s1Cases.push({ men, east, ong, via: vias[k % 3]!, act, outcome: expectedS1(act, step), step, secret, arjunFirst: k % 2 === 0 })
    k++
  }
}

async function playStage1(g: Harness, c: S1) {
  await g.start()
  await assert.rejects(() => g.act({ type: 'endStage' }), 'stage 1 cannot end before preparation')
  await assert.rejects(() => say(g, 'percival', []), 'Percival wants one piece of evidence first')
  const notes = notesFor(c.men, c.east)

  // Singh is open from the start: his first-contact fact is the people route to the first reason.
  if (c.arjunFirst) await say(g, 'arjun', ['d-arjun-tired'])

  // Reads: whatever the route needs, padded to the two the decision needs, in varying order.
  const reads = new Set<string>()
  if (notes.includes('d-troops') || c.via === 'd-troops' && c.ong !== 'none') reads.add('doc-troops')
  if (notes.includes('d-gemas') || notes.includes('d-arjun-retreat')) reads.add('doc-gemas')
  if (c.ong !== 'none' && c.via !== 'd-troops') reads.add(c.via === 'd-fleet' ? 'doc-fleet' : 'doc-voices')
  for (const filler of ['doc-notice', 'doc-voices']) if (reads.size < 2) reads.add(filler)
  const ordered = c.arjunFirst ? [...reads].reverse() : [...reads]
  await read(g, ordered[0]!)
  const fleetBefore = g.state.discovered.includes('d-fleet')
  await say(g, 'percival', ['d-percival-plan'])
  assert.equal(stance(g, 'percival'), 'percival-confident')
  // The runner brings the fleet signal once Percival has laid out his reasons, unless Sam already has it.
  assert.equal(fired(g, 'ev-s1-runner'), !fleetBefore, 'runner fires on hearing the plan, only if the fleet signal is unread')
  if (!fleetBefore) assert(g.state.heldDocuments.includes('doc-fleet'))
  assert(!fired(g, 'ev-s1-siren'), 'no siren before the first crack in the plan')
  for (const id of ordered.slice(1)) await read(g, id)
  assert.equal(g.state.moment, null)

  if (!c.arjunFirst && notes.includes('d-arjun-tired')) await say(g, 'arjun', ['d-arjun-tired'])
  if (notes.includes('d-arjun-retreat')) {
    await blocked(g, 'arjun', 'd-arjun-retreat')
    await show(g, 'arjun', 'd-gemas', ['d-arjun-retreat'])
    assert.equal(stance(g, 'arjun'), 'arjun-open')
  }

  // The fortress belief: Mrs Ong trusts the notice until shown a note that tests it.
  if (c.ong !== 'none') {
    await say(g, 'ong', ['d-ong-raids'])
    await blocked(g, 'ong', 'd-ong-warning')
    await show(g, 'ong', c.via)
    assert(g.state.discovered.includes('d-ong-warning'), `confronting the notice with ${c.via} unlocks Mrs Ong's note`)
    assert(said(g, 'ev-s1-notice'), 'Mrs Ong points Sam back to the General')
  }

  // Each reason moves Percival once, whichever route answered it; a second answer to the same reason adds nothing.
  let step = 0
  const answered = new Set<string>()
  for (const note of notes) {
    await show(g, 'percival', note)
    const reason = note === 'd-troops' || note === 'd-arjun-tired' ? 'men' : 'east'
    if (!answered.has(reason)) { answered.add(reason); step++ }
    assert.equal(stance(g, 'percival'), percivalStances[step], `after showing ${note}`)
  }
  assert.equal(step, c.step)
  assert.equal(said(g, 'ev-s1-heard'), step === 2, 'Percival says he has heard enough only when both reasons are answered')
  assert(!fired(g, 'ev-s1-siren'), 'no siren while Sam is still with Percival')
  if (step >= 1 && c.ong === 'none') {
    await room(g, 'dossier-1')
    assert(said(g, 'ev-s1-siren'), 'the siren lands as Sam leaves Percival after the first crack in the plan')
  }
  await room(g, 'command-room')
  assert.equal(fired(g, 'ev-s1-summons'), c.ong !== 'none', 'summons once Sam leaves Mrs Ong with her warning')
  if (c.ong === 'shown') {
    const before = stance(g, 'percival')
    await show(g, 'percival', 'd-ong-warning')
    assert.equal(stance(g, 'percival'), before, 'the city note is breadth, not a third reason')
  }
  if (step === 2 && c.ong === 'shown') assert.equal(g.state.moment?.status, 'choosing', 'the decision opens by itself when there is nothing left to bring')
  else { assert.equal(g.state.moment, null, 'the decision waits for the player'); await g.act({ type: 'endStage' }) }
  assert.equal(offered(g).includes('a-side-by-side'), c.secret, `secret act offered = ${c.secret}`)
  for (const act of ['a-keep-east', 'a-move-nw', 'a-check-nw']) assert(offered(g).includes(act), `${act} always offered`)
  await g.act({ type: 'act', actId: c.act })
  assert.equal(g.state.moment!.outcomeId, c.outcome, `${c.act} with ${notes.join('+') || 'no notes'}`)
  await g.act({ type: 'predict', outcomeId: c.outcome })
  assert.equal(g.state.stageIndex, 1)
  assert.equal(g.state.stageOpening, spec.stages[1]!.situations.find(s => s.whenOutcome.outcomeId === c.outcome)!.openingNarration)
  await g.act({ type: 'continue' })
}

// ---------- stage 2: what stage 1 conduct changes ----------
const s2Answers = { 'a-no-way': 'e-no-way', 'a-counterattack': 'e-counterattack', 'a-civilians': 'e-civilians', 'a-both-truths': 'e-both' } as const
type Answer = keyof typeof s2Answers
const allRecalls = ['d-recall-kept', 'd-recall-ignored', 'd-recall-refused', 'd-recall-partly', 'd-recall-convinced', 'd-recall-trusted']
function recallFor(c: S1, notes: string[]) {
  if (c.act === 'a-side-by-side') return 'd-recall-trusted'
  if (c.outcome === 'o-plan-kept') return notes.includes('d-gemas') || notes.includes('d-arjun-retreat') ? 'd-recall-ignored' : 'd-recall-kept'
  return ({ 'o-refused': 'd-recall-refused', 'o-check': 'd-recall-partly', 'o-convinced': 'd-recall-convinced' } as Record<string, string>)[c.outcome]!
}
const startStance: Record<string, string> = { 'o-plan-kept': 'percival-confident', 'o-refused': 'percival-doubtful', 'o-check': 'percival-doubtful', 'o-convinced': 'percival-convinced' }
type Extra = 'none' | 'hamid' | 'trust' | 'both'
type Seen = { trustedAtTable: number; guardedAtTable: number; warm: number; cold: number; remembers: number; believed: number }
const seen: Seen = { trustedAtTable: 0, guardedAtTable: 0, warm: 0, cold: 0, remembers: 0, believed: 0 }

async function playStage2(g: Harness, c: S1, answer: Answer, extra: Extra) {
  const notes = notesFor(c.men, c.east)
  const singhHeard = notes.includes('d-arjun-tired') || notes.includes('d-arjun-retreat') || notes.includes('d-gemas')
  const warm = singhHeard && c.outcome !== 'o-plan-kept'
  const remembers = c.ong !== 'none'
  // The hinge: Percival's trust and Singh's regard are set by what Sam advised.
  assert.equal(stance(g, 'percival'), startStance[c.outcome], `Percival's trust after ${c.outcome}`)
  if (c.outcome === 'o-plan-kept') assert.equal(stance(g, 'arjun'), 'arjun-tired', 'Singh is cold after "keep the east"')
  assert(said(g, 'ev-s2-task'), 'Percival gives the task automatically')
  await assert.rejects(() => g.act({ type: 'endStage' }), 'stage 2 cannot end before preparation')

  await read(g, 'doc-battlebox')
  const recall = recallFor(c, notes)
  await say(g, 'percival', ['d-percival-situation', recall])
  for (const other of allRecalls) if (other !== recall) await blocked(g, 'percival', other)
  // Stage 1 evidence no longer moves him.
  if (stance(g, 'percival') !== 'percival-convinced') {
    const before = stance(g, 'percival')
    await show(g, 'percival', g.state.discovered.includes('d-troops') ? 'd-troops' : 'd-percival-plan')
    assert.equal(stance(g, 'percival'), before, 'stage 1 triggers stay in stage 1')
  }

  // Way out 2, Singh. If Sam carried his words to the General (and did not then advise keeping the east), he trusts Sam.
  if (!g.state.discovered.includes('d-fleet') && !warm) await read(g, 'doc-fleet')
  else if (!g.state.discovered.includes('d-fleet')) await read(g, 'doc-island')
  if (warm) {
    seen.warm++
    await blocked(g, 'arjun', 'd-arjun-cold')
    await blocked(g, 'arjun', 'd-arjun-hope')
    await say(g, 'arjun', ['d-arjun-warm', 'd-no-help'])
    assert.equal(stance(g, 'arjun'), 'arjun-frank', 'Singh speaks straight to someone who carried his words')
  } else {
    await blocked(g, 'arjun', 'd-arjun-warm')
    if (c.outcome === 'o-plan-kept') { seen.cold++; await say(g, 'arjun', ['d-arjun-cold', 'd-arjun-hope']) }
    else { await blocked(g, 'arjun', 'd-arjun-cold'); await say(g, 'arjun', ['d-arjun-hope']) }
    await blocked(g, 'arjun', 'd-no-help')
    await read(g, 'doc-fleet')
    await show(g, 'arjun', 'd-fleet', ['d-no-help'])
    assert.equal(stance(g, 'arjun'), 'arjun-frank')
  }
  assert(said(g, 'ev-s2-pasir'), 'Hamid is announced once Sam leaves the Battlebox')
  assert(!fired(g, 'ev-s2-water'), 'no water news after only one way out')

  // Way out 3, Mrs Ong. She remembers whether Sam told her the truth about the notice.
  if (remembers) {
    seen.remembers++
    await blocked(g, 'ong', 'd-ong-believed')
    await say(g, 'ong', ['d-ong-remembers', 'd-no-city'])
  } else {
    seen.believed++
    await blocked(g, 'ong', 'd-ong-remembers')
    await say(g, 'ong', ['d-ong-believed'])
    await blocked(g, 'ong', 'd-no-city')
    await show(g, 'ong', 'd-goodman', ['d-no-city'])
  }
  assert(said(g, 'ev-s2-water'), 'water news lands on the second way out checked')

  // Did the soldiers give up? And can Sam earn Percival's trust this week?
  await say(g, 'hamid', ['d-hamid-pasir'])
  if (extra === 'hamid' || extra === 'both') {
    await read(g, 'doc-island')
    await blocked(g, 'hamid', 'd-hamid-courage')
    await show(g, 'hamid', 'd-bukit-timah', ['d-hamid-courage'])
  }
  if (extra === 'trust' || extra === 'both') {
    await read(g, 'doc-island')
    for (const note of ['d-goodman', 'd-bukit-timah', ...(g.state.discovered.includes('d-hamid-courage') ? ['d-hamid-courage'] : [])]) {
      const before = percivalStances.indexOf(stance(g, 'percival')!)
      await show(g, 'percival', note)
      assert.equal(stance(g, 'percival'), percivalStances[Math.min(2, before + 1)], `this week's evidence earns trust: ${note}`)
    }
  }
  const trusted = stance(g, 'percival') === 'percival-convinced'
  const guarded = stance(g, 'percival') === 'percival-confident'

  // Way out 1, Bennett, last: every way out checked opens the decision by itself.
  await blocked(g, 'bennett', 'd-bennett-heath')
  await say(g, 'bennett', ['d-bennett'])
  for (const idea of ['a counterattack', 'holding on for help', 'fighting on in the city'])
    assert(g.state.transcript.some(m => m.text.startsWith(`Way out checked: ${idea}`)), `progress line for ${idea}`)
  assert.equal(said(g, 'ev-s2-trusted'), trusted, 'Percival asks for Sam\'s honest view only if he trusts Sam')
  assert.equal(said(g, 'ev-s2-guarded'), guarded, 'a guarded Percival hears the senior officers first')
  if (trusted) seen.trustedAtTable++
  if (guarded) seen.guardedAtTable++
  assert.equal(g.state.moment?.status, 'choosing', 'the decision opens by itself once every way out is checked')
  const secret = trusted && g.state.discovered.includes('d-hamid-courage')
  assert.equal(offered(g).includes('a-both-truths'), secret, 'stage 2 secret act needs Percival\'s trust and Hamid\'s answer')
  for (const act of ['a-no-way', 'a-counterattack', 'a-civilians']) assert(offered(g).includes(act), `${act} always offered`)
  const chosen: Answer = answer === 'a-both-truths' && !secret ? 'a-no-way' : answer
  await g.act({ type: 'act', actId: chosen })
  await g.act({ type: 'predict', outcomeId: g.state.moment!.outcomeId! })
  assert.equal(g.state.phase, 'epilogue')
  const ending = s2Answers[chosen]
  assert.equal(g.state.endingId, ending)
  const end = spec.endings.find(e => e.id === ending)!
  assert(end.epilogue.includes('decided to surrender'), 'every ending reaches the historical surrender')
  assert(/did not change the result|could not give them/.test(end.epilogue), 'every epilogue says what the evidence did not change')
  await g.act({ type: 'continue' })
  await g.act({ type: 'interviewAnswer', verdictId: end.interview.verdicts[1]!.id, evidenceNoteIds: [g.noteFor('d-goodman'), g.noteFor('d-percival-plan')], text: 'The troops were exhausted and the supplies ran out.' })
  assert(g.state.interview.pushBack, 'interviewer pushes back')
  await g.act({ type: 'interviewAnswer', verdictId: end.interview.verdicts[1]!.id, evidenceNoteIds: [], text: 'Both sides matter.' })
  await g.act({ type: 'continue' })
  assert.equal(g.state.phase, 'reveal')
  return chosen
}

const routes: { s1: string; outcome: string; answer: string; ending: string }[] = []
const answers: Answer[] = ['a-no-way', 'a-counterattack', 'a-civilians']
const extras: Extra[] = ['none', 'hamid', 'trust', 'both']
let n = 0
const perOutcome: Record<string, number> = {}
for (const c of s1Cases) {
  const extra = extras[n++ % 4]!
  const turn = perOutcome[c.outcome] = (perOutcome[c.outcome] ?? -1) + 1
  const answer: Answer = extra === 'both' ? 'a-both-truths' : answers[turn % 3]!
  const g = harness()
  await playStage1(g, c)
  const chosen = await playStage2(g, c, answer, extra)
  routes.push({ s1: `${c.act} | men: ${c.men} | east: ${c.east} | city: ${c.ong}`, outcome: c.outcome, answer: chosen, ending: s2Answers[chosen] })
}

// ---------- story events: progress first, clock only as a fallback ----------
{
  // A slow player who has not yet heard Percival still gets the fleet signal, and nothing else fires early.
  const g = harness()
  await g.start()
  g.advance(239_000); await g.act({ type: 'tick' })
  assert(!fired(g, 'ev-s1-runner'))
  g.advance(2_000); await g.act({ type: 'tick' })
  assert(g.state.heldDocuments.includes('doc-fleet') && said(g, 'ev-s1-runner'), 'runner falls back to the clock')
  g.advance(600_000); await g.act({ type: 'tick' })
  assert(!fired(g, 'ev-s1-siren') && !fired(g, 'ev-s1-summons'), 'siren and summons wait for Percival\'s plan')
  await read(g, 'doc-fleet') // a delivered document can be read where you stand
  await say(g, 'percival', ['d-percival-plan'])
  assert(said(g, 'ev-s1-summons') && !fired(g, 'ev-s1-siren'), 'a long-idle player is reminded by Percival, in his room')
  await room(g, 'dossier-1')
  assert(said(g, 'ev-s1-siren'), 'and hears the siren on leaving')
}
{
  // A fast player who reads the fleet signal first never sees a runner bring it.
  const g = harness()
  await g.start()
  await read(g, 'doc-fleet')
  await say(g, 'percival', ['d-percival-plan'])
  g.advance(1_000_000); await g.act({ type: 'tick' })
  assert(!fired(g, 'ev-s1-runner'), 'no runner for a signal already read')
  // Fast through stage 1, then check the stage 2 clock fallbacks.
  await read(g, 'doc-troops'); await show(g, 'percival', 'd-troops')
  await g.act({ type: 'endStage' }); await g.act({ type: 'act', actId: 'a-check-nw' })
  assert.equal(g.state.moment!.outcomeId, 'o-check')
  await g.act({ type: 'predict', outcomeId: 'o-check' }); await g.act({ type: 'continue' })
  assert(said(g, 'ev-s2-task'))
  g.advance(1_000_000); await g.act({ type: 'tick' })
  assert(!fired(g, 'ev-s2-pasir') && !fired(g, 'ev-s2-water'), 'stage 2 beats wait for the player, not the clock')
  await room(g, 'outside')
  assert(said(g, 'ev-s2-pasir'), 'Hamid is announced as Sam steps out of the Battlebox')
}
{
  // Hamid is announced once, on stepping out; reading the signals log after meeting him adds no second announcement.
  const g = harness()
  await g.start()
  await read(g, 'doc-troops'); await say(g, 'percival', ['d-percival-plan']); await read(g, 'doc-gemas')
  await g.act({ type: 'endStage' }); await g.act({ type: 'act', actId: 'a-keep-east' })
  await g.act({ type: 'predict', outcomeId: 'o-plan-kept' }); await g.act({ type: 'continue' })
  await room(g, 'outside')
  assert(said(g, 'ev-s2-pasir'))
  await say(g, 'hamid', ['d-hamid-pasir'])
  const count = g.state.transcript.length
  await read(g, 'doc-island')
  assert(!g.state.transcript.slice(count).some(m => m.kind === 'narration'), 'no repeat announcement')
}

// ---------- reveal ----------
{
  const reveal = spec.reveal!
  assert(reveal.corrections.some(c => c.includes('public notice') && c.includes('not a real document')), 'the slanted notice is corrected in the reveal')
  for (const doc of spec.documents) assert(!doc.real && /^Reconstruction for this adventure, based on /.test(doc.sourceLabel), `${doc.id} is labelled as a reconstruction`)
}

// ---------- coverage ----------
const [m1, m2] = spec.definingMoments
for (const id of m1!.acts.map(a => a.id)) assert(routes.some(r => r.s1.startsWith(id)), `stage 1 act ${id} covered`)
for (const o of m1!.outcomes) assert(routes.some(r => r.outcome === o.id), `stage 1 outcome ${o.id} reached`)
for (const id of m2!.acts.map(a => a.id)) assert(routes.some(r => r.answer === id), `stage 2 act ${id} covered`)
// Every stage 1 act was tried at every level of Percival's doubt it can be chosen at.
for (const act of ['a-keep-east', 'a-move-nw', 'a-check-nw']) for (const step of [0, 1, 2]) assert(s1Cases.some(c => c.act === act && c.step === step), `${act} at step ${step}`)
// Every stage 1 outcome meets every stage 2 answer.
for (const o of m1!.outcomes) for (const a of ['a-no-way', 'a-counterattack', 'a-civilians']) assert(routes.some(r => r.outcome === o.id && r.answer === a), `${o.id} then ${a}`)
for (const [key, count] of Object.entries(seen)) assert(count > 0, `stage 2 branch ${key} exercised`)
console.log(JSON.stringify({
  routes: routes.length,
  stage1: [...new Set(routes.map(r => `${r.s1.split(' | ')[0]} -> ${r.outcome}`))],
  endings: [...new Set(routes.map(r => `${r.answer} -> ${r.ending}`))],
  stage2Branches: seen,
  storyEvents: 'progress-keyed events and clock fallbacks checked',
}, null, 2))
