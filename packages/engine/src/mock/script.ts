/**
 * The mock's content: a cut-down Singapore 1819 run. Illustrative only; it is not the golden fixture and
 * is not checked for accuracy. It exists so the screens have every phase and every kind of message to draw.
 */
import type { DocumentView, RoleBriefingView } from '@adventure/play-contract'

export const briefing: RoleBriefingView = {
  name: 'Ahmad',
  position: 'Interpreter to the East India Company party',
  relationships: [
    'Served Major Farquhar at Malacca for six years',
    "Known to the Temenggong's household through your uncle",
  ],
  reputation: 'Trusted a little by both sides, and completely by neither.',
  stakes: 'Malacca has gone back to the Dutch. If this new post fails, so does your living.',
  privateBrief: {
    goals: ['See a British post founded here', 'Keep the trust of both sides'],
    fears: ['Being blamed if the talks collapse'],
    constraints: ['You speak for others; you cannot promise anything yourself'],
    knows: ['The Temenggong governs the island for the Sultan of Johor', 'The Johor throne is disputed'],
  },
  situation: '29 January 1819. Raffles has landed at the mouth of the Singapore River and wants a trading post.',
}

export interface MockCharacter {
  id: string
  name: string
  title: string
  stances: readonly string[] | null
  replies: readonly string[]
}

export interface MockStage {
  title: string
  timePlace: string
  centralQuestion: string
  narration: string
  rooms: readonly { id: string; name: string }[]
  startRoomId: string
  placement: Record<string, string>
  documentPlacement: Record<string, string>
  scene: string
  deciderId: string
  acts: readonly { id: string; text: string; reaction: string }[]
  outcomes: readonly { id: string; text: string; summary: string; because: string }[]
  finalCall: string
  nudge: string
}

export const characters: Record<string, MockCharacter> = {
  temenggong: {
    id: 'temenggong',
    name: 'Temenggong Abdul Rahman',
    title: 'Temenggong of Johor',
    stances: ['s1', 's2', 's3'],
    replies: [
      'You come with the white men, yet you speak our tongue well. Sit.',
      'My people keep their share of the trade. That is my price.',
      'The Sultan is far away, and the Dutch are near. Think on that.',
    ],
  },
  raffles: {
    id: 'raffles',
    name: 'Sir Stamford Raffles',
    title: 'Lieutenant-Governor of Bencoolen',
    stances: ['s1', 's2', 's3'],
    replies: [
      'Time is short, Ahmad. The Dutch will not wait for us to be polite.',
      'A free port here would draw every trader between Siam and Java.',
    ],
  },
  hussein: {
    id: 'hussein',
    name: 'Tengku Hussein',
    title: 'Elder son of the late Sultan Mahmud',
    stances: ['s1', 's2', 's3'],
    replies: ['I was passed over once. I will not be used and forgotten.', 'Recognition first. Then we may speak of land.'],
  },
  farquhar: {
    id: 'farquhar',
    name: 'Major William Farquhar',
    title: 'Former Resident of Malacca',
    stances: null,
    replies: ['Raffles moves fast. Someone will have to live with what he signs.'],
  },
}

export const documents: Record<string, DocumentView & { keyPassage: { start: number; end: number }; note: string }> = {
  agreement: {
    id: 'agreement',
    kind: 'treaty',
    title: 'Preliminary agreement',
    provenance: { masthead: null, date: '30 January 1819', sender: null, recipient: null, place: 'Singapore' },
    body:
      'The Temenggong agrees that the Honourable Company may establish a factory at Singapore, and in return the ' +
      'Company will pay him three thousand Spanish dollars yearly, and protect him from any enemy that may attack him.',
    real: false,
    sourceLabel: 'Invented for the mock',
    glossary: [{ term: 'factory', meaning: 'a trading post run by merchants' }],
    open: false,
    keyPassage: { start: 102, end: 164 },
    note: 'The Company offered the Temenggong 3,000 dollars a year.',
  },
}

export const stages: readonly MockStage[] = [
  {
    title: 'The landing',
    timePlace: 'Singapore River, 29–30 January 1819',
    centralQuestion: 'Will the Temenggong let the Company stay, and on whose authority?',
    narration: 'The Company ships ride at anchor. On shore, the Temenggong waits to see what the British want.',
    rooms: [
      { id: 'landing', name: 'The landing' },
      { id: 'balai', name: "The Temenggong's balai" },
    ],
    startRoomId: 'landing',
    placement: { raffles: 'landing', temenggong: 'balai' },
    documentPlacement: { agreement: 'balai' },
    scene: 'The Temenggong turns to you before he answers Raffles. "Tell me plainly what he offers."',
    deciderId: 'temenggong',
    acts: [
      { id: 'faithful', text: 'Interpret the offer faithfully, payments and all.', reaction: 'The Temenggong nods slowly. "Plain words. Good."' },
      { id: 'protection', text: 'Stress the protection the Company promises against the Dutch.', reaction: 'He glances towards Riau. "Protection is a long word."' },
      { id: 'sultan', text: 'Warn him that only the Sultan can grant land.', reaction: 'Raffles stiffens. The Temenggong smiles thinly.' },
    ],
    outcomes: [
      { id: 'signs', text: 'He will sign, and send for Tengku Hussein.', summary: 'The Temenggong signed the preliminary agreement.', because: 'he heard the offer plainly and was already leaning your way' },
      { id: 'waits', text: 'He will wait for word from Riau.', summary: 'The Temenggong delayed.', because: 'he did not trust the protection he was promised' },
      { id: 'alone', text: 'He will sign only if he deals alone.', summary: 'The Temenggong insisted on dealing alone.', because: 'he wanted no Sultan between him and the Company' },
    ],
    finalCall: 'A runner comes from the balai: the Temenggong will give his answer now.',
    nudge: 'Raffles mutters: "Do we even know what he wants from us?"',
  },
  {
    title: 'The disputed throne',
    timePlace: 'Singapore, 1–6 February 1819',
    centralQuestion: 'Whose authority will make the treaty lawful?',
    narration: 'Tengku Hussein has arrived from Riau. Everyone is watching to see whom Raffles will recognise.',
    rooms: [
      { id: 'landing', name: 'The landing' },
      { id: 'tent', name: "Raffles's tent" },
    ],
    startRoomId: 'landing',
    placement: { raffles: 'tent', hussein: 'landing', farquhar: 'landing' },
    documentPlacement: {},
    scene: 'Raffles lowers his voice. "You have heard them all. What should I do?"',
    deciderId: 'raffles',
    acts: [
      { id: 'recognise', text: 'Recognise Tengku Hussein as Sultan.', reaction: 'Hussein straightens. Farquhar looks at the ground.' },
      { id: 'calcutta', text: 'Wait for orders from Calcutta.', reaction: 'Raffles drums his fingers. "Calcutta is months away."' },
      { id: 'temenggong-only', text: 'Deal with the Temenggong alone.', reaction: '"Alone?" Raffles frowns. "On whose authority?"' },
    ],
    outcomes: [
      { id: 'treaty', text: 'He will recognise Hussein and sign a treaty.', summary: 'A treaty was signed on 6 February.', because: 'Hussein would sign only as Sultan' },
      { id: 'stall', text: 'He will wait, and the post will stall.', summary: 'The post stalled while the Dutch protested.', because: 'without a ruler to sign, nothing could be granted' },
      { id: 'fragile', text: 'He will sign with the Temenggong alone.', summary: 'A fragile post on the Temenggong\'s word.', because: 'the Temenggong could not grant land in his own name' },
    ],
    finalCall: 'The tide turns. Raffles must sail tomorrow; he wants your advice tonight.',
    nudge: 'Farquhar says quietly: "Have you spoken with Hussein yet?"',
  },
]

export const epilogue = {
  title: 'Your simulation: 6 February 1819',
  text: 'Under an awning by the river, Raffles, Hussein and the Temenggong put their seals to a treaty. You translated every line.',
  label: 'This is how your run ended. It is a simulation, not the record.',
}

export const interview = {
  interviewer: 'A Company clerk, 1824',
  question: 'You were there in 1819. Was the treaty fair to the people already living here?',
  verdicts: [
    { id: 'fair', text: 'Yes, everyone gained.' },
    { id: 'unfair', text: 'No, they were not asked.' },
    { id: 'partly', text: 'Only partly.' },
  ],
  pushBack: 'Yet you noted the Temenggong bargained hard for his share. Doesn\'t that suggest someone was heard?',
  closing: 'Thank you. I will write that down as you said it.',
}

export const reveal = {
  whatHappened:
    'On 6 February 1819 Raffles recognised Tengku Hussein as Sultan of Johor and signed a treaty with him and the ' +
    'Temenggong. The Company could build a trading post; the Sultan received 5,000 Spanish dollars a year and the ' +
    'Temenggong 3,000.',
  corrections: ['Raffles described the island as nearly empty; about a thousand people already lived there.'],
}
