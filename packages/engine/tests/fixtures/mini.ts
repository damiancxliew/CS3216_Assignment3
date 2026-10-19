/**
 * A small two-stage spec that exercises every rule. Not history: the content is placeholder so the tests read
 * as rules. The golden fixture covers a real adventure.
 */
import { EngineSpec } from '../../src'

const persona = (name: string) => ({
  voice: `${name}'s voice`,
  phrases: [],
  knewThen: 'the matter at hand',
  wantsFromStudent: 'help',
  withholds: [],
  publicPosition: `${name} in public`,
  privateAgenda: `${name} in private`,
})

const interview = {
  interviewer: 'A clerk',
  question: 'Was it fair?',
  verdicts: [
    { id: 'yes', text: 'Yes.', counterPoints: ['d-a2'] },
    { id: 'no', text: 'No.', counterPoints: ['d-a1'] },
    { id: 'partly', text: 'Partly.', counterPoints: [] },
  ],
  generalCounter: 'Others would disagree.',
}

const FILLER = 'Words of no consequence fill this part of the letter at some length, as letters of the time did. '
const DOC_BODY = `${FILLER.repeat(3)}The key line is right here in the middle. ${FILLER.repeat(3)}Closing words of the letter.`
const KEY_START = DOC_BODY.indexOf('The key line')
const KEY_END = KEY_START + 'The key line is right here in the middle.'.length

export const mini: EngineSpec = EngineSpec.parse({
  id: 'mini',
  title: 'Mini',
  readingLevel: 'sec',
  timer: { enabled: true, stageMinutes: [10, 10] },
  role: {
    name: 'Ahmad',
    position: 'Interpreter',
    relationships: ['Knows everyone a little'],
    reputation: 'Half-trusted',
    stakes: 'His living',
    privateBrief: { goals: ['g'], fears: ['f'], constraints: ['c'], knows: ['k'] },
    situation: 'It begins.',
  },
  stages: [
    {
      id: 's1',
      title: 'Stage one',
      timePlace: 'Day one',
      centralQuestion: 'Will A agree?',
      openingNarration: 'Stage one opens.',
      rooms: [
        { id: 'r1', name: 'Hall', description: 'A hall' },
        { id: 'r2', name: 'Tent', description: 'A tent' },
      ],
      startRoomId: 'r1',
      placement: { a: 'r1', b: 'r2', m: 'r1' },
      documentPlacement: { letter: 'r2', memo: 'held' },
      definingMomentId: 'm1',
    },
    {
      id: 's2',
      title: 'Stage two',
      timePlace: 'Day two',
      centralQuestion: 'What will B do?',
      openingNarration: 'Stage two opens.',
      rooms: [{ id: 'r1', name: 'Hall', description: 'A hall' }],
      startRoomId: 'r1',
      placement: { a: 'r1', b: 'r1' },
      documentPlacement: {},
      situations: [{
        whenOutcome: { momentId: 'm1', outcomeId: 'o-refuse' },
        stances: { a: 'a1' },
        documentPlacement: { letter: 'r1' },
        openingNarration: 'After the refusal, stage two opens.',
      }],
      definingMomentId: 'm2',
    },
  ],
  characters: [
    {
      id: 'a',
      name: 'A',
      title: 'Chief',
      real: true,
      tier: 'major',
      persona: persona('A'),
      stances: [
        { id: 'a1', label: 'guarded', demeanour: 'closed' },
        { id: 'a2', label: 'wary', demeanour: 'careful' },
        { id: 'a3', label: 'open', demeanour: 'open' },
        { id: 'a4', label: 'confiding', demeanour: 'confiding', hidden: true },
      ],
      initialStanceId: 'a2',
      slants: [{ id: 'slant-a', claim: 'The island is mine.', contradictedBy: ['d-letter'] }],
    },
    {
      id: 'b',
      name: 'B',
      title: 'Envoy',
      real: true,
      tier: 'major',
      persona: persona('B'),
      stances: [
        { id: 'b1', label: 'impatient', demeanour: 'curt' },
        { id: 'b2', label: 'calculating', demeanour: 'listening' },
      ],
      initialStanceId: 'b1',
      slants: [],
    },
    {
      id: 'm',
      name: 'M',
      title: 'Boatman',
      real: false,
      tier: 'minor',
      persona: persona('M'),
      stances: [],
      initialStanceId: null,
      slants: [{ id: 'slant-m', claim: 'Nobody lives here.', contradictedBy: ['d-letter'], unlocksDiscoveryId: 'd-m2' }],
    },
  ],
  discoveries: [
    { id: 'd-a1', stageId: 's1', holder: { characterId: 'a' }, text: 'A wants a share.', note: 'A wants a share of the trade.', core: true, sourceLabel: 'from the teacher' },
    { id: 'd-a2', stageId: 's1', holder: { characterId: 'a' }, text: 'A fears Riau.', note: 'A fears Riau.', topic: 'his fears', core: true, condition: { stanceAtLeast: { characterId: 'a', stanceId: 'a3' } }, sourceLabel: 'A source' },
    { id: 'd-a3', stageId: 's1', holder: { characterId: 'a' }, text: 'A has a secret plan.', note: 'A has a secret plan.', topic: 'his plan', core: false, condition: { stanceIs: { characterId: 'a', stanceId: 'a4' } }, sourceLabel: 'invented' },
    { id: 'd-b1', stageId: 's1', holder: { characterId: 'b' }, text: 'B has orders.', note: 'B has orders from Calcutta.', core: false, sourceLabel: 'invented' },
    { id: 'd-m1', stageId: 's1', holder: { characterId: 'm' }, text: 'M saw ships.', note: 'M saw ships.', core: false, sourceLabel: 'invented' },
    { id: 'd-m2', stageId: 's1', holder: { characterId: 'm' }, text: 'M admits people live here.', note: 'M admits people live here.', core: false, condition: { slantConfronted: 'slant-m' }, sourceLabel: 'invented' },
    { id: 'd-letter', stageId: 's1', holder: { documentId: 'letter', keyPassageId: 'kp1' }, text: 'The letter says the key line.', note: 'The letter has the key line.', core: false, sourceLabel: 'A letter, 1819' },
    { id: 'd-s2', stageId: 's2', holder: { characterId: 'b' }, text: 'B will decide alone.', note: 'B will decide alone.', core: true, sourceLabel: 'from the teacher' },
  ],
  documents: [
    { id: 'letter', kind: 'letter', title: 'A letter', provenance: { sender: 'X', recipient: 'Y', date: '1819' }, body: DOC_BODY, real: true, sourceLabel: 'A letter, 1819', keyPassages: [{ id: 'kp1', start: KEY_START, end: KEY_END }] },
    { id: 'memo', kind: 'other', title: 'A memo', provenance: {}, body: 'A memo.', real: false, sourceLabel: 'invented', keyPassages: [] },
    { id: 'gift', kind: 'report', title: 'A gift', provenance: {}, body: 'Handed over.', real: false, sourceLabel: 'invented', keyPassages: [] },
  ],
  triggers: [
    { id: 't-b', characterId: 'b', on: { notePassed: 'd-a1' }, effect: { stanceDelta: 1 }, handsOver: ['gift'], notice: 'B goes quiet.' },
    { id: 't-a-slant', characterId: 'a', on: { slantConfronted: 'slant-a' }, effect: { stanceDelta: 1 }, notice: 'A looks away.' },
    { id: 't-a-top', characterId: 'a', on: { notePassed: 'd-b1' }, requires: { stanceIs: { characterId: 'a', stanceId: 'a3' } }, effect: { toStance: 'a4' }, notice: 'A leans in.' },
  ],
  definingMoments: [
    {
      id: 'm1',
      stageId: 's1',
      deciderId: 'a',
      scene: 'A must decide.',
      nudge: 'Do you know what A wants?',
      finalCallNarration: 'Time is up: A will answer now.',
      acts: [
        { id: 'frank', text: 'Be frank.', reaction: 'A nods.' },
        { id: 'warn', text: 'Warn him.', reaction: 'A frowns.' },
      ],
      outcomes: [
        { id: 'o-agree', summary: 'A agreed.', predictionText: 'He will agree.', because: 'he trusted you', closesEndingIds: ['e-alt2'], historical: true },
        { id: 'o-refuse', summary: 'A refused.', predictionText: 'He will refuse.', because: 'he was warned', closesEndingIds: ['e-hist'] },
        { id: 'o-delay', summary: 'A delayed.', predictionText: 'He will wait.', because: 'he was unsure', closesEndingIds: [] },
      ],
      rules: [
        { actId: 'frank', when: { stanceAtLeast: { characterId: 'a', stanceId: 'a3' } }, outcomeId: 'o-agree' },
        { actId: 'frank', outcomeId: 'o-delay' },
        { actId: 'warn', outcomeId: 'o-refuse' },
      ],
    },
    {
      id: 'm2',
      stageId: 's2',
      deciderId: 'b',
      scene: 'B must decide.',
      nudge: 'Have you asked B?',
      finalCallNarration: 'B sends for you.',
      acts: [
        { id: 'recognise', text: 'Advise recognition.', reaction: 'B smiles.' },
        { id: 'wait', text: 'Advise waiting.', reaction: 'B sighs.' },
        { id: 'alone', text: 'Advise going alone.', reaction: 'B frowns.' },
        { id: 'secret', text: 'Propose the hidden path.', reaction: 'B stares.', secret: { unlock: [{ stanceIs: { characterId: 'a', stanceId: 'a4' } }, { discovered: 'd-a3' }, { slantConfronted: 'slant-a' }], minMet: 2 } },
      ],
      outcomes: [
        { id: 'o-hist', summary: 'Recognised.', predictionText: 'He will recognise.', because: 'it was lawful', endingId: 'e-hist', historical: true },
        { id: 'o-alt1', summary: 'Waited.', predictionText: 'He will wait.', because: 'caution', endingId: 'e-alt1' },
        { id: 'o-alt2', summary: 'Alone.', predictionText: 'He will go alone.', because: 'pride', endingId: 'e-alt2' },
        { id: 'o-secret', summary: 'The hidden path.', predictionText: 'The hidden path.', because: 'trust', endingId: 'e-secret', secret: true },
      ],
      rules: [
        { actId: 'recognise', outcomeId: 'o-hist' },
        { actId: 'wait', outcomeId: 'o-alt1' },
        { actId: 'alone', outcomeId: 'o-alt2' },
        { actId: 'secret', outcomeId: 'o-secret' },
      ],
    },
  ],
  endings: [
    { id: 'e-hist', type: 'historical', title: 'History', summary: 'What happened.', epilogue: 'The historical epilogue.', interview, sourceLabel: 'A source' },
    { id: 'e-alt1', type: 'alternative', title: 'Waiting', summary: 'Alt one.', epilogue: 'Alt one epilogue.', interview, sourceLabel: 'invented' },
    { id: 'e-alt2', type: 'alternative', title: 'Alone', summary: 'Alt two.', epilogue: 'Alt two epilogue.', interview, sourceLabel: 'invented' },
    { id: 'e-secret', type: 'secret', title: 'Hidden', summary: 'Secret.', epilogue: 'Secret epilogue.', interview, sourceLabel: 'invented' },
  ],
  reveal: { whatHappened: 'It happened.', interpretations: ['One view.'], corrections: ['A slanted.'], couldHaveGone: ['Differently.'] },
})

export const LETTER_KEY = { start: KEY_START, end: KEY_END }
