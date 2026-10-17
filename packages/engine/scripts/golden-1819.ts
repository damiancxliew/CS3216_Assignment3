/**
 * Builds `fixtures/golden-1819.json`, the hand-checked Singapore 1819 adventure, so key-passage offsets are
 * computed from the passage text rather than counted by hand. Edit the content here, then run:
 *
 *   npx vite-node packages/engine/scripts/golden-1819.ts      # from the repo root
 *
 * `tests/golden.test.ts` fails if the JSON is out of date.
 *
 * Sources: the teacher's handout (packages/generation/fixtures/sources/singapore-1819-handout.txt, labelled
 * "from the teacher"); the Treaty of Friendship and Alliance, 6 February 1819 (fixtures/sources/
 * treaty-1819-wikisource.txt, quoted word for word); NLB Infopedia, "1819 Singapore Treaty". Everything
 * else is invented and labelled so. Every historical claim is listed in fixtures/golden-1819.review.md.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { EngineSpec } from '../src/spec'

const TEACHER = 'from the teacher'
const INVENTED = 'invented'
const TREATY = 'Treaty of Friendship and Alliance, Singapore, 6 February 1819'
const INFOPEDIA = 'NLB Infopedia, "1819 Singapore Treaty"'

/** A document whose key passages are found by text, so offsets never drift from the body. */
function document(spec: {
  id: string
  kind: 'newspaper' | 'letter' | 'telegram' | 'speech' | 'minutes' | 'memoir' | 'treaty' | 'report' | 'other'
  title: string
  provenance: Record<string, string>
  body: string
  real: boolean
  sourceLabel: string
  glossary?: { term: string; meaning: string }[]
  keyPassages: { id: string; text: string }[]
  citations?: { sourceId: string; quote?: string }[]
}) {
  return {
    ...spec,
    glossary: spec.glossary ?? [],
    keyPassages: spec.keyPassages.map(({ id, text }) => {
      const start = spec.body.indexOf(text)
      if (start < 0) throw new Error(`key passage ${id} not found in ${spec.id}`)
      return { id, start, end: start + text.length }
    }),
  }
}

const SOURCES = [
  { id: 'src-handout', title: 'The founding of a trading post at Singapore, 1819 (classroom handout)', origin: 'teacher' },
  { id: 'src-treaty', title: TREATY, origin: 'outside', url: 'https://en.wikisource.org/wiki/1819_Singapore_Treaty' },
  { id: 'src-nlb', title: INFOPEDIA, origin: 'outside', url: 'https://web.archive.org/web/20180121060511/eresources.nlb.gov.sg/infopedia/articles/SIP_2014-05-16_133354.html' },
]

/** Citations, quoted word for word; `tests/golden.test.ts` checks every quote against the saved source text. */
const cite = (sourceId: string, quote: string) => ({ sourceId, quote })
const HANDOUT = {
  notSovereign: 'The Temenggong governed Singapore, but he was not the sovereign; only the Sultan of Johor could lawfully grant land to the Company.',
  younger: 'The younger, Tengku Abdul Rahman, was installed as Sultan in his absence with the support of the powerful Bugis faction at court, and this choice was later recognised by the Dutch.',
  elder: 'The elder, Tengku Hussein, also known as Tengku Long, was away in Pahang for his wedding when his father died.',
  view: 'Raffles took the view that Tengku Hussein, as the elder son, had the stronger claim.',
  recognised: 'Hussein arrived in Singapore in early February 1819, and Raffles recognised him as Sultan Hussein Shah of Johor.',
  allowances: 'In return the Sultan was to receive 5,000 Spanish dollars a year and the Temenggong 3,000 Spanish dollars a year.',
}

const stance = (id: string, label: string, demeanour: string, hidden = false) => ({ id, label, demeanour, ...(hidden ? { hidden } : {}) })

// ---------------------------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------------------------

const PRELIM_BODY = [
  'Articles to be agreed between the Honourable Sir Stamford Raffles, for the English East India Company, and the Datoo Tumungong Abdul Rahman, Chief of Singapoora.',
  'First. The Datoo Tumungong permits the Honourable Company to establish a Factory at Singapoora.',
  'Second. The Honourable Company will take the Datoo Tumungong under its protection and alliance.',
  'Third. In return, the Honourable Company will pay the Datoo Tumungong the sum of three thousand Spanish dollars every year, for as long as the Factory stands.',
  'Fourth. These articles are agreed by the Datoo Tumungong for himself and on behalf of the Sultan of Johor, and all matters in them shall be settled when the Sultan arrives at Singapoora.',
].join('\n\n')

const INSTRUCTIONS_BODY = [
  'Fort William, November 1818.',
  'Sir, the Governor General in Council authorises you to proceed to the southern entrance of the Straits of Malacca and there to secure a station for the protection of the Company\'s trade with China.',
  'His Lordship is anxious that the object be attained without giving offence. You will therefore be careful to avoid any collision with the Dutch, who are now extending their authority over Riau, and you will not proceed to any place where they have already established themselves.',
  'Should it appear that a settlement cannot be made without dispute, you will report and await further orders.',
].join('\n\n')

const RIAU_LETTER_BODY = [
  'From the court at Riau, to the Datoo Tumungong at Singapoora, greeting.',
  'It is known to all that Sultan Abdul Rahman sits upon the throne of Johor, chosen by the will of his late father and acknowledged by our friends the Hollanders. The Datoo Tumungong holds Singapoora as a servant of that throne, and has no authority to receive foreigners or to give away any part of the Sultan\'s land.',
  'Let him remember whose servant he is, and send the English away.',
].join('\n\n')

const TREATY_BODY = [
  'Article 2nd. … the said Company further agree to afford their protection to His Highness aforesaid as long as he may continue to reside in the immediate vicinity of the places subject to their authority. It is however clearly explained to, and understood by His Highness, that the English Government in entering into this Alliance and in thus engaging to afford protection to His Highness is to be considered in no way bound to interfere with the internal politics of his States or engaged to assert or maintain the authority of His Highness by force of Arms.',
  'Article 8. The port of Singapoora is to be considered under the immediate protection and subject to the Regulation of the British Authorities.',
  'Article 9. With regard to the Duties which it may hereafter be deemed necessary to levy on Goods, Merchandize, Boats or Vessels, His Highness Datoo Tumungong Sree Maharajah Abdul Rahman is to be entitled to a moiety or full half of all the amounts collected from native Vessels.',
].join('\n\n')

const PROCLAMATION_BODY = [
  'Proclamation of the court of Riau, in the name of Sultan Abdul Rahman Muadzam Shah of Johor.',
  'Be it known in every river and island of the kingdom that Sultan Abdul Rahman was installed upon the throne by the great men of the kingdom, and is acknowledged by the Governor of the Hollanders at Malacca. Whoever calls another man Sultan is a rebel against the throne.',
  'Tengku Long, called Hussein, the elder son, is a private man and holds no office. No treaty he signs binds the kingdom.',
].join('\n\n')

const documents = [
  document({
    id: 'doc-prelim',
    kind: 'treaty',
    title: 'Draft articles of agreement',
    provenance: { date: '30 January 1819', place: 'Singapoora' },
    body: PRELIM_BODY,
    real: false,
    sourceLabel: INVENTED,
    glossary: [
      { term: 'Factory', meaning: 'a trading post run by merchants, not a place that makes goods' },
      { term: 'Datoo Tumungong', meaning: 'the title Dato\' Temenggong, a senior Malay chief' },
    ],
    keyPassages: [{ id: 'kp-prelim-settled', text: 'on behalf of the Sultan of Johor, and all matters in them shall be settled when the Sultan arrives at Singapoora' }],
  }),
  document({
    id: 'doc-instructions',
    kind: 'letter',
    title: 'Instructions from Calcutta',
    provenance: { sender: 'Secretary to the Government, Fort William', recipient: 'Sir T. S. Raffles', date: 'November 1818' },
    body: INSTRUCTIONS_BODY,
    real: false,
    sourceLabel: INVENTED,
    keyPassages: [{ id: 'kp-instructions-dutch', text: 'You will therefore be careful to avoid any collision with the Dutch' }],
  }),
  document({
    id: 'doc-riau-letter',
    kind: 'letter',
    title: 'A letter from Riau',
    provenance: { sender: 'The court at Riau', recipient: 'The Datoo Tumungong', date: 'January 1819' },
    body: RIAU_LETTER_BODY,
    real: false,
    sourceLabel: INVENTED,
    keyPassages: [{ id: 'kp-riau-authority', text: 'has no authority to receive foreigners or to give away any part of the Sultan\'s land' }],
  }),
  document({
    id: 'doc-treaty',
    kind: 'treaty',
    title: 'Treaty of Friendship and Alliance (draft for signing)',
    provenance: { date: 'February 1819', place: 'Singapoora' },
    body: TREATY_BODY,
    real: true,
    sourceLabel: TREATY,
    citations: [{ sourceId: 'src-treaty' }],
    glossary: [
      { term: 'moiety', meaning: 'a half share' },
      { term: 'His Highness', meaning: 'in Article 2, the Sultan' },
    ],
    keyPassages: [
      { id: 'kp-treaty-force', text: 'is to be considered in no way bound to interfere with the internal politics of his States or engaged to assert or maintain the authority of His Highness by force of Arms' },
      { id: 'kp-treaty-duties', text: 'is to be entitled to a moiety or full half of all the amounts collected from native Vessels' },
    ],
  }),
  document({
    id: 'doc-proclamation',
    kind: 'speech',
    title: 'Proclamation of the Riau court',
    provenance: { sender: 'The court of Riau', date: 'February 1819', place: 'Riau' },
    body: PROCLAMATION_BODY,
    real: false,
    sourceLabel: INVENTED,
    keyPassages: [{ id: 'kp-proclamation-dutch', text: 'is acknowledged by the Governor of the Hollanders at Malacca' }],
  }),
]

// ---------------------------------------------------------------------------------------------------------------
// Interview for each ending
// ---------------------------------------------------------------------------------------------------------------

const CLERK = 'A Company clerk at Singapore, 1824'

const golden = {
  id: 'golden-1819',
  title: 'Singapore, 1819',
  readingLevel: 'sec',
  timer: { enabled: true, stageMinutes: [15, 15] },
  role: {
    name: 'Ahmad',
    position: 'a Malay interpreter from Malacca, travelling with the East India Company party',
    relationships: [
      'You interpreted for Major Farquhar for years while he was Resident of Malacca.',
      "Your mother's family trades along the Riau islands, so the Temenggong's people know your name.",
      'Raffles has hired you for this voyage; he does not know you well.',
    ],
    reputation: 'Both sides trust you a little, and neither trusts you completely.',
    stakes: 'Malacca has been handed back to the Dutch, and your work there has gone with it. If a British post is founded here, you have a future; if it fails, you have nothing.',
    privateBrief: {
      goals: ['See a British post founded at Singapore', 'Keep the trust of both the British and the Malay chiefs'],
      fears: ['Being blamed by either side if the talks collapse', 'Angering the court at Riau, where your family trades'],
      constraints: ['You speak for others: you cannot promise anything in your own name'],
      knows: [
        'The Temenggong governs Singapore and its people.',
        'The Dutch have returned to Malacca and Java and are extending their power over Riau.',
        'Raffles is in a hurry.',
      ],
    },
    situation:
      'Late January 1819. Company ships have anchored off the mouth of the Singapore River. Raffles wants a trading post here, and you are the one who will carry his words to the Malay chiefs, and theirs to him.',
  },
  stages: [
    {
      id: 's1',
      title: 'The landing',
      timePlace: 'The Singapore River, 29–30 January 1819',
      centralQuestion: 'Will the Temenggong let the Company stay, and on whose authority?',
      openingNarration:
        'Raffles has landed near the mouth of the river with Major Farquhar. Upriver, the Temenggong waits in his compound to learn what the British want. Raffles wants an answer within a day.',
      rooms: [
        { id: 'landing', name: 'The landing', description: 'A strip of beach by the river mouth, where the Company party has pitched its tents.' },
        { id: 'balai', name: "The Temenggong's balai", description: "The Temenggong's audience hall, a raised timber hall a short walk upriver." },
        { id: 'moorings', name: 'The Orang Laut moorings', description: 'Boats drawn up along the river bank, where the sea people live.' },
      ],
      startRoomId: 'landing',
      placement: { raffles: 'landing', temenggong: 'balai', batin: 'moorings' },
      documentPlacement: { 'doc-prelim': 'balai', 'doc-riau-letter': 'balai' },
      situations: [],
      definingMomentId: 'm1',
    },
    {
      id: 's2',
      title: 'The disputed throne',
      timePlace: 'Singapore, 1–6 February 1819',
      centralQuestion: 'Whose authority will make the treaty lawful?',
      openingNarration:
        'The Temenggong signed the preliminary articles and sent for Tengku Hussein, who has now arrived from Riau. Raffles must sail for Bencoolen within the week, and everyone is watching to see whom he will recognise.',
      rooms: [
        { id: 'landing', name: 'The landing', description: 'The Company tents, now with a flagstaff and a table for papers.' },
        { id: 'balai', name: "The Temenggong's balai", description: "The Temenggong's audience hall upriver." },
        { id: 'lodging', name: "Tengku Hussein's lodging", description: 'A borrowed house near the balai, still half empty.' },
      ],
      startRoomId: 'landing',
      placement: { raffles: 'landing', farquhar: 'landing', temenggong: 'balai', messenger: 'balai', hussein: 'lodging' },
      documentPlacement: { 'doc-treaty': 'landing', 'doc-proclamation': 'balai' },
      situations: [
        {
          whenOutcome: { momentId: 'm1', outcomeId: 'o1-alone' },
          stances: { temenggong: 't2' },
          openingNarration:
            'The Temenggong has signed, and now tells everyone that the island is his to grant. Farquhar has quietly brought Tengku Hussein from Riau anyway. Raffles must sail within the week, and wonders whether one chief\'s mark is enough.',
        },
        {
          whenOutcome: { momentId: 'm1', outcomeId: 'o1-delays' },
          stances: { temenggong: 't1' },
          openingNarration:
            'The Temenggong has not signed. A boat has gone to Riau, and nobody knows what it will bring back. Farquhar has brought Tengku Hussein to Singapore on his own account. Raffles must sail within the week.',
        },
      ],
      definingMomentId: 'm2',
    },
  ],
  characters: [
    {
      id: 'temenggong',
      name: 'Temenggong Abdul Rahman',
      title: 'Temenggong of Johor, chief of Singapore',
      real: true,
      tier: 'major',
      persona: {
        voice: "Courteous and unhurried, with a trader's eye for the price of things. Answers a question with a question when it suits him. Speaks of 'my people' and 'my lord the Sultan'.",
        phrases: [],
        knewThen: 'the politics of Johor, Riau and the Straits up to early 1819, the people of the island, and the British only from their reputation at Malacca and Penang',
        wantsFromStudent: 'to learn what the British will really pay and whether they will truly protect him from Riau and the Dutch',
        withholds: ['how much he fears the court at Riau and its Bugis chiefs'],
        publicPosition: 'He governs Singapore and its people on behalf of the Sultan of Johor, and has lived here with his followers for some years.',
        privateAgenda: 'Secure an income and protection for himself and his followers without being caught between the British and the Dutch.',
      },
      stances: [
        stance('t1', 'wary', 'polite but closed; measures every word and gives little away'),
        stance('t2', 'bargaining', 'interested and shrewd; willing to talk terms if the price is right'),
        stance('t3', 'trusting', 'warm; speaks to Ahmad as someone who understands his position'),
        stance('t4', 'confiding', 'frank and personal; shares his fears as to a trusted friend', true),
      ],
      initialStanceId: 't1',
      slants: [{ id: 'slant-temenggong', claim: 'The island and its waters are mine to dispose of as I see fit.', contradictedBy: ['d1-riau-claim'] }],
      trustNotice: 'The Temenggong looks at you a little more coolly.',
    },
    {
      id: 'raffles',
      name: 'Sir Thomas Stamford Raffles',
      title: 'Lieutenant-Governor of Bencoolen, agent of the Governor-General',
      real: true,
      tier: 'major',
      persona: {
        voice: 'Quick, eager and persuasive. Talks of commerce, the Dutch and the future of the East. Impatient with delay, and used to getting his way with words.',
        phrases: [{ text: 'a great commercial emporium', sourceLabel: 'Raffles to Colonel Addenbrooke, 10 June 1819 (JSBRAS vol. 2, 1878)' }],
        knewThen: 'Company policy, the return of Java and Malacca to the Dutch, the disputed Johor succession as Farquhar reported it, and his instructions from Calcutta, up to early 1819',
        wantsFromStudent: 'to carry his offer to the Malay chiefs in its best light, and to tell him honestly what they want',
        withholds: ['that his instructions from Calcutta tell him to avoid any quarrel with the Dutch'],
        publicPosition: 'He has come to found a British station at the southern end of the Straits of Malacca to protect the China trade.',
        privateAgenda: 'Found a free port here before the Dutch can stop him, even if it stretches his cautious instructions.',
      },
      stances: [
        stance('r1', 'impatient', 'brisk and a little dismissive; treats Ahmad as a tool to be used'),
        stance('r2', 'calculating', 'attentive; listens because Ahmad clearly knows things he does not'),
        stance('r3', 'confiding', 'open about his larger plans and his worries about Calcutta'),
      ],
      initialStanceId: 'r1',
      slants: [{ id: 'slant-raffles', claim: 'The island is almost empty; nobody here will lose by a British post.', contradictedBy: ['d1-inhabitants'] }],
      trustNotice: 'Raffles gives you a long, doubtful look.',
    },
    {
      id: 'batin',
      name: 'The batin of the Orang Laut',
      title: 'Headman of a sea people community on the river',
      real: false,
      tier: 'minor',
      persona: {
        voice: 'Plain-spoken and wry, a man of boats and tides. Short sentences; little patience for great men.',
        phrases: [],
        knewThen: 'the river, the sea lanes, the people of the island and the Temenggong\'s household',
        wantsFromStudent: 'to know whether the British will drive his people off their moorings',
        withholds: [],
        publicPosition: 'He leads one of the Orang Laut communities who live on boats along the river and the islands.',
        privateAgenda: 'Keep his people\'s moorings and fishing whoever rules the island.',
      },
      stances: [],
      initialStanceId: null,
      slants: [],
    },
    {
      id: 'hussein',
      name: 'Tengku Hussein',
      title: 'Elder son of the late Sultan Mahmud of Johor',
      real: true,
      tier: 'major',
      persona: {
        voice: 'Proud and wounded, careful of his dignity. Speaks formally, and returns again and again to what was taken from him.',
        phrases: [],
        knewThen: 'the Johor succession of 1812, life in Riau, and what the Temenggong\'s messengers told him of the British',
        wantsFromStudent: 'to learn whether the British will truly make him Sultan, and what they will give him',
        withholds: ['that he has lived poorly in Riau and needs an income'],
        publicPosition: 'He is the elder son of Sultan Mahmud, passed over for the throne in 1812.',
        privateAgenda: 'Be recognised as Sultan and secure a living worthy of the title.',
      },
      stances: [
        stance('h1', 'bitter', 'guarded and resentful; expects to be used and forgotten again'),
        stance('h2', 'hopeful', 'cautiously hopeful; begins to treat Ahmad as an ally'),
        stance('h3', 'resolved', 'decided and dignified; ready to act if his terms are met'),
      ],
      initialStanceId: 'h1',
      slants: [{ id: 'slant-hussein', claim: 'Once the British name me Sultan, they will keep me on my throne, by force if they must.', contradictedBy: ['d2-no-force'] }],
      trustNotice: 'Tengku Hussein draws back into himself.',
    },
    {
      id: 'farquhar',
      name: 'Major William Farquhar',
      title: 'Former Resident of Malacca',
      real: true,
      tier: 'minor',
      persona: {
        voice: 'Steady, practical and a little weary of Raffles\'s haste. Knows the Malay courts well and says so.',
        phrases: [],
        knewThen: 'the Malay courts of the Straits and the Dutch in Malacca, from many years as Resident',
        wantsFromStudent: 'help keeping the Malay chiefs on good terms once Raffles has sailed',
        withholds: [],
        publicPosition: 'He was Resident of Malacca until it was returned to the Dutch, and is to command the new post.',
        privateAgenda: 'Make sure the post can be held after Raffles leaves.',
      },
      stances: [],
      initialStanceId: null,
      slants: [],
    },
    {
      id: 'messenger',
      name: 'A messenger from Riau',
      title: 'Envoy of the Riau court',
      real: false,
      tier: 'minor',
      persona: {
        voice: 'Smooth and superior, a courtier in a hurry to be gone.',
        phrases: [],
        knewThen: 'the Riau court\'s view of the succession and the Dutch alliance',
        wantsFromStudent: 'to learn what the British intend for Tengku Hussein',
        withholds: [],
        publicPosition: 'He has come from Riau to remind the Temenggong whom he serves.',
        privateAgenda: 'Report back everything he learns about Hussein and the British.',
      },
      stances: [],
      initialStanceId: null,
      slants: [
        {
          id: 'slant-messenger',
          claim: 'Sultan Abdul Rahman was chosen by his late father\'s wish; there has never been any dispute.',
          contradictedBy: ['d1-throne'],
          unlocksDiscoveryId: 'd2-bugis',
        },
      ],
    },
  ],
  discoveries: [
    // Stage 1
    { id: 'd1-not-sovereign', stageId: 's1', holder: { characterId: 'temenggong' }, core: true, sourceLabel: TEACHER, citations: [cite('src-handout', HANDOUT.notSovereign)], text: 'The Temenggong governs Singapore for the Sultan of Johor, but he is not the sovereign: only the Sultan can lawfully grant land to the Company.', note: 'The Temenggong rules here for the Sultan of Johor. Only the Sultan can grant the British land.' },
    { id: 'd1-throne', stageId: 's1', holder: { characterId: 'temenggong' }, core: true, sourceLabel: TEACHER, citations: [cite('src-handout', HANDOUT.younger), cite('src-handout', HANDOUT.elder)], topic: 'the Johor succession', condition: { stanceAtLeast: { characterId: 'temenggong', stanceId: 't2' } }, text: 'The Johor throne is disputed: when Sultan Mahmud died in 1812, his younger son Abdul Rahman was installed with Bugis support, and later recognised by the Dutch, while the elder son, Tengku Hussein, was away and passed over.', note: 'The Johor throne is disputed. The younger son was made Sultan with Bugis support; the elder, Tengku Hussein, was passed over.' },
    { id: 'd1-riau-fear', stageId: 's1', holder: { characterId: 'temenggong' }, core: false, sourceLabel: INVENTED, topic: 'his fears about Riau', condition: { stanceAtLeast: { characterId: 'temenggong', stanceId: 't3' } }, text: 'The Temenggong fears that the Riau court and the Dutch will punish him for dealing with the British.', note: 'The Temenggong is afraid Riau and the Dutch will punish him for this.' },
    { id: 'd1-free-port', stageId: 's1', holder: { characterId: 'raffles' }, core: false, sourceLabel: TEACHER, text: 'Raffles means to make Singapore a free port, where ships can trade without paying duties, to draw traders from across the region.', note: 'Raffles wants a free port here, with no duties, to pull in traders from everywhere.' },
    { id: 'd1-inhabitants', stageId: 's1', holder: { characterId: 'batin' }, core: false, sourceLabel: INFOPEDIA, citations: [cite('src-nlb', 'In January 1819, just a month before the treaty was signed, Singapore had approximately 1,000 inhabitants.')], text: 'About a thousand people already live on and around the island, most of them Orang Laut such as the Orang Kallang, Orang Seletar and Orang Gelam, with some Malays and a few Chinese planters.', note: 'About a thousand people already live here, mostly Orang Laut, with some Malays and Chinese planters.' },
    { id: 'd1-agreement', stageId: 's1', holder: { documentId: 'doc-prelim', keyPassageId: 'kp-prelim-settled' }, core: true, sourceLabel: TREATY, citations: [cite('src-treaty', 'for himself and for Sultan Hussein Mahummed Shah Sultan of Johor')], text: 'The preliminary agreement is made by the Temenggong for himself and on behalf of the Sultan of Johor, and leaves it to be confirmed when the Sultan arrives.', note: 'The draft agreement is only on the Sultan\'s behalf: it still has to be settled when a Sultan arrives.' },
    { id: 'd1-calcutta', stageId: 's1', holder: { documentId: 'doc-instructions', keyPassageId: 'kp-instructions-dutch' }, core: false, sourceLabel: TEACHER, text: 'Raffles\'s instructions from Calcutta tell him to found a post at the southern end of the Straits but to avoid any collision with the Dutch.', note: 'Calcutta told Raffles to avoid any clash with the Dutch.' },
    { id: 'd1-riau-claim', stageId: 's1', holder: { documentId: 'doc-riau-letter', keyPassageId: 'kp-riau-authority' }, core: false, sourceLabel: TEACHER, text: 'The Riau court says the Temenggong is only a servant of Sultan Abdul Rahman and has no authority to give away any of the Sultan\'s land.', note: 'Riau says the Temenggong is only the Sultan\'s servant and cannot give away land.' },
    // Stage 2
    { id: 'd2-hussein-claim', stageId: 's2', holder: { characterId: 'hussein' }, core: true, sourceLabel: TEACHER, citations: [cite('src-handout', HANDOUT.elder), cite('src-handout', HANDOUT.recognised)], text: 'Tengku Hussein, the elder son passed over in 1812, claims the throne of Johor and wants to be recognised as its Sultan.', note: 'Tengku Hussein says the throne is his by right, and wants to be recognised as Sultan.' },
    { id: 'd2-hussein-needs', stageId: 's2', holder: { characterId: 'hussein' }, core: false, sourceLabel: TEACHER, topic: 'how he has been living', condition: { stanceAtLeast: { characterId: 'hussein', stanceId: 'h2' } }, text: 'Hussein has been living in obscurity in Riau and needs an income and protection if he is to live as a Sultan.', note: 'Hussein has been living quietly in Riau. He needs money and protection to live as Sultan.' },
    { id: 'd2-raffles-plan', stageId: 's2', holder: { characterId: 'raffles' }, core: true, sourceLabel: TEACHER, citations: [cite('src-handout', HANDOUT.view)], topic: 'whom he means to recognise', condition: { stanceAtLeast: { characterId: 'raffles', stanceId: 'r2' } }, text: 'Raffles believes Hussein, as the elder son, has the stronger claim, and means to recognise him as Sultan so that a ruler of Johor signs the treaty.', note: 'Raffles plans to recognise Hussein as Sultan, so a ruler of Johor signs the treaty.' },
    { id: 'd2-dutch-protest', stageId: 's2', holder: { characterId: 'farquhar' }, core: false, sourceLabel: TEACHER, text: 'Farquhar expects the Dutch to protest, because they recognise Sultan Abdul Rahman as the only lawful ruler of Johor and treat Singapore as theirs to watch over.', note: 'Farquhar is sure the Dutch will protest: they say Abdul Rahman is the only lawful Sultan.' },
    { id: 'd2-bugis', stageId: 's2', holder: { characterId: 'messenger' }, core: false, sourceLabel: TEACHER, condition: { slantConfronted: 'slant-messenger' }, text: 'The messenger admits that Abdul Rahman was made Sultan with the support of the powerful Bugis party at court while Hussein was away.', note: 'The Riau messenger admitted the Bugis party at court put Abdul Rahman on the throne.' },
    { id: 'd2-no-force', stageId: 's2', holder: { documentId: 'doc-treaty', keyPassageId: 'kp-treaty-force' }, core: true, sourceLabel: TREATY, citations: [cite('src-treaty', 'is to be considered in no way bound to interfere with the internal politics of his States or engaged to assert or maintain the authority of His Highness by force of Arms')], text: 'The treaty promises the Sultan protection, but says the British are not bound to interfere in Johor\'s politics or to uphold his authority by force.', note: 'The treaty protects the Sultan, but the British will not fight to keep him on his throne.' },
    { id: 'd2-duties', stageId: 's2', holder: { documentId: 'doc-treaty', keyPassageId: 'kp-treaty-duties' }, core: false, sourceLabel: TREATY, text: 'Under the treaty, the Temenggong is to receive half of all the duties collected from native vessels.', note: 'The Temenggong would get half of the duties paid by native boats.' },
    { id: 'd2-riau-claim', stageId: 's2', holder: { documentId: 'doc-proclamation', keyPassageId: 'kp-proclamation-dutch' }, core: false, sourceLabel: TEACHER, text: 'The Riau court proclaims Abdul Rahman the only lawful Sultan, acknowledged by the Dutch.', note: 'Riau proclaims Abdul Rahman the only Sultan, backed by the Dutch.' },
  ],
  documents,
  triggers: [
    { id: 'tr-temenggong-slant', characterId: 'temenggong', on: { slantConfronted: 'slant-temenggong' }, effect: { stanceDelta: 1 }, notice: 'The Temenggong is silent for a long moment.' },
    { id: 'tr-temenggong-freeport', characterId: 'temenggong', on: { notePassed: 'd1-free-port' }, requires: { stanceAtLeast: { characterId: 'temenggong', stanceId: 't2' } }, effect: { stanceDelta: 1 }, notice: "The Temenggong's eyes go to the river, and the boats on it." },
    { id: 'tr-temenggong-calcutta', characterId: 'temenggong', on: { notePassed: 'd1-calcutta' }, requires: { stanceIs: { characterId: 'temenggong', stanceId: 't3' } }, effect: { toStance: 't4' }, notice: 'The Temenggong leans close and lowers his voice.' },
    { id: 'tr-temenggong-duties', characterId: 'temenggong', on: { notePassed: 'd2-duties' }, effect: { stanceDelta: 1 }, notice: 'The Temenggong allows himself a small smile.' },
    { id: 'tr-raffles-slant', characterId: 'raffles', on: { slantConfronted: 'slant-raffles' }, effect: { stanceDelta: 1 }, handsOver: ['doc-instructions'], notice: 'Raffles looks at you properly for the first time.' },
    { id: 'tr-raffles-throne', characterId: 'raffles', on: { notePassed: 'd1-throne' }, effect: { stanceDelta: 1 }, notice: 'Raffles stops pacing.' },
    { id: 'tr-raffles-hussein', characterId: 'raffles', on: { notePassed: 'd2-hussein-claim' }, effect: { stanceDelta: 1 }, notice: 'Raffles nods slowly, as if a piece has fallen into place.' },
    { id: 'tr-hussein-slant', characterId: 'hussein', on: { slantConfronted: 'slant-hussein' }, effect: { stanceDelta: 1 }, notice: "Tengku Hussein's face falls, then hardens." },
    { id: 'tr-hussein-plan', characterId: 'hussein', on: { notePassed: 'd2-raffles-plan' }, effect: { stanceDelta: 1 }, notice: 'Tengku Hussein straightens.' },
  ],
  definingMoments: [
    {
      id: 'm1',
      stageId: 's1',
      deciderId: 'temenggong',
      scene: 'In the balai, Raffles waits with the draft articles. Before he answers, the Temenggong turns to you. "Tell me plainly what this paper means for me."',
      nudge: 'Raffles mutters to you in English: "Do we even know whose land this is to give?"',
      finalCallNarration: 'A runner comes from the balai: the Temenggong will give Raffles his answer now.',
      acts: [
        { id: 'a1-faithful', text: 'Translate the articles faithfully: a post, a yearly payment, and the matter left for the Sultan to settle.', reaction: 'The Temenggong listens without moving. "Plain words. Good."' },
        { id: 'a1-protection', text: 'Stress that the Company will protect him against Riau and the Dutch.', reaction: 'The Temenggong glances downriver. "Protection is a long word, interpreter."' },
        { id: 'a1-warn', text: 'Warn him that without a Sultan\'s seal, his mark on this paper may not hold.', reaction: 'Raffles stiffens. The Temenggong smiles thinly. "So you understand our troubles."' },
        { id: 'a1-deceive', text: 'Tell him the British will make him master of the island in his own right.', deception: true, reaction: 'The Temenggong\'s eyebrows rise. Raffles, who does not follow the Malay, nods along.' },
      ],
      outcomes: [
        { id: 'o1-sends', summary: 'The Temenggong signed the preliminary articles and sent for Tengku Hussein.', predictionText: 'He will sign, and send for Tengku Hussein.', because: 'he understood that only a Sultan could make the grant lawful, and he trusted your account of the offer', closesEndingIds: [], historical: true },
        { id: 'o1-alone', summary: 'The Temenggong signed, but insisted the island was his alone to grant.', predictionText: 'He will sign, as master of the island.', because: 'he was promised more than the articles offered, and saw no need for a Sultan', closesEndingIds: ['e-wait'] },
        { id: 'o1-delays', summary: 'The Temenggong would not sign, and sent to Riau for word.', predictionText: 'He will wait for word from Riau.', because: 'he did not yet trust the British, and feared what Riau would do', closesEndingIds: ['e-alone'] },
      ],
      rules: [
        { actId: 'a1-faithful', when: { stanceAtLeast: { characterId: 'temenggong', stanceId: 't2' } }, outcomeId: 'o1-sends' },
        { actId: 'a1-faithful', outcomeId: 'o1-delays' },
        { actId: 'a1-protection', when: { stanceAtLeast: { characterId: 'temenggong', stanceId: 't3' } }, outcomeId: 'o1-sends' },
        { actId: 'a1-protection', outcomeId: 'o1-alone' },
        { actId: 'a1-warn', when: { discovered: 'd1-throne' }, outcomeId: 'o1-sends' },
        { actId: 'a1-warn', outcomeId: 'o1-delays' },
        { actId: 'a1-deceive', outcomeId: 'o1-alone' },
      ],
    },
    {
      id: 'm2',
      stageId: 's2',
      deciderId: 'raffles',
      scene: 'Raffles must sail for Bencoolen tomorrow. In his tent, by lamplight, he pushes the draft treaty towards you. "You have heard them all, Ahmad. On whose authority do I sign?"',
      nudge: 'Farquhar says quietly: "Have you heard what Tengku Hussein himself wants?"',
      finalCallNarration: 'The tide will turn at dawn. Raffles sends for you: he wants your advice tonight.',
      acts: [
        { id: 'a2-recognise', text: 'Advise him to recognise Tengku Hussein as Sultan and sign with him and the Temenggong.', reaction: 'Raffles exhales. "Then Hussein it is." Farquhar looks at the floor.' },
        { id: 'a2-calcutta', text: 'Advise him to wait for orders from Calcutta before signing anything.', reaction: 'Raffles drums his fingers on the table. "Calcutta is months away, Ahmad."' },
        { id: 'a2-alone', text: 'Advise him to sign with the Temenggong alone.', reaction: '"Alone?" Raffles frowns at the draft. "And when Riau says he had no right?"' },
        {
          id: 'a2-people',
          text: 'Advise him to have the island\'s own people named in the treaty, and their moorings protected.',
          reaction: 'Raffles is quiet for a long moment. "The Orang Laut? No one has asked that before."',
          secret: {
            unlock: [{ stanceIs: { characterId: 'temenggong', stanceId: 't4' } }, { slantConfronted: 'slant-raffles' }, { discovered: 'd1-riau-fear' }],
            minMet: 2,
          },
        },
      ],
      outcomes: [
        { id: 'o2-treaty', summary: 'Raffles recognised Hussein as Sultan, and on 6 February the treaty was signed.', predictionText: 'He will recognise Hussein and sign the treaty.', because: 'the Temenggong could not grant land alone, and Hussein would sign only as Sultan', closesEndingIds: [], endingId: 'e-historical', historical: true },
        { id: 'o2-wait', summary: 'Raffles waited for orders, and the post stalled while the Dutch pressed their claim.', predictionText: 'He will wait for orders from Calcutta.', because: 'his instructions told him to avoid any collision with the Dutch', closesEndingIds: [], endingId: 'e-wait' },
        { id: 'o2-alone', summary: 'Raffles signed with the Temenggong alone, on a grant the Temenggong could not lawfully make.', predictionText: 'He will sign with the Temenggong alone.', because: 'he trusted one chief\'s mark over the claims of the throne', closesEndingIds: [], endingId: 'e-alone' },
        { id: 'o2-people', summary: 'The treaty was signed with Hussein and the Temenggong, and also named the island\'s own people and protected their moorings.', predictionText: 'He will name the island\'s people in the treaty.', because: 'the Temenggong had confided his fears, and Raffles had been shown the island was not empty', closesEndingIds: [], endingId: 'e-secret', secret: true },
      ],
      rules: [
        { actId: 'a2-recognise', outcomeId: 'o2-treaty' },
        { actId: 'a2-calcutta', outcomeId: 'o2-wait' },
        { actId: 'a2-alone', outcomeId: 'o2-alone' },
        { actId: 'a2-people', outcomeId: 'o2-people' },
      ],
    },
  ],
  endings: [
    {
      id: 'e-historical',
      type: 'historical',
      title: 'The treaty of 6 February',
      summary: 'Raffles recognised Tengku Hussein as Sultan Hussein Shah of Johor. On 6 February 1819 the Company, the Sultan and the Temenggong signed a treaty allowing a British trading post, with yearly allowances of 5,000 Spanish dollars to the Sultan and 3,000 to the Temenggong.',
      epilogue: 'Your simulation, 6 February 1819. Under an awning by the river, Raffles, Sultan Hussein and the Temenggong put their seals to the treaty while the island\'s people watch from the bank. The Union flag goes up. Raffles sails the next morning, leaving Farquhar in charge. You translated every line.',
      interview: {
        interviewer: CLERK,
        question: 'You were there in 1819. Was the treaty fair to the people already living on the island?',
        verdicts: [
          { id: 'v-fair', text: 'Yes: the rulers were paid, protected, and kept a share of the trade.', counterPoints: ['d1-inhabitants', 'd2-no-force'] },
          { id: 'v-unfair', text: 'No: the island\'s people were never asked.', counterPoints: ['d2-duties', 'd1-agreement'] },
          { id: 'v-partly', text: 'Only partly: the rulers gained, but the island\'s people had no say.', counterPoints: ['d2-no-force', 'd1-throne'] },
        ],
        generalCounter: 'Some would say no treaty of that time asked ordinary people anything, so "fair" is the wrong measure. What would you measure it by instead?',
      },
      sourceLabel: TEACHER,
      citations: [cite('src-handout', HANDOUT.recognised), cite('src-handout', HANDOUT.allowances)],
    },
    {
      id: 'e-wait',
      type: 'alternative',
      title: 'Waiting for Calcutta',
      summary: 'Raffles waited for orders. The Dutch and the Riau court pressed their claim, and the post was never properly founded.',
      epilogue: 'Your simulation, March 1819. The Company tents are still on the beach, but no treaty has been signed. A Dutch letter has arrived from Malacca protesting at the British presence. Raffles is gone, and Farquhar waits for orders that may never come.',
      interview: {
        interviewer: CLERK,
        question: 'The post at Singapore was never properly founded. Was waiting for Calcutta the right call?',
        verdicts: [
          { id: 'v-wait-right', text: 'Yes: it avoided a war with the Dutch.', counterPoints: ['d1-free-port', 'd2-raffles-plan'] },
          { id: 'v-wait-wrong', text: 'No: the chance was lost, and the Dutch moved in.', counterPoints: ['d1-calcutta', 'd2-dutch-protest'] },
          { id: 'v-wait-partly', text: 'It depended on whether a lawful ruler could be found.', counterPoints: ['d1-not-sovereign'] },
        ],
        generalCounter: 'Some would say a station founded against orders could never have lasted anyway. Does that change your view?',
      },
      sourceLabel: INVENTED,
    },
    {
      id: 'e-alone',
      type: 'alternative',
      title: 'One chief\'s word',
      summary: 'Raffles signed with the Temenggong alone. The Riau court and the Dutch declared the grant worthless, and the post rested on a promise the Temenggong could not lawfully make.',
      epilogue: 'Your simulation, February 1819. The Temenggong\'s mark is on the paper and the flag is up, but a proclamation from Riau calls the grant void. Farquhar doubles the guard. Nobody is sure the post will survive the year.',
      interview: {
        interviewer: CLERK,
        question: 'The Company built on one chief\'s word. Could that ever have held?',
        verdicts: [
          { id: 'v-alone-yes', text: 'Yes: the Temenggong ruled the island in practice.', counterPoints: ['d1-not-sovereign', 'd1-agreement'] },
          { id: 'v-alone-no', text: 'No: without a Sultan, the grant had no lawful basis.', counterPoints: ['d2-duties'] },
          { id: 'v-alone-partly', text: 'Only if the Dutch and Riau did nothing about it.', counterPoints: ['d2-dutch-protest'] },
        ],
        generalCounter: 'Some would say power on the ground matters more than paper. What do you make of that?',
      },
      sourceLabel: INVENTED,
    },
    {
      id: 'e-secret',
      type: 'secret',
      title: 'The island\'s own people',
      summary: 'The treaty was signed with Sultan Hussein and the Temenggong, and also named the Orang Laut and the island\'s other people, with their moorings protected. History did not take this path.',
      epilogue: 'Your simulation, 6 February 1819. The treaty is signed as history records, but with one more article: the sea people\'s moorings are named and protected. The batin watches the signing from his boat and, for once, nods.',
      interview: {
        interviewer: CLERK,
        question: 'Your treaty named the island\'s own people. Did that make it fair?',
        verdicts: [
          { id: 'v-secret-yes', text: 'Yes: everyone who lived here was counted.', counterPoints: ['d2-no-force'] },
          { id: 'v-secret-no', text: 'No: they were named, but still not asked.', counterPoints: ['d1-inhabitants'] },
          { id: 'v-secret-partly', text: 'Fairer, but only as fair as the British chose to keep it.', counterPoints: ['d2-duties'] },
        ],
        generalCounter: 'Some would say a protection written by the stronger party is only as good as their will to keep it. Do you agree?',
      },
      sourceLabel: INVENTED,
    },
  ],
  reveal: {
    whatHappened:
      'On 30 January 1819 the Temenggong signed preliminary articles allowing a Company trading post. He sent for Tengku Hussein, who arrived from Riau in early February. Raffles recognised Hussein as Sultan Hussein Shah of Johor, and on 6 February 1819 the Company, the Sultan and the Temenggong signed the treaty. The Sultan received 5,000 Spanish dollars a year and the Temenggong 3,000. Raffles sailed the next day, leaving Farquhar as Resident.',
    interpretations: [
      'For a long time, 1819 was told as the moment Raffles "founded" Singapore. Many historians now stress that Singapore had been a trading port centuries earlier, and that the Malay chiefs made their own choices for their own reasons.',
      'Some see the treaty as a clever use of a disputed succession by the British; others see Hussein and the Temenggong as rulers who used the British to win a throne and an income.',
    ],
    corrections: [
      'Raffles later wrote that the spot had been "a wilderness and without inhabitant" (letter to Colonel Addenbrooke, 10 June 1819). In fact about a thousand people lived on and around the island in January 1819, most of them Orang Laut.',
      'The Riau court\'s claim that there was never any dispute was one-sided: Abdul Rahman was installed with Bugis support while his elder brother was away.',
      'Hussein\'s hope that the British would keep him on his throne by force was not what the treaty said: Article 2 says the British were not bound to do so.',
    ],
    couldHaveGone: [
      'Had Raffles waited for orders, the Dutch might have occupied the island first: they protested at once, and the matter was only settled by the Anglo-Dutch Treaty of 1824.',
      'Had the Temenggong refused, Raffles had no other ruler on the island to deal with.',
    ],
  },
  sources: SOURCES,
  teacherQuestions: ['Who gained most from the treaty of 6 February 1819, and who gained least? Use evidence from the game.'],
  storyEvents: [
    { id: 'se1-summons', stageId: 's1', when: { atSeconds: 300 }, effect: 'summons', characterId: 'raffles', text: 'A sailor runs up the bank: "Sir Stamford wants his interpreter at the landing."' },
    { id: 'se1-boat', stageId: 's1', when: { condition: { discovered: 'd1-riau-claim' } }, effect: 'news', text: 'Word passes along the river: a boat from Riau was seen at dawn.' },
    { id: 'se2-summons', stageId: 's2', when: { atSeconds: 240 }, effect: 'summons', characterId: 'hussein', text: 'A servant finds you: Tengku Hussein asks you to come to his lodging.' },
    { id: 'se2-dutch', stageId: 's2', when: { stuck: true }, effect: 'news', text: 'A trader from Malacca says the Dutch Governor is furious about the British landing.' },
  ],
}

const parsed = EngineSpec.parse(golden)
const out = resolve(import.meta.dirname, '../../../fixtures/golden-1819.json')
const json = `${JSON.stringify(golden, null, 2)}\n`
if (process.argv.includes('--check')) {
  const { readFileSync } = await import('node:fs')
  if (readFileSync(out, 'utf8') !== json) throw new Error('fixtures/golden-1819.json is out of date; run scripts/golden-1819.ts')
} else {
  writeFileSync(out, json)
  console.log(`wrote ${out}: ${parsed.stages.length} stages, ${parsed.discoveries.length} discoveries, ${parsed.documents.length} documents`)
}
