import { describe, expect, it } from 'vitest'
import { checkSpec, preparationProgress, validateSpec } from '../src/index.js'
import { sampleSpec } from './sample.js'

function prepared() {
  const parsed = validateSpec(structuredClone(sampleSpec))
  if (!parsed.ok) throw Error('sample')
  const spec = parsed.spec, doc = spec.documents[0]!, stage = spec.stages[0]!
  doc.body = 'The harbour was busy. Several masters complained of new dues. Their vessels remained at anchor. Cargo awaited inspection.'
  const start = doc.body.indexOf('Several'), end = doc.body.indexOf(' Their')
  doc.keyPassages = [{ id: 'kp-1', start, end }]
  const question = (id: string) => ({ id, prompt: `What does the register suggest (${id})?`, options: [{ id: 'a', text: 'Some merchants opposed the duties.' }, { id: 'b', text: 'Every merchant welcomed them.' }, { id: 'c', text: 'Trade had stopped entirely.' }], correctOptionId: 'a', support: [{ start, end }], explanation: 'The complaints show opposition among some masters.' })
  doc.readingCheck = { discoveryId: 'disc-2', variants: ['q1', 'q2', 'q3', 'q4'].map(question), recovery: question('review'), recoveryDiscoveryIds: [] }
  stage.preparation = { characters: { 'char-farquhar': [{ discoveryIds: ['disc-2'], minMet: 1 }], 'char-nakhoda': [{ discoveryIds: ['disc-2'], minMet: 1 }] }, decision: [{ discoveryIds: ['disc-1', 'disc-3'], minMet: 1 }], essentialCharacters: [{ characterId: 'char-farquhar', discoveryIds: ['disc-1'] }, { characterId: 'char-nakhoda', discoveryIds: ['disc-3'] }] }
  return spec
}

describe('preparation authoring', () => {
  it('accepts legacy adventures and reachable prepared adventures', () => {
    expect(checkSpec(prepared()).errors).toEqual([])
    const old = validateSpec(sampleSpec)
    if (old.ok) expect(checkSpec(old.spec).errors).toEqual([])
  })
  it('caps alternative completion and does not spend discoveries', () => {
    const groups = [{ discoveryIds: ['a', 'b', 'c'], minMet: 2 }, { discoveryIds: ['d'], minMet: 1 }]
    expect(preparationProgress(groups, ['a', 'b', 'c'])).toEqual({ completed: 2, required: 3, ready: false })
    expect(preparationProgress(groups, ['a', 'b', 'd', 'unrelated'])).toEqual({ completed: 3, required: 3, ready: true })
  })
  it('rejects invalid answer keys, stale support, and duplicate questions', () => {
    const spec = prepared(), q = spec.documents[0]!.readingCheck!.variants[0]!
    q.correctOptionId = 'no-such-option'
    q.support = [{ start: 0, end: 2 }]
    spec.documents[0]!.readingCheck!.variants[1]!.id = q.id
    expect(checkSpec(spec).errors.filter(i => i.code === 'reading-check').length).toBeGreaterThanOrEqual(3)
  })
  it('rejects unrelated/duplicate requirements and impossible counts', () => {
    const spec = prepared(), p = spec.stages[0]!.preparation!
    p.characters['missing-person'] = [{ discoveryIds: ['unknown'], minMet: 2 }]
    p.decision.push({ discoveryIds: ['disc-1'], minMet: 1 })
    expect(checkSpec(spec).errors.filter(i => i.code === 'preparation').length).toBeGreaterThanOrEqual(3)
  })
  it('rejects greetings as an authored essential-conversation objective', () => {
    const spec = prepared()
    spec.stages[0]!.preparation!.essentialCharacters[0]!.discoveryIds = ['disc-2']
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation' }))
  })
  it('rejects character locks that depend on their own information', () => {
    const spec = prepared()
    spec.stages[0]!.preparation!.characters['char-farquhar'] = [{ discoveryIds: ['disc-1'], minMet: 1 }]
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable' }))
  })
  it('rejects checked-source omission and a cross-character dependency cycle', () => {
    const spec = prepared()
    delete spec.documents[0]!.readingCheck
    const p = spec.stages[0]!.preparation!
    p.characters['char-farquhar'] = [{ discoveryIds: ['disc-3'], minMet: 1 }]
    p.characters['char-nakhoda'] = [{ discoveryIds: ['disc-1'], minMet: 1 }]
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'reading-check' }))
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable' }))
  })
  it('does not treat secondary highlights as available before their scroll check', () => {
    const spec = prepared(), doc = spec.documents[0]!
    const start = doc.body.indexOf('Their'), end = doc.body.indexOf(' Cargo')
    doc.keyPassages.push({ id: 'secondary-passage', start, end })
    spec.discoveries.push({ id: 'secondary', stageId: 'stage-1', holder: { documentId: doc.id, keyPassageId: 'secondary-passage' }, text: 'Cargo remained.', note: 'Cargo remained.', core: false, sourceLabel: 'register' })
    spec.discoveries.find(d => d.id === 'disc-2')!.condition = { discovered: 'secondary' }
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable' }))
  })
  it('cannot reuse a one-shot stance trigger to reach an essential conversation', () => {
    const spec = prepared(), character = spec.characters[0]!
    character.stances[2]!.hidden = false
    spec.triggers[0]!.effect = { stanceDelta: 1 }
    spec.discoveries[0]!.condition = { stanceAtLeast: { characterId: character.id, stanceId: 'st-3' } }
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable' }))
  })
  it('rejects a note-sharing prerequisite routed through the character it must unlock', () => {
    const spec = prepared(), doc = spec.documents[0]!
    spec.discoveries.push({ id: 'other-note', stageId: 'stage-1', holder: { characterId: 'char-nakhoda' }, text: 'Other information.', note: 'Other information.', core: false, sourceLabel: 'register' })
    spec.stages[0]!.preparation!.characters['char-nakhoda'] = []
    spec.discoveries.find(d => d.id === doc.readingCheck!.discoveryId)!.condition = { notePassed: { discoveryId: 'other-note', characterId: 'char-farquhar' } }
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable' }))
  })
  it('rejects checked-scroll extra notes that require sweeping the entire document', () => {
    const spec = prepared(), doc = spec.documents[0]!
    doc.keyPassages[0] = { id: 'kp-1', start: 0, end: doc.body.length }
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'reading-check', path: 'documents.0.keyPassages.0' }))
  })
  it('does not restore consumed triggers when a later situation resets a stance', () => {
    const spec = prepared(), original = spec.stages[0]!, character = spec.characters[0]!
    spec.triggers = [{ id: 'one-rise', characterId: character.id, on: { discovered: 'disc-2' }, effect: { stanceDelta: 1 }, notice: 'He listens.' }]
    const second = structuredClone(original)
    second.id = 'stage-2'
    second.situations = [{ whenOutcome: { momentId: original.definingMomentId, outcomeId: spec.definingMoments[0]!.outcomes[0]!.id }, stances: { [character.id]: 'st-1' } }]
    second.preparation!.essentialCharacters = [{ characterId: character.id, discoveryIds: ['later-information'] }]
    spec.stages.push(second)
    spec.discoveries.push({ ...structuredClone(spec.discoveries[0]!), id: 'later-information', stageId: 'stage-2', condition: { stanceAtLeast: { characterId: character.id, stanceId: 'st-2' } } })
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable', path: 'stages.1.preparation.essentialCharacters.0' }))
    second.situations = []
    expect(checkSpec(spec).errors.filter(issue => issue.code === 'preparation-unreachable')).toEqual([])
  })
  it('does not assume optional earlier evidence was collected before leaving', () => {
    const spec = prepared(), original = spec.stages[0]!
    delete original.preparation
    const second = structuredClone(original)
    second.id = 'stage-2'
    second.documentPlacement = {}
    second.preparation = { characters: { 'char-farquhar': [{ discoveryIds: ['disc-2'], minMet: 1 }], 'char-nakhoda': [] }, decision: [{ discoveryIds: ['disc-1', 'disc-3'], minMet: 1 }], essentialCharacters: [{ characterId: 'char-farquhar', discoveryIds: ['later-fact'] }] }
    spec.discoveries.push({ ...structuredClone(spec.discoveries[0]!), id: 'later-fact', stageId: second.id })
    spec.stages.push(second)
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable', path: 'stages.1.preparation.characters.char-farquhar' }))
    second.documentPlacement['doc-1'] = 'room-dock'
    // Making that source available again permits the earlier discovery to be earned here.
    expect(checkSpec(spec).errors.filter(issue => issue.code === 'preparation-unreachable' && issue.path === 'stages.1.preparation.characters.char-farquhar')).toEqual([])
  })
  it('checks scrolls delivered through events and character handovers too', () => {
    const spec = prepared()
    const delivered = { ...structuredClone(spec.documents[0]!), id: 'delivered' }
    delete delivered.readingCheck
    spec.documents.push(delivered)
    spec.storyEvents.push({ id: 'delivery', stageId: 'stage-1', effect: 'deliverDocument', documentId: delivered.id, when: { atSeconds: 60 }, text: 'A delivery.' })
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'reading-check', path: 'documents.1.readingCheck' }))
    spec.storyEvents = []
    spec.triggers[0]!.handsOver = ['delivered']
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'reading-check', path: 'documents.1.readingCheck' }))
  })
  it('does not assume an optional previous-stage trust increase occurred', () => {
    const spec = prepared(), first = spec.stages[0]!, character = spec.characters[0]!
    delete first.preparation
    spec.triggers = [{ id: 'optional-rise', characterId: character.id, on: { discovered: 'disc-2' }, effect: { stanceDelta: 1 }, notice: 'He listens.' }]
    const next = structuredClone(first)
    next.id = 'stage-2'
    next.documentPlacement = {}
    next.preparation = { characters: { [character.id]: [], 'char-nakhoda': [] }, decision: [{ discoveryIds: ['later-fact', 'other-later-fact'], minMet: 1 }], essentialCharacters: [{ characterId: character.id, discoveryIds: ['later-fact'] }] }
    spec.stages.push(next)
    spec.discoveries.push({ ...structuredClone(spec.discoveries[0]!), id: 'later-fact', stageId: next.id, condition: { stanceAtLeast: { characterId: character.id, stanceId: 'st-2' } } }, { ...structuredClone(spec.discoveries[2]!), id: 'other-later-fact', stageId: next.id })
    expect(checkSpec(spec).errors).toContainEqual(expect.objectContaining({ code: 'preparation-unreachable', path: 'stages.1.preparation.essentialCharacters.0' }))
  })
})
