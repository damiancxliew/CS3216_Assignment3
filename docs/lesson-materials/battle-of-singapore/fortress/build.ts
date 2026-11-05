// Builds adventure.json for "The Fortress That Fell". All content is written here as data; the
// script only computes reading-highlight offsets from sentence numbers and captures the sources.
import fs from 'node:fs'
import { sourceSentenceSpans } from '../../../../packages/spec-v3/src/reading-support.ts'

const folder = new URL('.', import.meta.url).pathname
const pack = new URL('..', import.meta.url).pathname

// ---------- sources (the six teacher files, captured verbatim) ----------
const files: [string, string, string][] = [
  ['source-a', '01-defence-strategy.txt', 'https://www.navy.gov.au/about-navy/history/history-milestones/singapore-strategy-fall-singapore'],
  ['source-b', '02-campaign-in-malaya.txt', 'https://www.awm.gov.au/articles/blog/fall-of-singapore'],
  ['source-c', '03-invasion-of-the-island.txt', 'https://www.nlb.gov.sg/main/article-detail?cmsuuid=1afe9a7e-f0bd-4b11-9fe3-bb3aab31c3e8'],
  ['source-d', '04-surrender-conference.txt', 'https://biblioasia.nlb.gov.sg/all-sections/vol-20-issue-2-jul-sep-2024-men-surrender-singapore-japanese-occupation/'],
  ['source-e', '05-civilian-recollections.txt', 'https://corporate.nas.gov.sg/discover-archives/media/ww2comestosingapore/'],
  ['source-f', '06-explaining-japanese-success.txt', 'https://www.nids.mod.go.jp/publication/senshi/pdf/201603/09.pdf'],
]
const captured = files.map(([id, file, url]) => {
  const text = fs.readFileSync(pack + file, 'utf8')
  return { id, title: text.split('\n')[0]!.trim(), kind: 'text' as const, origin: 'teacher' as const, url, pages: [{ page: 1, text }] }
})
const sourceText = (id: string) => captured.find(s => s.id === id)!.pages[0]!.text
const cite = (sourceId: string, quote?: string) => {
  if (quote && !sourceText(sourceId).includes(quote)) throw Error(`Quote not in ${sourceId}: ${quote}`)
  return quote ? { sourceId, quote } : { sourceId }
}

// ---------- documents: body written as sentences; questions point at sentence numbers ----------
type Q = { prompt: string; correct: string; wrong: [string, string]; at: [number, number?]; also?: [number, number?][]; why: string; correctSlot: 0 | 1 | 2 }
type Doc = {
  id: string; kind: string; title: string; provenance: Record<string, string>; real: boolean; sourceLabel: string
  glossary: { term: string; meaning: string }[]; paragraphs: string[][]; key: [number, number?]; quote: [string, string]
  discovery: { id: string; stageId: string; text: string; note: string; core: boolean }
  questions: [Q, Q, Q, Q, Q] // four variants, then recovery
  recoveryFrom?: string[]
}

const docs: Doc[] = [
  {
    id: 'doc-fleet', kind: 'report', title: 'Where is the fleet?',
    provenance: { date: 'Student summary, written today', sender: 'History dossier' }, real: false,
    sourceLabel: 'Student summary of Source A (Royal Australian Navy history)',
    glossary: [{ term: 'naval base', meaning: 'A harbour where warships are repaired and supplied.' }, { term: 'fleet', meaning: 'A large group of warships.' }],
    paragraphs: [[
      'Singapore had a large naval base, built to repair and supply warships.',
      'British plans said a big fleet would sail to Singapore if Japan attacked.',
      'But when Japan attacked in December 1941, that fleet did not come.',
      'Only a small force was sent, including two big warships, Prince of Wales and Repulse.',
    ], [
      'On 10 December 1941, Japanese aircraft sank both ships off Malaya.',
      'A base without ships could not protect Singapore by itself.',
      'The sinking also showed how dangerous aircraft had become to warships.',
    ]],
    key: [4, 5], quote: ['source-a', 'Japanese aircraft sank both ships off Malaya on 10 December.'],
    discovery: { id: 'd-fleet', stageId: 's1', core: true,
      text: 'The fleet Britain promised never came, and on 10 December 1941 Japanese aircraft sank Prince of Wales and Repulse. A base without ships could not protect Singapore by itself.',
      note: 'No fleet came. Japanese planes sank the two big warships, so the naval base had no ships to protect Singapore.' },
    questions: [
      { prompt: 'What does this source suggest about the plan to defend Singapore?', correct: 'It depended on a fleet that never came.', wrong: ['It depended mainly on soldiers, not ships.', 'It worked until the base itself was captured.'], at: [1, 2], also: [[2], [1], [5]], correctSlot: 1, why: 'The plan needed a fleet to sail to Singapore, but that fleet did not come.' },
      { prompt: 'Why does the writer think the sinking of the two ships mattered?', correct: 'It showed aircraft could destroy big warships.', wrong: ['It showed the naval base was badly built.', 'It showed Britain had no warships left anywhere.'], at: [6], correctSlot: 0, why: 'The last sentence says the sinking showed how dangerous aircraft had become to warships.' },
      { prompt: 'A soldier in January 1942 says, "Don\'t worry, the navy will save us." Which part of the source challenges this?', correct: 'Japanese aircraft had already sunk the two big ships.', wrong: ['The naval base had been built to repair ships.', 'Britain had promised to send a fleet.'], at: [4, 5], also: [[4], [5], [2]], correctSlot: 2, why: 'The ships that could have helped were sunk in December, and a base without ships could not protect Singapore.' },
      { prompt: 'What can you infer about the naval base from this source?', correct: 'It was only useful if there were ships to use it.', wrong: ['It was useless and should never have been built.', 'It was the main reason the fleet stayed away.'], at: [5], also: [[4, 5]], correctSlot: 1, why: 'The source says a base without ships could not protect Singapore by itself. It does not say the base was useless.' },
      { prompt: 'Which statement matches the source?', correct: 'The promised fleet did not come when Japan attacked.', wrong: ['The fleet came, but arrived after the attack.', 'The fleet stayed in Singapore to guard the base.'], at: [2], also: [[1, 2]], correctSlot: 0, why: 'The source says that when Japan attacked in December 1941, the fleet did not come.' },
    ],
  },
  {
    id: 'doc-gemas', kind: 'report', title: 'They won at Gemas. So why retreat?',
    provenance: { date: 'Student summary, written today', sender: 'History dossier' }, real: false,
    sourceLabel: 'Student summary of Source B (Australian War Memorial)',
    glossary: [{ term: 'ambush', meaning: 'A surprise attack from a hidden position.' }, { term: 'air support', meaning: 'Aircraft helping soldiers on the ground.' }],
    paragraphs: [[
      'Japanese forces landed in northern Malaya on 8 December 1941.',
      'Britain was also fighting in Europe, so Malaya had too few tanks and aircraft.',
    ], [
      'Allied troops did win some fights.',
      'On 14 January 1942, Australian troops ambushed Japanese forces near Gemas.',
      'At Bakri, Australian units destroyed Japanese tanks.',
    ], [
      'But Japanese forces moved fast with air support, and often went around defended positions instead of attacking them from the front.',
      'So the defenders kept having to pull back south.',
      'By 31 January, the last of them had crossed into Singapore.',
    ]],
    key: [5, 6], quote: ['source-b', 'Japanese forces combined mobility with air support and often moved around defensive positions instead of attacking only from the front.'],
    discovery: { id: 'd-gemas', stageId: 's1', core: true,
      text: 'Allied troops won fights at Gemas and Bakri, but Japanese forces moved fast with air support and went around defended positions, so the defenders kept pulling back.',
      note: 'Winning a fight is not winning the campaign. The Japanese went around our positions, so we kept retreating.' },
    questions: [
      { prompt: 'Why did the Allies keep retreating even after winning at Gemas?', correct: 'The Japanese went around their positions.', wrong: ['The win at Gemas used up all their ammunition.', 'The Japanese had more soldiers in every battle.'], at: [5, 6], also: [[5]], correctSlot: 2, why: 'The Japanese moved around defended positions, so the defenders kept having to pull back.' },
      { prompt: 'What can you infer from the sentence "Allied troops did win some fights"?', correct: 'The defeat was not simply because the defenders could not fight.', wrong: ['The Allies were winning the campaign in January.', 'Gemas was the most important battle of the war.'], at: [2, 3], also: [[2], [3], [4], [3, 4]], correctSlot: 0, why: 'The defenders won some fights, so "they could not fight" cannot be the whole explanation.' },
      { prompt: 'Why might Malaya have had too few tanks and aircraft?', correct: 'Britain needed them for the war in Europe.', wrong: ['Japan had destroyed them all on 8 December.', 'The jungle made tanks and planes useless.'], at: [1], also: [[0, 1]], correctSlot: 1, why: 'The source links the shortage to Britain also fighting in Europe.' },
      { prompt: 'A general says, "If we hold this road, we are safe." What would this source warn him?', correct: 'The enemy may go around the position.', wrong: ['The enemy will only attack from the front.', 'Holding one road will stop the whole advance.'], at: [5], also: [[5, 6]], correctSlot: 1, why: 'The Japanese often went around defended positions instead of attacking them from the front.' },
      { prompt: 'What had happened by 31 January 1942?', correct: 'The last defenders had retreated into Singapore.', wrong: ['The Japanese had already landed in Singapore.', 'The Allies had pushed the Japanese back north.'], at: [7], also: [[6, 7]], correctSlot: 2, why: 'By 31 January the last defenders had crossed into Singapore.' },
    ],
  },
  {
    id: 'doc-troops', kind: 'report', title: 'More soldiers, but how strong?',
    provenance: { date: 'Student summary, written today', sender: 'History dossier' }, real: false,
    sourceLabel: 'Student summary of Source C (National Library Board)',
    glossary: [{ term: 'inexperienced', meaning: 'Not used to doing something yet.' }],
    paragraphs: [[
      'Singapore had more defending soldiers than the Japanese army that attacked it.',
      'But a number on paper does not show how strong an army really is.',
    ], [
      'Many defenders were exhausted after weeks of fighting and retreating through Malaya.',
      'Others had only just arrived and were inexperienced.',
      'A tired soldier and a new soldier each count as one on a list.',
      'They cannot always do the same job.',
    ]],
    key: [2, 3], quote: ['source-c', 'it included exhausted troops from Malaya and inexperienced reinforcements'],
    discovery: { id: 'd-troops', stageId: 's1', core: true,
      text: 'The defenders outnumbered the attackers, but many were exhausted from the retreat through Malaya and others were newly arrived and inexperienced.',
      note: 'More soldiers is not the same as a stronger army. Many of ours were exhausted or inexperienced.' },
    questions: [
      { prompt: 'What is the main point of this source?', correct: 'Counting soldiers does not show how well they can fight.', wrong: ['The defenders had fewer soldiers than the Japanese.', 'New soldiers were stronger than tired ones.'], at: [1], also: [[0, 1], [4, 5], [4], [5]], correctSlot: 2, why: 'The source says a number on paper does not show how strong an army really is.' },
      { prompt: 'Why might the soldiers from Malaya struggle in another battle?', correct: 'They were worn out from weeks of fighting.', wrong: ['They had never fought the Japanese before.', 'They had been sent home to rest.'], at: [2], also: [[2, 3]], correctSlot: 0, why: 'Many were exhausted after weeks of fighting and retreating through Malaya.' },
      { prompt: 'What can you infer about the soldiers who had just arrived?', correct: 'Being fresh did not make them ready.', wrong: ['They were the best fighters in Singapore.', 'They arrived after the battle was over.'], at: [3], also: [[2, 3], [3, 4]], correctSlot: 1, why: 'They had only just arrived and were inexperienced, so being fresh was not enough.' },
      { prompt: 'A report says, "We have more men than the enemy, so we will win." How would this source answer?', correct: 'More men does not always mean a stronger army.', wrong: ['That is right, because numbers decide battles.', 'That is wrong, because the Japanese had more men.'], at: [0, 1], also: [[1], [4, 5]], correctSlot: 0, why: 'The defenders did have more soldiers, but the source says numbers do not show real strength.' },
      { prompt: 'Which two groups of defenders does the source describe?', correct: 'Tired soldiers from Malaya and new, inexperienced ones.', wrong: ['Sailors from the naval base and pilots from the airfields.', 'Soldiers from Britain and soldiers from Japan.'], at: [2, 3], also: [[2], [3]], correctSlot: 2, why: 'The source describes exhausted soldiers from Malaya and inexperienced new arrivals.' },
    ],
  },
  {
    id: 'doc-voices', kind: 'memoir', title: 'Voices from Singapore',
    provenance: { date: 'Interviews recorded in 1984 and 2006', sender: 'National Archives of Singapore oral histories' }, real: false,
    sourceLabel: 'Student summary of Source E, with two short quotations from National Archives oral histories',
    glossary: [{ term: 'impregnable', meaning: 'Impossible to capture.' }, { term: 'civil defence', meaning: 'Volunteers who protect and help ordinary people during attacks.' }],
    paragraphs: [[
      'Many years later, people who lived in Singapore during the war were interviewed about it.',
      'Ronald Hubert Barth remembered a common belief that "Singapore was an impregnable fortress".',
    ], [
      'Rudy William Mosbergen remembered the first Japanese air raid on Singapore.',
      'He said: "But the air raid sirens were sounding when the Japanese bombers had left."',
      'Civil-defence workers helped people who were wounded in the air raids.',
    ], [
      'These memories were recorded decades later.',
      'They show some people\'s experiences, not everyone\'s.',
    ]],
    key: [1], quote: ['source-e', 'Singapore was an impregnable fortress'],
    discovery: { id: 'd-fortress', stageId: 's1', core: false,
      text: 'Some people in Singapore believed it was "an impregnable fortress" that could not be captured, yet the sirens for the first air raid sounded only after the bombers had left.',
      note: 'People thought Singapore was "an impregnable fortress". It was not ready: the first air-raid sirens sounded after the bombers had gone.' },
    questions: [
      { prompt: 'What can you infer from Barth\'s memory about how people felt before the attack?', correct: 'Many felt confident that Singapore was safe.', wrong: ['Many expected Singapore to fall quickly.', 'Many had never heard of the war.'], at: [1], also: [[0, 1]], correctSlot: 1, why: 'Calling Singapore "an impregnable fortress" shows people believed it could not be captured.' },
      { prompt: 'What does Mosbergen\'s memory suggest about Singapore\'s defences against bombing?', correct: 'The warning came too late to help people.', wrong: ['The sirens stopped the bombers from attacking.', 'The bombers never reached the city.'], at: [3], also: [[2, 3]], correctSlot: 0, why: 'The sirens were sounding only after the bombers had left.' },
      { prompt: 'Why must we be careful when we use these memories?', correct: 'They were recorded much later and are only some people\'s views.', wrong: ['They were written by Japanese soldiers.', 'They were made up, so they cannot be used.'], at: [5, 6], also: [[5], [6]], correctSlot: 2, why: 'The memories were recorded decades later and show some people\'s experiences, not everyone\'s. That makes them useful, but limited.' },
      { prompt: 'What do these memories add to the story of Singapore\'s fall?', correct: 'Ordinary people were hurt before the surrender.', wrong: ['The army had no plan at all.', 'The fighting never reached the city.'], at: [4], also: [[3, 4]], correctSlot: 1, why: 'Civil-defence workers helped people wounded in the air raids, so the war reached civilians early.' },
      { prompt: 'What did Barth remember many people believing?', correct: 'That Singapore could not be captured.', wrong: ['That Japan would never attack Malaya.', 'That the fleet had already arrived.'], at: [1], also: [[0, 1]], correctSlot: 0, why: '"Impregnable" means impossible to capture.' },
    ],
  },
  {
    id: 'doc-island', kind: 'report', title: 'One week on the island',
    provenance: { date: 'Student summary, written today', sender: 'History dossier' }, real: false,
    sourceLabel: 'Student summary of Source C (National Library Board)',
    glossary: [{ term: 'Johor Strait', meaning: 'The narrow sea between Johor and Singapore.' }, { term: 'depot', meaning: 'A place where supplies are stored.' }],
    paragraphs: [[
      'On 8 February 1942, Japanese troops crossed the Johor Strait.',
      'They landed on Singapore\'s northwest coast.',
      'They pushed inland towards Bukit Timah, where important fuel and supply depots were kept.',
    ], [
      'Orders were misunderstood, and defenders pulled back from an important defence line between Kranji and Jurong.',
      'On 11 February, Japanese forces captured Bukit Timah.',
      'The defenders kept fighting, but they had lost important supplies.',
    ]],
    key: [3, 4], quote: ['source-c', 'Misunderstood orders contributed to an Allied withdrawal from the Kranji-Jurong defence line.'],
    discovery: { id: 'd-bukit-timah', stageId: 's2', core: true,
      text: 'Misunderstood orders helped cause a withdrawal from the Kranji–Jurong line, and on 11 February the Japanese captured Bukit Timah and its fuel and supply depots.',
      note: 'Confused orders weakened the Kranji–Jurong line. Then Bukit Timah, with its supplies, was lost on 11 February.' },
    questions: [
      { prompt: 'Why was losing Bukit Timah serious?', correct: 'Important fuel and supplies were stored there.', wrong: ['It was where the generals lived.', 'It was the only road into the city.'], at: [2], also: [[5], [4, 5]], correctSlot: 1, why: 'Bukit Timah had important fuel and supply depots.' },
      { prompt: 'What does the source suggest about the Kranji–Jurong line?', correct: 'Confusion over orders weakened it, not only enemy attacks.', wrong: ['It was never defended at all.', 'The defenders held it until the surrender.'], at: [3], also: [[3, 4]], correctSlot: 0, why: 'Defenders pulled back from the line because orders were misunderstood.' },
      { prompt: 'Which statement is best supported by the source?', correct: 'Fighting went on after Bukit Timah fell, with fewer supplies.', wrong: ['The battle ended as soon as Bukit Timah fell.', 'The defenders took Bukit Timah back the next day.'], at: [4, 5], also: [[5]], correctSlot: 2, why: 'The defenders kept fighting after 11 February, but they had lost important supplies.' },
      { prompt: 'A student says, "Singapore fell because the soldiers stopped fighting." Which part of the source challenges this?', correct: 'The defenders kept fighting after Bukit Timah fell.', wrong: ['Japanese troops crossed the Johor Strait.', 'Bukit Timah had fuel and supply depots.'], at: [5], also: [[4, 5]], correctSlot: 1, why: 'The source says the defenders kept fighting.' },
      { prompt: 'Where did the Japanese land on Singapore island?', correct: 'On the northwest coast.', wrong: ['Near the naval base in the east.', 'At the city waterfront in the south.'], at: [1], also: [[0, 1]], correctSlot: 2, why: 'They landed on Singapore\'s northwest coast.' },
    ],
  },
  {
    id: 'doc-battlebox', kind: 'report', title: 'The meeting in the Battlebox',
    provenance: { date: 'Student summary, written today', sender: 'History dossier' }, real: false,
    sourceLabel: 'Student summary of Source D (BiblioAsia, 2024), with one quotation from Brigadier Goodman\'s diary as published there',
    glossary: [{ term: 'Battlebox', meaning: 'An underground command centre at Fort Canning.' }, { term: 'counterattack', meaning: 'An attack to win back ground from the enemy.' }],
    paragraphs: [[
      'On 15 February 1942, General Percival met eleven other men in the Battlebox.',
      'They heard reports about water, ammunition, food and the worsening situation for civilians.',
    ], [
      'General Heath urged surrender.',
      'General Bennett rejected an idea for a counterattack.',
      'Brigadier Simmons did not want to surrender, but could not see another choice.',
      'Brigadier Eric Goodman wrote in his diary that "it was useless to continue the fight as water and ammunition were failing".',
    ], [
      'Percival made the final decision.',
      'The surrender was then arranged at the Ford Factory.',
      'A diary shows what one person thought at the time, not proof that there was no other choice.',
    ]],
    key: [5], quote: ['source-d', 'it was useless to continue the fight as water and ammunition were failing'],
    discovery: { id: 'd-goodman', stageId: 's2', core: true,
      text: 'At the Battlebox meeting on 15 February, Brigadier Goodman wrote that "it was useless to continue the fight as water and ammunition were failing".',
      note: 'Goodman\'s diary: it was "useless to continue the fight as water and ammunition were failing".' },
    questions: [
      { prompt: 'What can you infer from Goodman\'s diary about why the commanders surrendered?', correct: 'They thought they could not fight on without water and ammunition.', wrong: ['They thought the Japanese would leave if they surrendered.', 'They thought help was about to arrive.'], at: [5], also: [[1], [4, 5]], correctSlot: 0, why: 'Goodman links the decision to water and ammunition failing.' },
      { prompt: 'What does the source show about how the decision was made?', correct: 'Commanders gave different views before Percival decided.', wrong: ['Percival decided alone, without asking anyone.', 'Every commander wanted to keep fighting.'], at: [2, 3], also: [[3, 4], [4], [6]], correctSlot: 2, why: 'Heath urged surrender and Bennett rejected a counterattack. Percival heard them and then made the final decision.' },
      { prompt: 'Why does the source mention civilians?', correct: 'Their worsening situation was part of the reports.', wrong: ['Civilians were invited to vote on the surrender.', 'All civilians had already left Singapore.'], at: [1], also: [[0, 1]], correctSlot: 1, why: 'The commanders heard reports about the worsening situation for civilians.' },
      { prompt: 'What is one limitation of using Goodman\'s diary?', correct: 'It shows one person\'s view, not proof there was no other choice.', wrong: ['It was written by a Japanese officer.', 'It was written many years after the war.'], at: [8], correctSlot: 0, why: 'The diary records what one commander thought at the time.' },
      { prompt: 'Who made the final decision to surrender?', correct: 'General Percival.', wrong: ['General Heath.', 'Brigadier Goodman.'], at: [6], also: [[6, 7]], correctSlot: 2, why: 'The source says Percival made the final decision.' },
    ],
    recoveryFrom: ['d-bukit-timah'],
  },
]

function buildDocument(d: Doc) {
  const body = d.paragraphs.map(p => p.join(' ')).join('\n\n')
  const spans = sourceSentenceSpans(body)
  const expected = d.paragraphs.flat()
  if (spans.length !== expected.length) throw Error(`${d.id}: ${spans.length} sentences found, ${expected.length} written:\n${spans.map(s => body.slice(s.start, s.end)).join('\n')}`)
  const span = ([a, b]: [number, number?]) => ({ start: spans[a]!.start, end: spans[b ?? a]!.end })
  const question = (q: Q, n: string) => {
    const options = [q.wrong[0], q.wrong[1]]
    options.splice(q.correctSlot, 0, q.correct)
    const ids = options.map((_, i) => `${d.id}-${n}-${'abc'[i]}`)
    return { id: `${d.id}-${n}`, prompt: q.prompt, options: options.map((text, i) => ({ id: ids[i]!, text })), correctOptionId: ids[q.correctSlot]!, support: [q.at, ...(q.also ?? [])].map(span), explanation: q.why }
  }
  return {
    id: d.id, kind: d.kind, title: d.title, provenance: d.provenance, body, real: d.real, sourceLabel: d.sourceLabel, glossary: d.glossary,
    keyPassages: [{ id: `${d.id}-key`, ...span(d.key) }],
    citations: [cite(...d.quote)],
    readingCheck: {
      discoveryId: d.discovery.id,
      variants: d.questions.slice(0, 4).map((q, i) => question(q, `q${i + 1}`)),
      recovery: question(d.questions[4], 'recovery'),
      recoveryDiscoveryIds: d.recoveryFrom ?? [],
    },
  }
}

// ---------- characters ----------
const stage1Time = 'Use only the date and place of the current scene. Never mention or hint at anything that happens after it, including where or when the Japanese will land. Speak in two to four short, plain sentences that a 13-year-old can follow. Share facts only from the facts you are allowed to share now; if something is not among them, say you cannot say yet or do not know. The dossier summaries are modern; you have not read them.'
const realRule = 'This is a real person. Say only what the lesson sources support. Do not invent private feelings, quotations, orders or numbers.'
const fictionalRule = 'This is a fictional character, invented for the lesson. Keep every fact to the lesson sources; do not invent battles, numbers or orders.'
const persona = (p: { voice: string; knewThen: string; wants: string; withholds?: string[]; position: string; agenda: string }) => ({
  voice: p.voice, phrases: [], knewThen: p.knewThen, wantsFromStudent: p.wants, withholds: p.withholds ?? [], publicPosition: p.position, privateAgenda: p.agenda,
})
const characters = [
  {
    id: 'percival', name: 'Arthur Percival', title: 'Lieutenant-General, army commander in Malaya', real: true, tier: 'major',
    persona: persona({
      voice: 'Formal and careful. Defends his plan with reasons, and changes his mind only when shown evidence.',
      knewThen: `${stage1Time} ${realRule} He commands the army defending Singapore. Decisions are his; Sam is a junior officer who advises. He gives ground only on a point the student has backed with a note.`,
      wants: 'Evidence, not opinions.',
      position: 'Singapore must be defended with the troops on the island.',
      agenda: 'Nothing beyond what the sources support. Do not invent private worries.',
    }),
    stances: [
      { id: 'percival-confident', label: 'Confident', demeanour: 'Sure of his plan. Points to his reasons and asks what evidence the student has against them.' },
      { id: 'percival-doubtful', label: 'Doubtful', demeanour: 'Has accepted one weak spot in his plan, but still defends the other reason.' },
      { id: 'percival-convinced', label: 'Convinced', demeanour: 'Accepts how serious things are, and listens closely.' },
    ],
    initialStanceId: 'percival-confident', slants: [],
    trustNotice: 'Percival becomes more guarded. He wants evidence, not guesses.',
  },
  {
    id: 'arjun', name: 'Captain Arjun Singh', title: 'Indian Army liaison officer (fictional character)', real: false, tier: 'major',
    persona: persona({
      voice: 'Calm, practical and tired. Uses plain words. Proud of his soldiers.',
      knewThen: `${stage1Time} ${fictionalRule} His unit fought through the retreat in Malaya. He is proud of his soldiers and tired of retreating.`,
      wants: 'For the student to understand why brave soldiers still had to retreat.',
      withholds: ['what happened after the win at Gemas (until shown a note about it)', 'whether help can still come (until shown a note about the fleet)'],
      position: 'His soldiers fought well and deserve to be remembered.',
      agenda: 'Wants the student to see the soldiers as people, not numbers on a list.',
    }),
    stances: [
      { id: 'arjun-tired', label: 'Tired', demeanour: 'Short answers. Not sure the student understands the retreat.' },
      { id: 'arjun-open', label: 'Open', demeanour: 'Explains what happened in plain words.' },
      { id: 'arjun-frank', label: 'Frank', demeanour: 'Speaks honestly, even when the truth is hard.' },
    ],
    initialStanceId: 'arjun-tired', slants: [],
    trustNotice: 'Arjun goes quiet. He is not sure you are listening.',
  },
  {
    id: 'ong', name: 'Mrs Ong Bee Lian', title: 'Civil-defence volunteer (fictional character)', real: false, tier: 'minor',
    persona: persona({
      voice: 'Warm, brisk and practical. Talks about ordinary people in the city.',
      knewThen: `${stage1Time} ${fictionalRule} She helps people wounded in Japanese air raids in the city.`,
      wants: 'For the officers to remember ordinary people.',
      position: 'The war has already reached ordinary people in the city.',
      agenda: 'Wants the student to remember civilians when explaining the war.',
    }),
    stances: [], initialStanceId: null, slants: [],
  },
  {
    id: 'hamid', name: 'Corporal Hamid bin Osman', title: 'Malay Regiment soldier (fictional character)', real: false, tier: 'minor',
    persona: persona({
      voice: 'Proud, direct and steady.',
      knewThen: `It is 15 February 1942. ${fictionalRule} The Malay Regiment, a locally raised regular regiment, fought strongly at Pasir Panjang on 13 and 14 February before being overwhelmed. Do not describe the fighting in graphic detail, and do not tell the story of any named real soldier. Speak in two to four short, plain sentences.`,
      wants: 'For the student to know that local soldiers fought too.',
      position: 'The Malay Regiment fought hard for Singapore.',
      agenda: 'Wants local soldiers remembered in the story of the defence.',
    }),
    stances: [], initialStanceId: null, slants: [],
  },
  {
    id: 'bennett', name: 'Gordon Bennett', title: 'Major-General, Australian commander at the Battlebox meeting', real: true, tier: 'minor',
    persona: persona({
      voice: 'Sharp and impatient.',
      knewThen: `It is 15 February 1942, at the Battlebox. ${realRule} The only position the sources record for him is that he rejected a proposed counterattack. If the student asks why, point to the reports the meeting is hearing on water, ammunition, food and civilians, and say you speak only for yourself. Do not give any other reason, and do not speak for the other officers. Speak in two to four short, plain sentences.`,
      wants: 'For the student to understand why a counterattack was rejected.',
      position: 'He rejected the idea of a counterattack.',
      agenda: 'Nothing beyond what the sources support.',
    }),
    stances: [], initialStanceId: null, slants: [],
  },
]

// ---------- discoveries held by characters ----------
const topics: Record<string, string> = {
  'd-arjun-retreat': 'why his men kept retreating after winning at Gemas',
  'd-no-help': 'whether any help can still come',
  'd-no-city': 'whether the city could hold out',
}
const talk = (id: string, stageId: string, characterId: string, text: string, note: string, sourceLabel: string, citations: { sourceId: string; quote?: string }[], condition?: object) =>
  ({ id, stageId, holder: { characterId }, text, note, ...(topics[id] ? { topic: topics[id] } : {}), core: false, sourceLabel, citations, ...(condition ? { condition } : {}) })
const anyBriefing = (outcomeId: string) => ({ outcome: { momentId: 'm-briefing', outcomeId } })
const spoken = [
  // Stage 1: Percival's two reasons. Each is answered by one note.
  talk('d-percival-plan', 's1', 'percival',
    'Percival is confident in his plan for two reasons: the defenders outnumber the Japanese, and he expects the main attack in the east, near the naval base, where his strongest forces are.',
    'Percival\'s plan rests on two reasons: we have more men, and the attack will come in the east near the naval base.',
    'Reconstructed dialogue; the larger garrison is in Source C, and his eastern expectation is well-documented context outside the six sources',
    [cite('source-c', 'Although the Allied garrison was numerically larger')]),
  talk('d-arjun-retreat', 's1', 'arjun',
    'Arjun says his soldiers won fights in Malaya, but each time the Japanese moved around them and threatened the road behind, so they had to pull back.',
    'Arjun: we won fights, but the Japanese kept going around us and threatening the road behind, so we had to pull back.',
    'Fictional character; based on Source B', [cite('source-b', 'Defenders repeatedly withdrew southwards.')],
    { notePassed: { discoveryId: 'd-gemas', characterId: 'arjun' } }),
  talk('d-ong-raids', 's1', 'ong',
    'Mrs Ong says civil-defence workers are helping people wounded in air raids. The war has already reached ordinary people in the city.',
    'Mrs Ong: the war has already reached ordinary people. Civil-defence workers are helping the wounded from air raids.',
    'Fictional character; based on Source E', [cite('source-e', 'civil-defence workers assisting people wounded in air raids')]),
  // Stage 2: Percival's task, then one way out ruled out by each person.
  talk('d-percival-situation', 's2', 'percival',
    'Percival says water and ammunition are running low, and he must decide whether the army can keep fighting.',
    'Percival: water and ammunition are running low. He must decide whether we can keep fighting.',
    'Reconstructed dialogue; the meeting\'s reports are in Source D', [cite('source-d', 'Percival remained responsible for the decision, but the consultation involved others.')]),
  talk('d-recall-kept', 's2', 'percival',
    'Percival says the attack did not come in the east, where he had expected it and placed his strongest forces.',
    'Percival: the attack did not come where he expected.',
    'Reconstructed dialogue; landing from Source C', [cite('source-c', 'landed on Singapore\'s northwestern coast on 8 February')],
    anyBriefing('o-plan-kept')),
  talk('d-recall-partly', 's2', 'percival',
    'Percival tells Sam that the point they proved was right, but one point was not enough to change the plan, and the attack came in the northwest.',
    'Percival: my one proven point was right, but it was not enough to change his plan.',
    'Reconstructed dialogue; landing from Source C', [cite('source-c', 'landed on Singapore\'s northwestern coast on 8 February')],
    anyBriefing('o-partly')),
  talk('d-recall-convinced', 's2', 'percival',
    'Percival tells Sam they were right about both weak spots, but there were no fresh troops and no time to fix them.',
    'Percival: I was right about both weak spots, but there were no troops and no time to fix them.',
    'Reconstructed dialogue; based on Source C', [cite('source-c', 'it included exhausted troops from Malaya and inexperienced reinforcements')],
    anyBriefing('o-convinced')),
  talk('d-bennett', 's2', 'bennett',
    'Bennett rejects the counterattack. He points to the reports on water and ammunition.',
    'Way out 1, counterattack: Bennett rejects it.',
    'Reconstructed dialogue; position from Source D', [cite('source-d', 'Bennett as rejecting a proposed counterattack')]),
  talk('d-arjun-hope', 's2', 'arjun',
    'Arjun hopes that if the army holds on a little longer, help may still come.',
    'Arjun hopes help may still come if we hold on.',
    'Fictional character; a hope, not a fact'),
  talk('d-no-help', 's2', 'arjun',
    'Arjun accepts that no fleet is coming: the promised fleet never came, and the two big ships were sunk. Holding on would only delay the end.',
    'Way out 2, hold on for help: no fleet is coming. The big ships were sunk in December.',
    'Fictional character; based on Source A', [cite('source-a', 'When Japan attacked in December 1941, the promised fleet had not arrived.')],
    { notePassed: { discoveryId: 'd-fleet', characterId: 'arjun' } }),
  talk('d-no-city', 's2', 'ong',
    'Mrs Ong says that without water the city cannot hold out. It is crowded, the bombing is getting worse, and ordinary people are suffering.',
    'Way out 3, fight on in the city: without water the city cannot hold out, and civilians are suffering.',
    'Fictional character; based on Source D', [cite('source-d', 'the worsening civilian situation')],
    { notePassed: { discoveryId: 'd-goodman', characterId: 'ong' } }),
  talk('d-hamid-pasir', 's2', 'hamid',
    'Hamid says the Malay Regiment fought strongly at Pasir Panjang on 13 and 14 February before being overwhelmed.',
    'Hamid: the Malay Regiment fought hard at Pasir Panjang on 13–14 February before being overwhelmed. Courage was not the problem.',
    'Fictional character; based on Source C', [cite('source-c', 'The Malay Regiment fought strongly at Pasir Panjang on 13–14 February, before being overwhelmed.')]),
].map(d => d.citations ? d : { ...d, citations: undefined })

const documents = docs.map(buildDocument)
const discoveries = [
  ...docs.map(d => ({ ...d.discovery, holder: { documentId: d.id, keyPassageId: `${d.id}-key` }, sourceLabel: d.sourceLabel, citations: [cite(...d.quote)] })),
  ...spoken.map(({ citations, ...d }) => citations ? { ...d, citations } : d),
]

// ---------- stages ----------
const week = 'A week ago, the Japanese landed in the northwest. Bukit Timah and its supplies have fallen, and the army has been pushed back to the city.'
const battlebox = 'Deep under Fort Canning, in the Battlebox, the officers are deciding what to do next.'
const stages = [
  {
    id: 's1', title: 'The fortress that wasn\'t', timePlace: 'Fort Canning, Singapore, early February 1942',
    centralQuestion: 'Why is Percival so sure of his plan, and can you prove him wrong?',
    openingNarration: 'February 1942. After weeks of retreat through Malaya, the army is back on Singapore island. The Japanese are just across the Johor Strait.\n\nGeneral Percival is sure his plan will hold. You can\'t give orders. But you can bring him evidence.',
    rooms: [
      { id: 'command-room', name: 'Command room', description: 'Percival\'s office at Fort Canning, with a large map of Singapore. The naval base is marked in the east. The northwest coast also faces Johor, across a narrow strait. A report on the defenders\' strength lies on his desk.' },
      { id: 'liaison-office', name: 'Liaison office', description: 'Captain Arjun Singh sits with muddy boots and a pile of reports from the retreat through Malaya.' },
      { id: 'dossier-1', name: 'History dossier (today)', description: 'A modern study desk with short summaries written for students. The people in 1942 have not read these.' },
      { id: 'civil-post', name: 'Civil-defence post', description: 'A first-aid post in the city, with stretchers, bandages and a siren on the roof.' },
    ],
    startRoomId: 'command-room',
    placement: { percival: 'command-room', arjun: 'liaison-office', ong: 'civil-post' },
    documentPlacement: { 'doc-troops': 'command-room', 'doc-gemas': 'dossier-1', 'doc-fleet': 'dossier-1', 'doc-voices': 'civil-post' },
    situations: [],
    definingMomentId: 'm-briefing',
    preparation: {
      characters: {
        percival: [{ discoveryIds: ['d-troops', 'd-fleet'], minMet: 1 }],
        arjun: [{ discoveryIds: ['d-gemas'], minMet: 1 }],
        ong: [],
      },
      decision: [{ discoveryIds: ['d-fleet', 'd-gemas', 'd-troops', 'd-fortress', 'd-ong-raids'], minMet: 2 }],
      essentialCharacters: [
        { characterId: 'percival', discoveryIds: ['d-percival-plan'] },
        { characterId: 'arjun', discoveryIds: ['d-arjun-retreat'] },
      ],
    },
  },
  {
    id: 's2', title: 'Is there any way out?', timePlace: 'The Battlebox, Fort Canning, 15 February 1942',
    centralQuestion: 'Is there any way to keep fighting?',
    openingNarration: `15 February 1942. ${week}\n\n${battlebox}`,
    rooms: [
      { id: 'battlebox', name: 'Battlebox conference room', description: 'An underground room with a long table, maps and telephones. A report on this morning\'s meeting lies on the table.' },
      { id: 'signals', name: 'Signals room', description: 'Telephones and messages from units across the island. Captain Singh is reading the latest reports.' },
      { id: 'outside', name: 'Outside Fort Canning', description: 'Smoke rises over the city. Soldiers and civil-defence volunteers pass by.' },
    ],
    startRoomId: 'battlebox',
    placement: { percival: 'battlebox', bennett: 'battlebox', arjun: 'signals', hamid: 'outside', ong: 'outside' },
    documentPlacement: { 'doc-battlebox': 'battlebox', 'doc-island': 'signals', 'doc-fleet': 'signals' },
    situations: [
      { whenOutcome: { momentId: 'm-briefing', outcomeId: 'o-plan-kept' }, stances: { percival: 'percival-convinced' }, openingNarration: `15 February 1942. Percival kept his plan. ${week}\n\n${battlebox}` },
      { whenOutcome: { momentId: 'm-briefing', outcomeId: 'o-partly' }, stances: { percival: 'percival-convinced' }, openingNarration: `15 February 1942. You proved one weak spot, but Percival kept his plan. ${week}\n\n${battlebox}` },
      { whenOutcome: { momentId: 'm-briefing', outcomeId: 'o-convinced' }, stances: { percival: 'percival-convinced' }, openingNarration: `15 February 1942. Percival believed you, but there were no fresh troops and no time. ${week}\n\n${battlebox}` },
    ],
    definingMomentId: 'm-way-out',
    preparation: {
      characters: {
        percival: [{ discoveryIds: ['d-troops', 'd-fleet', 'd-goodman', 'd-bukit-timah'], minMet: 1 }],
        arjun: [{ discoveryIds: ['d-fleet', 'd-bukit-timah'], minMet: 1 }],
        bennett: [], hamid: [], ong: [],
      },
      decision: [{ discoveryIds: ['d-bennett', 'd-no-help', 'd-no-city'], minMet: 2 }],
      essentialCharacters: [
        { characterId: 'percival', discoveryIds: ['d-percival-situation'] },
        { characterId: 'arjun', discoveryIds: ['d-no-help'] },
      ],
    },
  },
]

// ---------- decisions: Sam chooses only what Sam says; Percival decides ----------
const atLeast = (stanceId: string) => ({ stanceAtLeast: { characterId: 'percival', stanceId } })
const definingMoments = [
  {
    id: 'm-briefing', stageId: 's1', deciderId: 'percival',
    scene: 'Percival looks up from the map. "Well? Have you finished your report?"',
    nudge: 'Hear Percival\'s two reasons first. He changes his mind about a reason only when you show him evidence against it: a report on the troops, and what Captain Singh saw in Malaya.',
    finalCallNarration: 'Time is up. Percival wants your answer now.',
    acts: [
      { id: 'a-report', text: 'Finish your report: "Sir, that is everything I found."', reaction: 'Percival looks back at the map and thinks about what you have shown him.' },
      { id: 'a-ask', text: 'Ask Percival: "Will you change the plan?"', reaction: 'Percival looks back at the map and thinks about what you have shown him.' },
    ],
    outcomes: [
      { id: 'o-plan-kept', summary: 'Percival keeps his plan, with his strongest forces in the east. On 8 February, the Japanese land in the northwest.', predictionText: 'Percival keeps his plan.', because: 'You had not shown him evidence against either of his reasons, so he had no reason to change his mind.', closesEndingIds: [], historical: true },
      { id: 'o-partly', summary: 'Percival accepts the point you proved, but not the other one. He keeps his plan. On 8 February, the Japanese land in the northwest.', predictionText: 'Percival accepts one point, but keeps his plan.', because: 'You answered only one of his two reasons.', closesEndingIds: [] },
      { id: 'o-convinced', summary: 'Percival is convinced that his plan has weak spots. But there are no fresh troops and no time to move them. On 8 February, the Japanese land in the northwest.', predictionText: 'Percival agrees, but cannot fix it in time.', because: 'Seeing a problem is not the same as having the troops and time to fix it.', closesEndingIds: [] },
    ],
    // Percival's response depends only on the evidence Sam has shown him, never on which line Sam picks.
    rules: ['a-report', 'a-ask'].flatMap(actId => [
      { actId, when: { not: atLeast('percival-doubtful') }, outcomeId: 'o-plan-kept' },
      { actId, when: { not: atLeast('percival-convinced') }, outcomeId: 'o-partly' },
      { actId, outcomeId: 'o-convinced' },
    ]),
  },
  {
    id: 'm-way-out', stageId: 's2', deciderId: 'percival',
    scene: 'The officers fall silent. Percival turns to you. "You have checked the reports. Is there any way to keep fighting?"',
    nudge: 'Talk to Percival and Captain Singh, and check at least two of the three ideas before you answer.',
    finalCallNarration: 'The meeting cannot wait. Percival asks for your answer now.',
    acts: [
      { id: 'a-no-way', text: 'Tell Percival: the reports show there is no way to keep fighting.', reaction: 'Percival looks down at the reports for a long moment.' },
      { id: 'a-counterattack', text: 'Tell Percival: one more counterattack could still work.', reaction: 'Bennett shakes his head before you finish.' },
      { id: 'a-hold-on', text: 'Tell Percival: hold on a little longer, because help may still come.', reaction: 'Percival asks, "Help from where?"' },
    ],
    outcomes: [
      { id: 'o-agrees', summary: 'Percival agrees: water and ammunition are failing, and no help is coming. He decides to surrender.', predictionText: 'Percival agrees and decides to surrender.', because: 'Every way out was blocked, as the reports showed.', closesEndingIds: [], endingId: 'e-no-way', historical: true },
      { id: 'o-no-counterattack', summary: 'Bennett has already rejected a counterattack, and ammunition is failing. Percival decides to surrender.', predictionText: 'The counterattack is rejected, and Percival decides to surrender.', because: 'Tired troops without ammunition could not make a counterattack.', closesEndingIds: [], endingId: 'e-counterattack' },
      { id: 'o-no-help', summary: 'Percival reminds you that the promised fleet never came, and the big ships were sunk. He decides to surrender.', predictionText: 'Percival says no help is coming, and decides to surrender.', because: 'No fleet was coming, so holding on would only delay the end.', closesEndingIds: [], endingId: 'e-hold-on' },
    ],
    rules: [
      { actId: 'a-no-way', outcomeId: 'o-agrees' },
      { actId: 'a-counterattack', outcomeId: 'o-no-counterattack' },
      { actId: 'a-hold-on', outcomeId: 'o-no-help' },
    ],
  },
]

// ---------- endings ----------
const surrender = 'What actually happened: on 15 February 1942, Percival decided to surrender. The surrender was arranged at the Ford Factory in Bukit Timah. More than three years of Japanese occupation followed.'
const interviewFor = (endingId: string) => ({
  interviewer: 'A museum guide at the Former Ford Factory, today',
  question: 'You checked every way out. So why did Singapore fall? Choose the answer you can best defend, and back it up with your notes.',
  verdicts: [
    { id: `${endingId}-v-japan`, text: 'Mainly because the Japanese army moved fast, used air power and went around the defences.', counterPoints: ['d-fleet', 'd-bukit-timah'] },
    { id: `${endingId}-v-britain`, text: 'Mainly because of British weaknesses: no fleet, too few aircraft, and tired or inexperienced troops.', counterPoints: ['d-gemas'] },
    { id: `${endingId}-v-supplies`, text: 'Mainly because, once Bukit Timah fell, water and ammunition ran out.', counterPoints: ['d-fleet', 'd-gemas'] },
  ],
  generalCounter: 'Historian Brian Farrell argues that you must study both armies: the Japanese army\'s plans and skills, not only British mistakes. Does your answer do that? And could any one cause explain it on its own?',
})
const endingCitations = [cite('source-d', 'Surrender was subsequently negotiated at the Ford Factory, not at the Battlebox.')]
const endings = [
  { id: 'e-no-way', type: 'historical', title: 'No way out', summary: 'You checked every way out and told Percival the truth. He decided to surrender.', epilogue: `Your simulation: you told Percival there was no way to keep fighting. Brigadier Goodman wrote much the same in his diary that day.\n\n${surrender}`, interview: interviewFor('e-no-way'), sourceLabel: 'Historical outcome; Source D', citations: endingCitations },
  { id: 'e-counterattack', type: 'alternative', title: 'One more attack?', summary: 'You argued for a counterattack. Bennett had already rejected it: the troops were worn out and ammunition was failing.', epilogue: `Your simulation: you argued for one more counterattack. Courage was real, as Pasir Panjang showed, but it could not replace water and ammunition.\n\n${surrender}`, interview: interviewFor('e-counterattack'), sourceLabel: 'Simulation of your answer; the surrender is historical (Source D)', citations: endingCitations },
  { id: 'e-hold-on', type: 'alternative', title: 'Waiting for help', summary: 'You hoped help would come. But the promised fleet never came.', epilogue: `Your simulation: you urged Percival to hold on for help. But the fleet never came, and the big ships had been sunk in December.\n\n${surrender}`, interview: interviewFor('e-hold-on'), sourceLabel: 'Simulation of your answer; the surrender is historical (Source D)', citations: endingCitations },
]

// ---------- assemble ----------
const spec = {
  schemaVersion: '2.1.1',
  id: 'the-fortress-that-fell',
  title: 'The Fortress That Fell',
  readingLevel: 'sec',
  arc: 'A junior officer proves the weak spots in Percival\'s plan, then checks every way out as the defence of Singapore collapses in February 1942.',
  timer: { enabled: false, stageMinutes: [12, 12] },
  role: {
    name: 'Sam',
    position: 'Junior liaison officer at army headquarters (fictional)',
    relationships: [
      'General Percival is your commander. He wants evidence, not guesses.',
      'Captain Arjun Singh fought through the retreat in Malaya.',
      'Mrs Ong helps the wounded at a civil-defence post.',
    ],
    reputation: 'New, careful, good with reports.',
    stakes: 'You can\'t give orders. Your power is evidence: what you find, and who you show it to.',
    privateBrief: {
      goals: ['Find the weak spots in Percival\'s plan and prove them.', 'Check whether there is any way to keep fighting.', 'At the end, explain why Singapore fell, using your notes.'],
      fears: ['Giving advice without evidence.'],
      constraints: ['You advise; Percival decides.', 'Your choices change conversations, not history.'],
      knows: ['Japan invaded Malaya on 8 December 1941.', 'By 31 January 1942, the defenders had retreated across the Causeway into Singapore.', 'Many people call Singapore a fortress.'],
    },
    situation: 'February 1942. Singapore is a British colony, defended by British, Indian, Australian and local soldiers.',
  },
  stages, characters, discoveries, documents,
  triggers: [
    { id: 't-arjun-gemas', characterId: 'arjun', on: { notePassed: 'd-gemas' }, effect: { toStance: 'arjun-open' }, notice: 'Arjun reads your note about Gemas and nods slowly. "Yes. That was a real win. Let me tell you what happened after it."' },
    { id: 't-percival-troops', characterId: 'percival', requires: { not: { any: ['o-plan-kept', 'o-partly', 'o-convinced'].map(anyBriefing) } }, on: { notePassed: 'd-troops' }, effect: { stanceDelta: 1 }, notice: 'Percival frowns at the report. "Exhausted, and inexperienced. Very well: more men is not the same as more strength."' },
    { id: 't-percival-singh', characterId: 'percival', requires: { not: { any: ['o-plan-kept', 'o-partly', 'o-convinced'].map(anyBriefing) } }, on: { notePassed: 'd-arjun-retreat' }, effect: { stanceDelta: 1 }, notice: 'Percival reads Captain Singh\'s account. "They went around our positions all through Malaya. Then they may not come where we are strongest."' },
    { id: 't-arjun-fleet', characterId: 'arjun', on: { notePassed: 'd-fleet' }, requires: { any: ['o-plan-kept', 'o-partly', 'o-convinced'].map(anyBriefing) }, effect: { toStance: 'arjun-frank' }, notice: 'Arjun reads the note for a long time. "So no ships are coming. Holding on only buys time."' },
  ],
  definingMoments, endings,
  reveal: {
    whatHappened: 'Japan invaded Malaya on 8 December 1941. Two days later, Japanese aircraft sank Prince of Wales and Repulse. Allied troops won some fights, such as Gemas, but kept retreating and crossed into Singapore by 31 January 1942. Percival expected the main attack in the east, but on 8 February Japanese troops landed in the northwest. Misunderstood orders helped cause a withdrawal from the Kranji–Jurong line, and on 11 February Bukit Timah, with its supplies, was captured. The Malay Regiment fought at Pasir Panjang on 13–14 February. On 15 February, with water and ammunition failing, Percival and his commanders decided to surrender. The surrender was arranged at the Ford Factory.',
    interpretations: [
      'Some explanations focus on Allied weaknesses: the missing fleet, too few aircraft, and tired or inexperienced troops.',
      'Others stress Japanese strengths: speed, air power and moving around defences. Historian Brian Farrell argues that both armies must be studied.',
      'Many historians see several causes working together, rather than one mistake or one person.',
    ],
    corrections: [
      'Captain Arjun Singh, Corporal Hamid bin Osman, Mrs Ong and Sam are fictional. Percival, Bennett and Goodman were real people; their words in this game are reconstructed from their recorded positions.',
      'Percival made the decisions. Your evidence changed the conversations in this game, not history. In every version, Singapore surrendered on 15 February 1942.',
      'The defenders did not lack courage. Gemas, Bakri and Pasir Panjang show that they fought hard.',
    ],
    couldHaveGone: [
      'Historians still debate whether different decisions earlier in the campaign could have changed the result. The sources in this lesson do not show that any one decision would have saved Singapore.',
    ],
  },
  teacherQuestions: [
    'Source E: "Singapore was an impregnable fortress." What can you infer about how people in Singapore saw the war before 1942? Use details from the source to explain your answer.',
    'Source D: Goodman wrote that "it was useless to continue the fight as water and ammunition were failing". What can you infer about why the commanders surrendered? Explain how the evidence supports your inference.',
    'Why could the Allies win at Gemas and still lose the campaign?',
    'Choose two causes of the fall of Singapore. Explain how they are connected.',
    'Which of your sources come from people who were there, and which were written later? Why does that matter?',
  ],
  sources: captured.map(({ id, title, origin, url }) => ({ id, title, origin, url })),
  conflicts: [],
  storyEvents: [
    // Stage 1: when Percival has heard his reasons answered, the decision opens by itself.
    { id: 'ev-s1-ready', stageId: 's1', effect: 'beginMoment', when: { condition: { all: [{ stanceIs: { characterId: 'percival', stanceId: 'percival-convinced' } }, { discovered: 'd-percival-plan' }] } },
      text: 'Percival puts down your notes. He has heard enough.' },
    // Stage 2: Percival hands out the job, each idea is ticked off as it is ruled out, and the decision opens when all three are checked.
    { id: 'ev-s2-task', stageId: 's2', effect: 'summons', characterId: 'percival', when: { atSeconds: 0 },
      text: 'Percival waves you over. "We\'re running out of water and ammunition. Is there any way to keep fighting? Ask Bennett about a counterattack, Singh about help, and the people outside about the city."' },
    { id: 'ev-s2-counterattack', stageId: 's2', effect: 'news', when: { condition: { discovered: 'd-bennett' } },
      text: 'Idea checked: a counterattack. Bennett rejects it.' },
    { id: 'ev-s2-help', stageId: 's2', effect: 'news', when: { condition: { discovered: 'd-no-help' } },
      text: 'Idea checked: holding on for help. No fleet is coming.' },
    { id: 'ev-s2-city', stageId: 's2', effect: 'news', when: { condition: { discovered: 'd-no-city' } },
      text: 'Idea checked: fighting on in the city. Without water, the city cannot hold out.' },
    { id: 'ev-s2-ready', stageId: 's2', effect: 'beginMoment', when: { condition: { all: ['d-bennett', 'd-no-help', 'd-no-city', 'd-percival-situation'].map(discovered => ({ discovered })) } },
      text: 'Every idea has been checked. Percival calls the officers back to the table.' },
  ],
  openQuestions: [
    { id: 'oq-plan', stageId: 's1', text: 'What are Percival\'s two reasons, and what evidence answers each one?', discoveryIds: ['d-percival-plan', 'd-troops', 'd-arjun-retreat'] },
    { id: 'oq-way-out', stageId: 's2', text: 'Is there any way to keep fighting? What blocks each idea?', discoveryIds: ['d-bennett', 'd-no-help', 'd-no-city'] },
  ],
  hintAngles: [
    { id: 'h-plan', discoveryId: 'd-percival-plan', kind: 'ask', text: 'Ask Percival why he is so sure of his plan.' },
    { id: 'h-troops', discoveryId: 'd-troops', kind: 'read', text: 'Percival\'s desk has a report on how strong the defenders really are.' },
    { id: 'h-gemas', discoveryId: 'd-gemas', kind: 'read', text: 'The history dossier explains what happened at Gemas.' },
    { id: 'h-fleet', discoveryId: 'd-fleet', kind: 'read', text: 'There is a report about the missing fleet.' },
    { id: 'h-arjun', discoveryId: 'd-arjun-retreat', kind: 'show', text: 'Show Captain Singh your note about Gemas, then show Percival what he tells you.' },
    { id: 'h-task', discoveryId: 'd-percival-situation', kind: 'ask', text: 'Ask Percival how bad the situation is.' },
    { id: 'h-goodman', discoveryId: 'd-goodman', kind: 'read', text: 'A report on the meeting is on the Battlebox table.' },
    { id: 'h-island', discoveryId: 'd-bukit-timah', kind: 'read', text: 'The signals room has a report on the week since the landing.' },
    { id: 'h-bennett', discoveryId: 'd-bennett', kind: 'ask', text: 'Ask Bennett about a counterattack.' },
    { id: 'h-no-help', discoveryId: 'd-no-help', kind: 'show', text: 'Captain Singh hopes help will come. Show him your note about the fleet.' },
    { id: 'h-no-city', discoveryId: 'd-no-city', kind: 'show', text: 'Show Mrs Ong your note about Goodman\'s diary.' },
  ],
}

fs.writeFileSync(folder + 'adventure.json', JSON.stringify({ format: 'pocket-adventure-v3', version: 1, sources: captured, spec }, null, 2) + '\n')
console.log(`Wrote adventure.json: ${documents.length} documents, ${discoveries.length} discoveries, ${characters.length} characters.`)
