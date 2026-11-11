// Builds adventure.json for "The Fortress That Fell". All content is written here as data; the
// script only computes reading-highlight offsets from sentence numbers and captures the sources.
// Run: npx vite-node --config vitest.config.ts docs/lesson-materials/battle-of-singapore/fortress/build.ts
import fs from 'node:fs'
import { sourceSentenceSpans } from '../../../../packages/spec-v3/src/reading-support.ts'

const folder = new URL('.', import.meta.url).pathname
const pack = new URL('..', import.meta.url).pathname

// ---------- sources (the teacher files, captured verbatim) ----------
const biblioAsia = 'https://biblioasia.nlb.gov.sg/all-sections/vol-20-issue-2-jul-sep-2024-men-surrender-singapore-japanese-occupation/'
const files: [string, string, string][] = [
  ['source-a', '01-defence-strategy.txt', 'https://www.navy.gov.au/about-navy/history/history-milestones/singapore-strategy-fall-singapore'],
  ['source-b', '02-campaign-in-malaya.txt', 'https://www.awm.gov.au/articles/blog/fall-of-singapore'],
  ['source-c', '03-invasion-of-the-island.txt', 'https://www.nlb.gov.sg/main/article-detail?cmsuuid=1afe9a7e-f0bd-4b11-9fe3-bb3aab31c3e8'],
  ['source-d', '04-surrender-conference.txt', biblioAsia],
  ['source-e', '05-civilian-recollections.txt', 'https://corporate.nas.gov.sg/discover-archives/media/ww2comestosingapore/'],
  ['source-f', '06-explaining-japanese-success.txt', 'https://www.nids.mod.go.jp/publication/senshi/pdf/201603/09.pdf'],
  // Added 11 November 2026: two short real extracts, each checked word for word against the publication that quotes it.
  ['source-g', '07-heath-at-the-conference.txt', biblioAsia],
  ['source-h', '08-churchill-broadcast.txt', 'https://winstonchurchill.org/?p=6007'],
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
// Each document is a different kind of artefact with one job. All are reconstructions (real: false):
// only the words inside quotation marks that are attributed to Barth, Mosbergen, Heath and Goodman are real.
type Q = { prompt: string; correct: string; wrong: [string, string]; at: [number, number?]; also?: [number, number?][]; why: string; correctSlot: 0 | 1 | 2 }
type Doc = {
  id: string; kind: string; title: string; provenance: Record<string, string>; real: boolean; sourceLabel: string
  glossary: { term: string; meaning: string }[]; paragraphs: string[][]; key: [number, number?]; quotes: [string, string][]
  discovery: { id: string; stageId: string; text: string; note: string; core: boolean }
  questions: [Q, Q, Q, Q, Q] // four variants, then recovery
  recoveryFrom?: string[]
}
const reconstruction = (basis: string) => `Reconstruction for this adventure, based on ${basis}.`

const docs: Doc[] = [
  {
    // The deliberately slanted source. Its claims are contradicted by the signal, the strength return and the recollections.
    id: 'doc-notice', kind: 'other', title: 'Public notice: "Singapore will stand"',
    provenance: { masthead: 'Public notice', date: 'Early 1942 (reconstruction)', place: 'Pinned up at a civil-defence post' }, real: false,
    sourceLabel: `${reconstruction('the belief recalled in Source E (National Archives of Singapore)')} No real notice is copied. It is deliberately one-sided: it shows what many people were told to believe, not what was true.`,
    glossary: [{ term: 'impregnable', meaning: 'Impossible to capture.' }, { term: 'fortress', meaning: 'A place built to be defended against attack.' }],
    paragraphs: [[
      'To all residents: stay calm and carry on with your work.',
      'Singapore is an impregnable fortress.',
    ], [
      'Its great naval base was built to serve a battle fleet.',
      'Britain has promised to send that fleet if Japan threatens us.',
      'Our army on the island has more soldiers than the enemy.',
    ], [
      'No enemy can take this island.',
      'Rumours of danger help only the enemy, so do not spread them.',
    ]],
    key: [1], quotes: [['source-e', 'Singapore was an impregnable fortress']],
    discovery: { id: 'd-notice', stageId: 's1', core: false,
      text: 'A public notice tells residents that Singapore is "an impregnable fortress", pointing to the naval base, the promised fleet and the larger army.',
      note: 'The notice says Singapore is "an impregnable fortress": a naval base, a promised fleet, more soldiers. Is any of that the whole truth?' },
    questions: [
      { prompt: 'Why would a notice like this be pinned up for the public?', correct: 'To keep people calm and stop them worrying.', wrong: ['To warn people that an attack was coming soon.', 'To explain the army\'s battle plan to residents.'], at: [0], also: [[6], [5, 6]], correctSlot: 1, why: 'It opens with "stay calm" and ends by telling people not to spread rumours of danger.' },
      { prompt: 'Sam knows the two big warships were sunk in December. Which claim in the notice does that make misleading?', correct: 'That the fleet Britain promised would keep Singapore safe.', wrong: ['That Singapore had a naval base.', 'That residents should carry on with their work.'], at: [3], also: [[2, 3]], correctSlot: 0, why: 'The notice leans on a promised fleet. It says nothing about the ships that were lost.' },
      { prompt: 'How far should a historian trust this notice as evidence of how strong Singapore really was?', correct: 'Not far: it was written to reassure, so it leaves out problems.', wrong: ['Completely, because officials knew the real numbers.', 'Not at all, because every claim in it is false.'], at: [6], also: [[0], [5, 6]], correctSlot: 2, why: 'Some claims are true, such as the naval base. But a notice meant to calm people leaves out bad news.' },
      { prompt: 'The strength return says many soldiers were exhausted or new. Which claim in the notice does it challenge most?', correct: 'That having more soldiers made the island safe.', wrong: ['That there was a naval base on the island.', 'That people should not spread rumours.'], at: [4], also: [[4, 5]], correctSlot: 1, why: 'More soldiers is only reassuring if they are fit and experienced.' },
      { prompt: 'What does the notice want its readers to believe?', correct: 'That the island cannot be captured.', wrong: ['That the fleet has already arrived.', 'That residents should leave the city.'], at: [5], also: [[1]], correctSlot: 0, why: '"No enemy can take this island" is the notice\'s main message.' },
    ],
  },
  {
    id: 'doc-troops', kind: 'report', title: 'Strength return: troops on the island',
    provenance: { masthead: 'Strength return', date: 'Early February 1942 (reconstruction)', sender: 'Army headquarters, Fort Canning', recipient: 'General Percival' }, real: false,
    sourceLabel: `${reconstruction('Source C (National Library Board)')} No real return is copied, and it gives no figures because the sources do not.`,
    glossary: [{ term: 'strength return', meaning: 'A list of how many soldiers an army has.' }, { term: 'reinforcements', meaning: 'Extra soldiers sent to help.' }],
    paragraphs: [[
      'Total soldiers on the island: more than the enemy force.',
      'On paper, we outnumber the Japanese.',
    ], [
      'Remarks: many units came from Malaya exhausted after weeks of fighting and retreat.',
      'Other units are reinforcements who have only just arrived and have little experience.',
    ], [
      'A headcount alone does not show how strong an army is.',
      'A tired soldier and a new soldier each count as one on this list.',
    ]],
    key: [2, 3], quotes: [['source-c', 'it included exhausted troops from Malaya and inexperienced reinforcements']],
    discovery: { id: 'd-troops', stageId: 's1', core: true,
      text: 'The defenders outnumbered the attackers, but many were exhausted from the retreat through Malaya and others were newly arrived and inexperienced.',
      note: 'The strength return looks good until the remarks: many of our men are exhausted from Malaya, and the new ones are inexperienced.' },
    questions: [
      { prompt: 'Which of these does the return treat as the most serious problem?', correct: 'The headline total hides tired and untested soldiers.', wrong: ['The army has fewer soldiers than the enemy.', 'There are not enough weapons for the new soldiers.'], at: [4], also: [[2, 3], [5]], correctSlot: 2, why: 'The remarks and the last note both warn that the total is misleading.' },
      { prompt: 'Why does the writer add the line about "a tired soldier and a new soldier"?', correct: 'To show the list counts men, not how well they can fight.', wrong: ['To ask for more new soldiers to replace tired ones.', 'To show that tired soldiers fight better than new ones.'], at: [5], also: [[4, 5]], correctSlot: 0, why: 'Both count as one, but they cannot do the same job. The list hides that.' },
      { prompt: 'If Percival read only the first two lines, what impression would he get?', correct: 'That the island is well defended.', wrong: ['That his army is too small.', 'That his soldiers need rest.'], at: [0, 1], also: [[1]], correctSlot: 1, why: 'The opening lines only say the army outnumbers the Japanese. The warnings come later.' },
      { prompt: 'The public notice says the island is safe because the army has more soldiers. How would this return answer that?', correct: 'More soldiers does not always mean a stronger army.', wrong: ['The notice has the numbers wrong.', 'The notice is right, so there is nothing to worry about.'], at: [4], also: [[2, 3]], correctSlot: 0, why: 'The return agrees there are more soldiers, but says a headcount does not show strength.' },
      { prompt: 'According to the remarks, what is wrong with the units from Malaya?', correct: 'They are worn out from weeks of fighting.', wrong: ['They have never fought before.', 'They have not yet reached the island.'], at: [2], also: [[2, 3]], correctSlot: 2, why: 'They came from Malaya exhausted after weeks of fighting and retreat.' },
    ],
  },
  {
    id: 'doc-gemas', kind: 'report', title: 'Field report: after Gemas',
    provenance: { date: '31 January 1942 (reconstruction)', sender: 'Captain Arjun Singh (fictional)', recipient: 'Army headquarters' }, real: false,
    sourceLabel: `${reconstruction('Source B (Australian War Memorial)')} Written in the voice of the fictional Captain Arjun Singh.`,
    glossary: [{ term: 'ambush', meaning: 'A surprise attack from a hidden position.' }, { term: 'positions', meaning: 'Places where soldiers dig in to defend.' }],
    paragraphs: [[
      'Sir, our men did not lose every fight.',
      'Near Gemas on 14 January, Australian troops ambushed the Japanese.',
      'At Bakri, other Australian units destroyed Japanese tanks.',
    ], [
      'Still, we could not stop the enemy.',
      'Their troops moved fast, with aircraft overhead, and often went around our positions instead of attacking from the front.',
      'Each time, we had to pull back south.',
    ], [
      'With the war in Europe, Malaya was given too few tanks and aircraft.',
      'Today the last of our troops crossed into Singapore.',
    ]],
    key: [4, 5], quotes: [['source-b', 'Japanese forces combined mobility with air support and often moved around defensive positions instead of attacking only from the front.']],
    discovery: { id: 'd-gemas', stageId: 's1', core: true,
      text: 'Allied troops won fights at Gemas and Bakri, but Japanese forces moved fast with air support and went around defended positions, so the defenders kept pulling back.',
      note: 'Singh\'s report: we won at Gemas and Bakri, but the Japanese moved fast with aircraft and went around our positions, so we kept pulling back.' },
    questions: [
      { prompt: 'Singh opens with "our men did not lose every fight". Why might he want headquarters to know this?', correct: 'So the retreat is not blamed on soldiers who could not fight.', wrong: ['So headquarters will send his unit home to rest.', 'So headquarters believes the campaign is being won.'], at: [0], also: [[1, 2], [0, 1]], correctSlot: 1, why: 'He lists real wins first, then explains why they still had to retreat.' },
      { prompt: 'Which does Singh treat as the main reason for the retreat?', correct: 'The enemy moved fast and went around their positions.', wrong: ['His men were beaten in every battle.', 'They ran out of ammunition after Gemas.'], at: [4], also: [[4, 5], [3, 4]], correctSlot: 0, why: '"Each time, we had to pull back" follows straight after the enemy going around them.' },
      { prompt: 'Singh is writing about his own side\'s retreat. What should a reader keep in mind?', correct: 'He may stress his men\'s courage more than their mistakes.', wrong: ['He was not in Malaya, so he is only guessing.', 'He wrote it years later, so he may have forgotten.'], at: [0], also: [[3]], correctSlot: 2, why: 'He was there and wrote at the time, but an officer defending his men may not tell the whole story.' },
      { prompt: 'Percival plans to hold the places he thinks matter most. What does this report warn could happen?', correct: 'The enemy may go around them and strike somewhere else.', wrong: ['The enemy will attack the strongest point head-on.', 'The enemy will stop once a line is held.'], at: [4], also: [[4, 5]], correctSlot: 1, why: 'In Malaya the Japanese often went around positions instead of attacking from the front.' },
      { prompt: 'What does Singh link to the shortage of tanks and aircraft?', correct: 'The war in Europe.', wrong: ['Japanese bombing in December.', 'The jungle roads of Malaya.'], at: [6], correctSlot: 0, why: 'He says that with the war in Europe, Malaya was given too few.' },
    ],
  },
  {
    id: 'doc-fleet', kind: 'telegram', title: 'Signal: the two great ships',
    provenance: { date: '10 December 1941 (reconstruction)', recipient: 'Headquarters, Singapore', place: 'File copy, signals and records room' }, real: false,
    sourceLabel: `${reconstruction('Source A (Royal Australian Navy history)')} Not the text of a real signal.`,
    glossary: [{ term: 'naval base', meaning: 'A harbour where warships are repaired and supplied.' }, { term: 'fleet', meaning: 'A large group of warships.' }],
    paragraphs: [[
      'Most urgent: Prince of Wales and Repulse sunk off Malaya today.',
      'Both ships were hit by Japanese aircraft.',
    ], [
      'They belonged to Force Z, a smaller force.',
      'The battle fleet promised for Singapore has not arrived.',
    ], [
      'The naval base can repair and supply ships, but it has no fleet to use.',
      'Warning: ships at sea are in serious danger from aircraft.',
    ]],
    key: [3, 4], quotes: [['source-a', 'When Japan attacked in December 1941, the promised fleet had not arrived.'], ['source-a', 'Japanese aircraft sank both ships off Malaya on 10 December.']],
    discovery: { id: 'd-fleet', stageId: 's1', core: true,
      text: 'A December signal: Japanese aircraft sank Prince of Wales and Repulse on 10 December 1941, the promised battle fleet had not arrived, and the naval base had no fleet to use.',
      note: 'December signal: Japanese planes sank Prince of Wales and Repulse. The promised fleet never arrived, so the naval base has no fleet.' },
    questions: [
      { prompt: 'Why does the signal mention the naval base at all?', correct: 'To point out that a base is no use without ships.', wrong: ['To report that the base had been bombed.', 'To say the two ships could be repaired there.'], at: [4], also: [[3, 4]], correctSlot: 2, why: 'The base can repair and supply ships, but there is no fleet for it to serve.' },
      { prompt: 'Which claim in the public notice does this signal challenge most directly?', correct: 'That Britain\'s promised fleet would keep Singapore safe.', wrong: ['That residents should stay calm.', 'That the army had more soldiers than the enemy.'], at: [3], also: [[3, 4]], correctSlot: 0, why: 'The notice relies on the promised fleet. The signal says it has not arrived.' },
      { prompt: 'Which does the signal treat as the most worrying lesson for the future?', correct: 'Aircraft can destroy warships at sea.', wrong: ['The naval base is too small.', 'Force Z sailed without enough ammunition.'], at: [5], also: [[1]], correctSlot: 1, why: 'It ends with a warning that ships at sea are in serious danger from aircraft.' },
      { prompt: 'What does "a smaller force" tell you about what Britain actually sent?', correct: 'Less than the full fleet that had been promised.', wrong: ['More ships than the plan had asked for.', 'Only aircraft, with no ships at all.'], at: [2], also: [[2, 3]], correctSlot: 0, why: 'Force Z was smaller, and the promised battle fleet had not arrived.' },
      { prompt: 'According to the signal, what sank the two ships?', correct: 'Japanese aircraft.', wrong: ['Japanese submarines.', 'Japanese warships.'], at: [1], also: [[0, 1]], correctSlot: 2, why: 'Both ships were hit by Japanese aircraft.' },
    ],
  },
  {
    id: 'doc-voices', kind: 'memoir', title: 'Remembered later: the fortress and the sirens',
    provenance: { date: 'Interviews recorded in 1984 and 2006', sender: 'National Archives of Singapore oral histories' }, real: false,
    sourceLabel: `${reconstruction('Source E (National Archives of Singapore)')} The two quotations are real, as published by the National Archives; the words around them are written for this adventure.`,
    glossary: [{ term: 'impregnable', meaning: 'Impossible to capture.' }, { term: 'civil defence', meaning: 'Volunteers who protect and help ordinary people during attacks.' }],
    paragraphs: [[
      'Ronald Hubert Barth was interviewed in 1984.',
      'He recalled the belief that "Singapore was an impregnable fortress".',
    ], [
      'Rudy William Mosbergen was interviewed in 2006.',
      'He recalled the first Japanese air raid: "But the air raid sirens were sounding when the Japanese bombers had left."',
      'Civil-defence workers helped people wounded in the air raids.',
    ], [
      'Both men spoke decades after the war.',
      'Their memories are their own, not a survey of everyone in Singapore.',
    ]],
    key: [3], quotes: [['source-e', 'But the air raid sirens were sounding when the Japanese bombers had left.'], ['source-e', 'Singapore was an impregnable fortress']],
    discovery: { id: 'd-fortress', stageId: 's1', core: false,
      text: 'People remembered believing Singapore was "an impregnable fortress", yet at the first air raid the sirens sounded only after the bombers had left.',
      note: 'Remembered later: people believed in "an impregnable fortress", but at the first air raid the sirens sounded after the bombers had gone.' },
    questions: [
      { prompt: 'What does the word "But" at the start of Mosbergen\'s words suggest?', correct: 'Something went wrong compared with what people expected.', wrong: ['He was about to praise the warning system.', 'The bombers turned back before reaching the city.'], at: [3], correctSlot: 0, why: '"But" sets up a contrast: the warning came only after the bombers had gone.' },
      { prompt: 'Which belief does Mosbergen\'s memory challenge?', correct: 'That Singapore was too well defended to be hurt.', wrong: ['That Japan had aircraft that could reach Singapore.', 'That civil-defence workers were needed.'], at: [3], also: [[3, 4]], correctSlot: 2, why: 'A fortress whose sirens sound after the bombing has not protected its people.' },
      { prompt: 'Why must a historian be careful with these two memories?', correct: 'They were recorded decades later and show only two people\'s experiences.', wrong: ['They come from Japanese soldiers, who might exaggerate.', 'They were written down during the air raid, in a panic.'], at: [5, 6], also: [[6]], correctSlot: 1, why: 'The interviews took place decades later, and two people cannot speak for everyone.' },
      { prompt: 'What do these memories add that an army report would not?', correct: 'How the war felt to people living in the city.', wrong: ['Exact numbers of soldiers on each side.', 'The orders the generals gave.'], at: [4], also: [[3, 4], [6]], correctSlot: 0, why: 'They tell us about sirens, bombs and wounded civilians, seen by people who lived there.' },
      { prompt: 'What did Barth remember people believing?', correct: 'That Singapore could not be captured.', wrong: ['That the war would never reach Asia.', 'That the fleet had already arrived.'], at: [1], also: [[0, 1]], correctSlot: 1, why: '"Impregnable" means impossible to capture.' },
    ],
  },
  {
    id: 'doc-island', kind: 'report', title: 'Signals log: one week on the island',
    provenance: { masthead: 'Signals log', date: '8–11 February 1942 (reconstruction)', place: 'Signals room, Fort Canning' }, real: false,
    sourceLabel: `${reconstruction('Source C (National Library Board)')} The entries are written for this adventure, not copied from a real log.`,
    glossary: [{ term: 'Johor Strait', meaning: 'The narrow sea between Johor and Singapore.' }, { term: 'depot', meaning: 'A place where supplies are stored.' }],
    paragraphs: [[
      '8 February: Japanese troops have crossed the Johor Strait.',
      'They have landed on the northwest coast.',
    ], [
      'Later: the enemy is advancing towards Bukit Timah, where our fuel and supply depots are.',
    ], [
      'Later: our units have pulled back from the Kranji–Jurong defence line.',
      'It seems orders were misunderstood.',
    ], [
      '11 February: Bukit Timah has been captured, with its depots.',
      'Resistance continues.',
    ]],
    key: [3, 4], quotes: [['source-c', 'Misunderstood orders contributed to an Allied withdrawal from the Kranji-Jurong defence line.']],
    discovery: { id: 'd-bukit-timah', stageId: 's2', core: true,
      text: 'Misunderstood orders helped cause a withdrawal from the Kranji–Jurong line, and on 11 February the Japanese captured Bukit Timah and its fuel and supply depots.',
      note: 'Signals log: confused orders weakened the Kranji–Jurong line. Then Bukit Timah and its supply depots were lost on 11 February.' },
    questions: [
      { prompt: 'Which entry suggests the worst problem for the days ahead?', correct: 'Losing Bukit Timah and its depots.', wrong: ['The first landing on the northwest coast.', 'Units pulling back to rest in the city.'], at: [5], also: [[2], [5, 6]], correctSlot: 1, why: 'Bukit Timah held the fuel and supply depots. Without them, the fighting gets harder every day.' },
      { prompt: 'What does "It seems orders were misunderstood" suggest about why the line was given up?', correct: 'Confusion on their own side, not only enemy attacks.', wrong: ['The soldiers refused to obey their officers.', 'The enemy had captured the orders.'], at: [4], also: [[3, 4]], correctSlot: 0, why: 'The units pulled back because orders were misunderstood.' },
      { prompt: 'Someone says, "Once Bukit Timah fell, the defenders gave up." Which entry challenges this?', correct: '"Resistance continues."', wrong: ['"They have landed on the northwest coast."', '"The enemy is advancing towards Bukit Timah."'], at: [6], also: [[5, 6]], correctSlot: 2, why: 'The log records that resistance went on after Bukit Timah was captured.' },
      { prompt: 'Percival expected the main attack in the east. What does the first entry tell him?', correct: 'The attack came somewhere else: the northwest.', wrong: ['The attack came in the east, as he planned.', 'The enemy has not landed yet.'], at: [1], also: [[0, 1]], correctSlot: 0, why: 'The Japanese landed on the northwest coast on 8 February.' },
      { prompt: 'Why was the enemy heading for Bukit Timah, according to the log?', correct: 'Fuel and supply depots were there.', wrong: ['It was the shortest road to the naval base.', 'Army headquarters was there.'], at: [2], correctSlot: 1, why: 'The log says the fuel and supply depots were at Bukit Timah.' },
    ],
  },
  {
    id: 'doc-battlebox', kind: 'minutes', title: 'Conference notes: the Battlebox, 15 February',
    provenance: { date: '15 February 1942 (reconstruction)', place: 'The Battlebox, Fort Canning' }, real: false,
    sourceLabel: `${reconstruction('Source D and Source G (BiblioAsia, 2024)')} Heath's words are real, from Percival's notes of the meeting as quoted in Source G. Goodman's words are real, from his diary as quoted in Source D. The rest is written for this adventure.`,
    glossary: [{ term: 'Battlebox', meaning: 'An underground command centre at Fort Canning.' }, { term: 'counterattack', meaning: 'An attack to win back ground from the enemy.' }, { term: 'folly', meaning: 'A very foolish act.' }, { term: 'appreciate', meaning: 'Here: understand properly.' }],
    paragraphs: [[
      'Present: General Percival and eleven other officers.',
      'Reports heard on water, ammunition, food and the worsening situation for civilians.',
    ], [
      'General Heath argued that "there is only one possible course to adopt": to surrender.',
      'He warned that "to sacrifice countless lives by a failure to appreciate the true situation would be an act of extreme folly".',
      'General Bennett rejected a proposed counterattack.',
      'Simmons was reluctant to surrender, but could see no other choice.',
      'The decision rests with General Percival.',
    ], [
      'Brigadier Goodman\'s diary describes the conference: "it was useless to continue the fight as water and ammunition were failing".',
    ]],
    key: [7], quotes: [
      ['source-d', 'it was useless to continue the fight as water and ammunition were failing'],
      ['source-g', 'there is only one possible course to adopt'],
      ['source-g', 'to sacrifice countless lives by a failure to appreciate the true situation would be an act of extreme folly'],
    ],
    discovery: { id: 'd-goodman', stageId: 's2', core: true,
      text: 'At the Battlebox meeting on 15 February, Brigadier Goodman wrote that "it was useless to continue the fight as water and ammunition were failing".',
      note: 'Goodman\'s diary: it was "useless to continue the fight as water and ammunition were failing".' },
    questions: [
      { prompt: 'Which of these does Heath treat as the most serious danger?', correct: 'Losing many lives by misjudging the situation.', wrong: ['Running out of food before the water.', 'Being blamed for the defeat afterwards.'], at: [3], also: [[2, 3]], correctSlot: 2, why: 'He warns against sacrificing "countless lives" through failing to understand the true situation.' },
      { prompt: 'How is Simmons\'s view different from Heath\'s?', correct: 'Simmons did not want to surrender, though he saw no alternative.', wrong: ['Simmons wanted a counterattack, unlike Heath.', 'Simmons thought help would arrive in time.'], at: [5], also: [[4, 5], [5, 6]], correctSlot: 0, why: 'Heath argued for surrender. Simmons was reluctant, but could see no other choice.' },
      { prompt: 'Goodman\'s diary agrees with Heath. Does that prove there was no other choice?', correct: 'No: it shows what two commanders believed at the time.', wrong: ['Yes: two officers saying it makes it certain.', 'No: the notes say Percival ignored them both.'], at: [7], also: [[2]], correctSlot: 1, why: 'Their views are good evidence of how the commanders saw things that day, not proof of every possibility.' },
      { prompt: 'Why would the notes record the reports on water, food and civilians first?', correct: 'They were the facts the officers had to weigh before deciding.', wrong: ['They were the only things the officers agreed about.', 'They were added after the surrender as excuses.'], at: [1], also: [[0, 1]], correctSlot: 0, why: 'The views that follow, from Heath to Goodman, respond to those reports.' },
      { prompt: 'What reasons does Goodman\'s diary give for ending the fight?', correct: 'Water and ammunition were failing.', wrong: ['London had ordered them to stop.', 'Bennett\'s counterattack had failed.'], at: [7], also: [[6, 7]], correctSlot: 2, why: 'Goodman wrote that water and ammunition were failing.' },
    ],
    recoveryFrom: ['d-bukit-timah'],
  },
]

function buildDocument(d: Doc) {
  const body = d.paragraphs.map(p => p.join(' ')).join('\n\n')
  const spans = sourceSentenceSpans(body)
  const expected = d.paragraphs.flat()
  const found = spans.map(s => body.slice(s.start, s.end))
  if (found.join('\n') !== expected.join('\n')) throw Error(`${d.id}: sentences found differ from those written:\n${found.join('\n')}`)
  const words = body.split(/\s+/).length
  if (words < 55 || words > 135) throw Error(`${d.id}: ${words} words; keep documents short`)
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
    citations: d.quotes.map(q => cite(...q)),
    readingCheck: {
      discoveryId: d.discovery.id,
      variants: d.questions.slice(0, 4).map((q, i) => question(q, `q${i + 1}`)),
      recovery: question(d.questions[4], 'recovery'),
      recoveryDiscoveryIds: d.recoveryFrom ?? [],
    },
  }
}


// ---------- characters ----------
// The engine's system prompt owns reply length, reading level, deflection and "who might know". These fields give
// each person a voice, a life to talk about, a want, and a few hard limits. knewThen completes the sentence
// "You know only what someone in your position could know at this moment: ___. You know nothing of later events."
const noLanding = 'Until the scene says the Japanese have landed on the island, do not mention or guess where or when they will land.'
const realLimits = 'Real person: do not invent quotations, orders, numbers or private feelings.'
const fictionalLimits = 'Fictional character: invent no battles, numbers, dates, orders or named real people.'
const invented = 'Invented turn of phrase for a fictional character'
const phrase = (text: string) => ({ text, sourceLabel: invented })
const persona = (p: { voice: string; phrases?: string[]; knewThen: string; wants: string; withholds?: string[]; position: string; agenda: string }) => ({
  voice: p.voice, phrases: (p.phrases ?? []).map(phrase), knewThen: p.knewThen, wantsFromStudent: p.wants, withholds: p.withholds ?? [], publicPosition: p.position, privateAgenda: p.agenda,
})
const characters = [
  {
    id: 'percival', name: 'Arthur Percival', title: 'Lieutenant-General, army commander in Malaya', real: true, tier: 'major',
    persona: persona({
      voice: 'Formal, precise and courteous, like a staff officer giving a briefing. Builds an argument point by point and expects the same of others. Calls Sam by name and never raises his voice.',
      knewThen: 'the reports, signals and plans that reach the army commander at Fort Canning up to the date of the scene, including your own two reasons for your plan: the defenders outnumber the Japanese, and you expect the main attack in the east, near the naval base, where your strongest forces are',
      wants: 'For Sam to bring him evidence that tests his plan: reports, signals and first-hand accounts, not opinions.',
      position: 'Before the landing: his plan rests on two sound reasons. Once the island is under attack: the decision about what comes next is his, and he wants it made on the facts.',
      agenda: `Before the landing, wants the plan he has made on his two reasons to be given its chance. Once the island is under attack, wants an honest account of what is left. Either way, when a point is answered with evidence, he says so plainly. Free to talk about: the maps in front of him, the stream of reports and telephone calls, the long hours, his duty to the army and the city. ${realLimits} ${noLanding}`,
    }),
    // Stances are how far Percival trusts Sam's evidence. They carry into stage 2, where stage 1 conduct sets them.
    stances: [
      { id: 'percival-confident', label: 'Guarded', demeanour: 'Sure of his own judgement and cool towards Sam. Courteous but brief: answers what he is asked, then asks what evidence Sam has.' },
      { id: 'percival-doubtful', label: 'Listening', demeanour: 'Has begun to take Sam\'s evidence seriously. Talks more openly, but tests every point and defends whatever has not been answered.' },
      { id: 'percival-convinced', label: 'Trusting', demeanour: 'Treats Sam as someone whose evidence has proved sound. Speaks frankly about how serious things are and asks for Sam\'s honest view.' },
    ],
    initialStanceId: 'percival-confident', slants: [],
    trustNotice: 'Percival becomes more guarded. He wants evidence, not guesses.',
  },
  {
    id: 'arjun', name: 'Captain Arjun Singh', title: 'Indian Army liaison officer (fictional character)', real: false, tier: 'major',
    persona: persona({
      voice: 'Calm, dry and plain-spoken, with a tired soldier\'s humour. Says "my men" a lot. His uniform has seen weeks of hard use, and he has not slept properly since Malaya.',
      phrases: ['Ask the men who were there.', 'Brave men still need tanks and aircraft.', 'Paper is easy. Men are hard.'],
      knewThen: 'the retreat through Malaya as your unit lived it, the state of your men, your own field report, and the news at Fort Canning up to the date of the scene',
      wants: 'For Sam to take what his men have seen seriously and carry it to the General, instead of stopping at the first line of a report.',
      withholds: ['how much it stings to hear his men called beaten', 'how worn out he is himself'],
      position: 'His soldiers fought well; the retreat was not their fault.',
      agenda: `Wants his men seen as people, not numbers on a list, and has no patience for officers who read only the first line of a report. Before the island is attacked, his worry is that nobody reads his field report; once it is under attack, his worry is his men and whatever the next signal brings. Free to talk about: men asleep wherever they can sit down, the heat, the paperwork, the telephones, how worn down everyone is, how proud he is of his men. ${fictionalLimits} ${noLanding}`,
    }),
    stances: [
      { id: 'arjun-tired', label: 'Wary', demeanour: 'Worn down and wary of Sam. Answers, but keeps his distance, doubts that Sam really listens, and talks about his men rather than plans.' },
      { id: 'arjun-open', label: 'Open', demeanour: 'Warmer towards Sam, who has listened. Explains plainly what he has seen and why it matters.' },
      { id: 'arjun-frank', label: 'Frank', demeanour: 'Trusts Sam. Says hard things straight, even about hopes he would rather keep.' },
    ],
    initialStanceId: 'arjun-tired', slants: [],
    trustNotice: 'Arjun goes quiet. He is not sure you are listening.',
  },
  {
    id: 'ong', name: 'Mrs Ong Bee Lian', title: 'Civil-defence volunteer (fictional character)', real: false, tier: 'minor',
    persona: persona({
      voice: 'Warm, brisk and motherly, always half-busy: counting bandages, checking stretchers, calling to a volunteer. Talks about her neighbours by what they do, like the hawker or the schoolteacher, never by name. She likes Sam, but thinks officers forget ordinary people.',
      phrases: ['Bandages first, talk later.', 'The siren is the loudest thing on this street.', 'Ordinary people pay first.'],
      knewThen: 'life at your civil-defence post as you have lived it up to the date of the scene: the air raids, the people your volunteers have helped, and the public notice by your door that calls Singapore an impregnable fortress',
      wants: 'For the officers, and Sam, to remember the ordinary people of the city when they make their plans.',
      withholds: ['how frightened she is for her own family when the siren sounds'],
      position: 'The war has already reached ordinary people. Before the island is attacked, she trusts the notice that says the fortress will hold; once it is attacked, she says ordinary people are paying for what they were told.',
      agenda: `Wants civilians remembered. Before the island is attacked she defends the notice, because believing it keeps her volunteers steady, but she listens to real evidence. Once the island is under attack she no longer defends it; she is sad and angry that so many believed it. Free to talk about: stretchers, bandages and the siren on the roof, her tired volunteers, frightened neighbours. No graphic descriptions of injuries. ${fictionalLimits} ${noLanding}`,
    }),
    stances: [], initialStanceId: null,
    slants: [{ id: 'ong-fortress', claim: 'Singapore is an impregnable fortress, just as the notice says, so the city will be safe (her view before the island is attacked)', contradictedBy: ['d-fleet', 'd-fortress', 'd-troops'], unlocksDiscoveryId: 'd-ong-warning' }],
  },
  {
    id: 'hamid', name: 'Corporal Hamid bin Osman', title: 'Malay Regiment soldier (fictional character)', real: false, tier: 'minor',
    persona: persona({
      voice: 'Proud, direct and steady, a regular soldier who keeps his uniform neat even now. Speaks in short sentences and lets silences sit. Respects Sam if Sam listens, and bristles at anyone who talks down to local soldiers.',
      phrases: ['This is our home we are defending.', 'Do not tell me we gave up.', 'A soldier keeps his rifle clean, whatever comes.'],
      knewThen: 'what a corporal of the Malay Regiment, a locally raised regular regiment, knows on 15 February 1942: that your regiment fought strongly at Pasir Panjang on 13 and 14 February before being overwhelmed, and what soldiers passing through the city are saying',
      wants: 'For Sam to make sure the officers know local soldiers fought too.',
      withholds: ['how afraid he was at Pasir Panjang'],
      position: 'The Malay Regiment fought hard for Singapore.',
      agenda: `Wants local soldiers remembered in the story of the defence, and is angry at any suggestion that the defenders simply gave up. Free to talk about: how tired he is, his pride in his regiment, his worry for the city and his family in it. No graphic detail of fighting or injuries, and tell no named real soldier's story. ${fictionalLimits}`,
    }),
    stances: [], initialStanceId: null, slants: [],
  },
  {
    id: 'bennett', name: 'Gordon Bennett', title: 'Major-General, Australian commander at the Battlebox meeting', real: true, tier: 'minor',
    persona: persona({
      voice: 'Sharp, blunt and impatient. Short, clipped lines; dislikes being second-guessed by a junior officer, but answers a straight question straight.',
      knewThen: 'what the Australian commander knows at the Battlebox meeting on 15 February 1942: the reports the meeting is hearing on water, ammunition, food and civilians, and that you dismissed the proposed counterattack',
      wants: 'For Sam to understand why the counterattack was dismissed, and not to waste the meeting\'s time.',
      position: 'He dismissed the proposed counterattack.',
      agenda: `Wants the meeting to face the reports squarely. Speaks only for himself, never for the other officers, and gives no reason for his view beyond the reports the meeting is hearing. Free to talk about: the crowded, stuffy room, the ringing telephones, his impatience with talk. ${realLimits}`,
    }),
    stances: [], initialStanceId: null, slants: [],
  },
]

// ---------- discoveries held by characters ----------
const topics: Record<string, string> = {
  'd-arjun-retreat': 'why his men kept retreating after winning at Gemas',
  'd-no-help': 'whether any help can still come',
  'd-no-city': 'whether the city could hold out',
  'd-ong-warning': 'whether the city is as safe as the notice says',
  'd-hamid-courage': 'what courage could not replace',
  'd-bennett-heath': 'whom he agreed with at the meeting',
}
const talk = (id: string, stageId: string, characterId: string, text: string, note: string, sourceLabel: string, citations: { sourceId: string; quote?: string }[], condition?: object) =>
  ({ id, stageId, holder: { characterId }, text, note, ...(topics[id] ? { topic: topics[id] } : {}), core: false, sourceLabel, citations, ...(condition ? { condition } : {}) })
const s1Outcomes = ['o-plan-kept', 'o-refused', 'o-check', 'o-convinced']
const sideBySide = { act: { momentId: 'm-briefing', actId: 'a-side-by-side' } }
const briefing = (outcomeId: string) => ({ outcome: { momentId: 'm-briefing', outcomeId } })
const anyBriefing = (...ids: string[]) => ({ any: ids.map(briefing) })
const passedTo = (characterId: string, discoveryId: string) => ({ notePassed: { discoveryId, characterId } })
const passedToPercival = (discoveryId: string) => passedTo('percival', discoveryId)
// Stage 1 conduct, remembered in stage 2.
const answeredMen = { any: [passedToPercival('d-troops'), passedToPercival('d-arjun-tired')] }
const answeredEast = { any: [passedToPercival('d-gemas'), passedToPercival('d-arjun-retreat')] }
const singhHeard = { any: [passedToPercival('d-arjun-tired'), passedToPercival('d-arjun-retreat'), passedToPercival('d-gemas')] }
const singhWarm = { all: [singhHeard, { not: briefing('o-plan-kept') }] }
const landingCite = cite('source-c', 'landed on Singapore\'s northwestern coast on 8 February')
const dramatised = (basis: string) => `Reconstructed dialogue, dramatised around your fictional role; ${basis}`
const spoken = [
  // ----- Stage 1 -----
  talk('d-percival-plan', 's1', 'percival',
    'Percival is confident in his plan for two reasons: the defenders outnumber the Japanese, and he expects the main attack in the east, near the naval base, where his strongest forces are.',
    'Percival\'s plan rests on two reasons: we have more men, and the attack will come in the east near the naval base.',
    'Reconstructed dialogue; the larger garrison is in Source C, and his eastern expectation is well-documented context outside the eight lesson sources',
    [cite('source-c', 'Although the Allied garrison was numerically larger')]),
  // Reason 1 (more men), the people route: Singh's own testimony, available on first contact.
  talk('d-arjun-tired', 's1', 'arjun',
    'Arjun says many of the men who came back from Malaya are exhausted after weeks of fighting and retreat, and the newest reinforcements have little experience. On a strength return, each still counts as one soldier.',
    'Singh: the men back from Malaya are exhausted, and the new reinforcements are inexperienced. On paper they all count the same.',
    'Fictional character; based on Source C', [cite('source-c', 'it included exhausted troops from Malaya and inexperienced reinforcements')]),
  // Reason 2 (the east), the people route: Singh explains his report once Sam has read it.
  talk('d-arjun-retreat', 's1', 'arjun',
    'Arjun says his soldiers won fights in Malaya, but again and again the Japanese moved around their positions instead of attacking from the front, so they had to pull back south.',
    'Singh: we won fights, but the Japanese kept going around our positions instead of attacking from the front, so we had to pull back.',
    'Fictional character; based on Source B', [cite('source-b', 'often moved around defensive positions instead of attacking only from the front'), cite('source-b', 'Defenders repeatedly withdrew southwards.')],
    passedTo('arjun', 'd-gemas')),
  talk('d-ong-raids', 's1', 'ong',
    'Mrs Ong says civil-defence workers are helping people wounded in air raids. The war has already reached ordinary people in the city.',
    'Mrs Ong: the war has already reached ordinary people. Civil-defence workers are helping the wounded from air raids.',
    'Fictional character; based on Source E', [cite('source-e', 'civil-defence workers assisting people wounded in air raids')]),
  // The fortress belief: shown evidence against the notice, Mrs Ong changes her mind. Part of the secret act.
  talk('d-ong-warning', 's1', 'ong',
    'Mrs Ong admits the notice tells only half the story. Her volunteers are already helping people wounded in air raids, and a fortress on a notice has not kept the city safe.',
    'Mrs Ong: the notice tells half the story. The raids have already hurt ordinary people; a fortress on paper does not keep the city safe.',
    'Fictional character; based on Source E', [cite('source-e', 'civil-defence workers assisting people wounded in air raids'), cite('source-e', 'Military defeat affected civilians before the surrender itself.')],
    { slantConfronted: 'ong-fortress' }),
  // ----- Stage 2: Percival's task -----
  talk('d-percival-situation', 's2', 'percival',
    'Percival says water and ammunition are running low, and he must decide whether the army can keep fighting.',
    'Percival: water and ammunition are running low. He must decide whether we can keep fighting.',
    'Reconstructed dialogue; the meeting\'s reports are in Source D', [cite('source-d', 'Percival remained responsible for the decision, but the consultation involved others.')]),
  // ----- Stage 2: what Percival remembers of Sam's advice (exactly one applies) -----
  talk('d-recall-kept', 's2', 'percival',
    'Percival reminds Sam that Sam advised keeping the strongest forces in the east, and that he agreed. The Japanese landed in the northwest instead. The decision, he says, was his.',
    'Percival: I backed his plan to hold the east, and the attack came in the northwest. He says the decision was his.',
    dramatised('landing from Source C'), [landingCite],
    { all: [briefing('o-plan-kept'), { not: answeredEast }] }),
  talk('d-recall-ignored', 's2', 'percival',
    'Percival points out that Sam showed him how the Japanese went around positions in Malaya, and then advised keeping the strongest forces in the east all the same. The Japanese landed in the northwest.',
    'Percival: I showed him they go around defences, then told him to keep the east anyway. They landed in the northwest.',
    dramatised('based on Sources B and C'), [cite('source-b', 'often moved around defensive positions'), landingCite],
    { all: [briefing('o-plan-kept'), answeredEast] }),
  talk('d-recall-refused', 's2', 'percival',
    'Percival tells Sam that the warning about the northwest proved right, but it came without the evidence that could have moved an army.',
    'Percival: my warning about the northwest was right, but I had not shown him enough evidence to move an army.',
    dramatised('landing from Source C'), [landingCite],
    briefing('o-refused')),
  talk('d-recall-partly', 's2', 'percival',
    'Percival tells Sam that the doubt they raised about the northwest was right, but the plan had not changed before the attack came there.',
    'Percival: the doubt I raised about the northwest was right, but the plan had not changed in time.',
    dramatised('landing from Source C'), [landingCite],
    { all: [briefing('o-check'), { not: sideBySide }] }),
  talk('d-recall-convinced', 's2', 'percival',
    'Percival tells Sam they were right about the weak spots, but the troops he had were exhausted or inexperienced, and there was no time to fix it.',
    'Percival: I was right about the weak spots, but there were no fresh troops and no time to fix them.',
    dramatised('based on Source C'), [cite('source-c', 'it included exhausted troops from Malaya and inexperienced reinforcements')],
    { all: [briefing('o-convinced'), { not: sideBySide }] }),
  talk('d-recall-trusted', 's2', 'percival',
    'Percival tells Sam that the notes they laid side by side before the landing showed the weak spots clearly: tired troops, an enemy that went around positions, and a city less safe than the notices said. It came too late to change the result.',
    'Percival: my notes side by side showed the weak spots clearly. It came too late to change the result.',
    dramatised('based on Sources B, C and E'), [cite('source-c', 'it included exhausted troops from Malaya and inexperienced reinforcements'), cite('source-b', 'often moved around defensive positions')],
    sideBySide),
  // ----- Stage 2: way out 1, a counterattack -----
  talk('d-bennett', 's2', 'bennett',
    'Bennett says he dismissed the proposed counterattack. He points to the reports on water and ammunition.',
    'Way out 1, counterattack: Bennett dismissed it. Ammunition is failing.',
    'Reconstructed dialogue; position from Sources D and G', [cite('source-g', 'dismissed Percival\'s proposal for a counterattack'), cite('source-d', 'Bennett as rejecting a proposed counterattack')]),
  talk('d-bennett-heath', 's2', 'bennett',
    'Shown Goodman\'s diary, Bennett says he agreed with Heath, who argued that surrender was the only possible course.',
    'Bennett: he agreed with Heath that surrender was the only course left.',
    'Reconstructed dialogue; position from Source G', [cite('source-g', 'Bennett agreed with Heath'), cite('source-g', 'there is only one possible course to adopt')],
    passedTo('bennett', 'd-goodman')),
  // ----- Stage 2: Singh remembers what Sam did with his evidence -----
  talk('d-arjun-cold', 's2', 'arjun',
    'Arjun reminds Sam that in Malaya the Japanese went around positions instead of attacking from the front, and that Sam advised keeping the strongest forces in the east. They landed in the northwest.',
    'Singh: in Malaya they went around us. I still advised keeping the east, and they landed in the northwest.',
    'Fictional character, reacting to your advice; based on Sources B and C', [cite('source-b', 'often moved around defensive positions'), landingCite],
    briefing('o-plan-kept')),
  talk('d-arjun-warm', 's2', 'arjun',
    'Arjun says Sam carried what his men learned in Malaya to the General before the landing, which is more than most officers did. It did not stop the landing in the northwest.',
    'Singh: I took his men\'s story to the General before the landing. It did not stop it, but he has not forgotten.',
    'Fictional character, reacting to your advice; landing from Source C', [landingCite],
    singhWarm),
  // Way out 2, holding on for help. Singh clings to hope, unless Sam earned his trust in stage 1.
  talk('d-arjun-hope', 's2', 'arjun',
    'Arjun hopes that if the army holds on a little longer, help may still come.',
    'Singh hopes help may still come if we hold on.',
    'Fictional character; a hope, not a fact', [], { not: singhWarm }),
  talk('d-no-help', 's2', 'arjun',
    'Arjun accepts that no fleet is coming: the promised fleet never came, and the two big ships were sunk. Holding on would only delay the end.',
    'Way out 2, hold on for help: no fleet is coming. The big ships were sunk in December.',
    'Fictional character; based on Source A', [cite('source-a', 'When Japan attacked in December 1941, the promised fleet had not arrived.')],
    { any: [passedTo('arjun', 'd-fleet'), singhWarm] }),
  // ----- Stage 2: Mrs Ong remembers whether Sam listened about the notice -----
  talk('d-ong-remembers', 's2', 'ong',
    'Mrs Ong remembers that, before the island was attacked, Sam showed her the notice told only half the story. She stopped repeating it then. Now things grow worse for civilians every day.',
    'Mrs Ong: she remembers I told her the truth about the notice. She stopped repeating it then.',
    'Fictional character, reacting to what you did; based on Source D', [cite('source-d', 'the worsening civilian situation')],
    { discovered: 'd-ong-warning' }),
  talk('d-ong-believed', 's2', 'ong',
    'Mrs Ong says she believed the notice that called Singapore an impregnable fortress, as so many people did. Now things grow worse for civilians every day.',
    'Mrs Ong: she believed the notice, like so many people. Now things are worse for civilians every day.',
    'Fictional character; based on Sources D and E', [cite('source-e', 'Singapore was an impregnable fortress'), cite('source-d', 'the worsening civilian situation')],
    { not: { discovered: 'd-ong-warning' } }),
  // Way out 3, fighting on in the city. If Sam listened to her in stage 1, she says it straight away.
  talk('d-no-city', 's2', 'ong',
    'Mrs Ong says that without water the city cannot hold out, and ordinary people are suffering more each day.',
    'Way out 3, fight on in the city: without water the city cannot hold out, and civilians are suffering.',
    'Fictional character; based on Source D', [cite('source-d', 'the worsening civilian situation')],
    { any: [passedTo('ong', 'd-goodman'), { discovered: 'd-ong-warning' }] }),
  talk('d-hamid-pasir', 's2', 'hamid',
    'Hamid says the Malay Regiment fought strongly at Pasir Panjang on 13 and 14 February before being overwhelmed.',
    'Hamid: the Malay Regiment fought hard at Pasir Panjang on 13–14 February before being overwhelmed.',
    'Fictional character; based on Source C', [cite('source-c', 'The Malay Regiment fought strongly at Pasir Panjang on 13–14 February, before being overwhelmed.')]),
  // Did the defenders give up? Part of the stage 2 secret act.
  talk('d-hamid-courage', 's2', 'hamid',
    'Shown the signals log, Hamid says the defenders did not give up: they kept fighting after Bukit Timah fell, and the Malay Regiment fought at Pasir Panjang. What they lost at Bukit Timah was fuel and supplies, and courage cannot replace those.',
    'Hamid: we did not give up. We kept fighting after Bukit Timah fell. What ran out was supplies, not courage.',
    'Fictional character; based on Source C', [cite('source-c', 'Allied resistance continued.'), cite('source-c', 'an area containing important fuel and supply depots')],
    passedTo('hamid', 'd-bukit-timah')),
].map(d => d.citations.length ? d : { ...d, citations: undefined })

const documents = docs.map(buildDocument)
const discoveries = [
  ...docs.map(d => ({ ...d.discovery, holder: { documentId: d.id, keyPassageId: `${d.id}-key` }, sourceLabel: d.sourceLabel, citations: d.quotes.map(q => cite(...q)) })),
  ...spoken.map(({ citations, ...d }) => citations ? { ...d, citations } : d),
]

// ---------- stages ----------
const week = 'In the week since, misunderstood orders weakened the Kranji–Jurong line, and on 11 February the Japanese captured Bukit Timah and its fuel and supply depots.'
const battlebox = 'Now, deep under Fort Canning in the Battlebox, the reports are about water, ammunition, food and civilians. The "fortress" has lasted a week.'
const s2Opening = (what: string) => `15 February 1942. ${what}\n\n${week} ${battlebox}`
const s1Reads = ['d-troops', 'd-gemas', 'd-fleet', 'd-fortress', 'd-notice']
const stages = [
  {
    id: 's1', title: 'The fortress that wasn\'t', timePlace: 'Fort Canning, Singapore, early February 1942',
    centralQuestion: 'Everyone calls Singapore an impregnable fortress. Percival has two reasons to trust his plan. Can you answer them, and what will you advise?',
    openingNarration: 'February 1942. After weeks of retreat through Malaya, the army is back on Singapore island. The Japanese are just across the Johor Strait.\n\nA notice in the city says Singapore is an impregnable fortress. General Percival has two reasons to trust his plan. You can\'t give orders. But you can test each reason with evidence, from papers or from the people who were there, and then advise him.',
    rooms: [
      { id: 'command-room', name: 'Command room', description: 'Percival\'s office at Fort Canning, with a large map of Singapore. The naval base is marked in the east. The northwest coast also faces Johor, across the strait. A strength return lies on his desk.' },
      { id: 'liaison-office', name: 'Liaison office', description: 'Captain Arjun Singh sits with muddy boots. His field report from the retreat through Malaya lies on the desk, read by almost no one.' },
      { id: 'dossier-1', name: 'Signals and records room', description: 'Clerks file signals and reports, and a runner waits by the door. The December signals are kept here, with a separate grey folder marked "Recollections, recorded after the war".' },
      { id: 'civil-post', name: 'Civil-defence post', description: 'A first-aid post in the city, with stretchers, bandages and a siren on the roof. A public notice is pinned by the door.' },
    ],
    startRoomId: 'command-room',
    placement: { percival: 'command-room', arjun: 'liaison-office', ong: 'civil-post' },
    documentPlacement: { 'doc-troops': 'command-room', 'doc-gemas': 'liaison-office', 'doc-fleet': 'dossier-1', 'doc-voices': 'dossier-1', 'doc-notice': 'civil-post' },
    situations: [],
    definingMomentId: 'm-briefing',
    // Quest card: two reads (any order, any two sources), Percival, then the decision. Percival sees Sam once Sam
    // holds any one piece of evidence. Singh and Mrs Ong are open from the start and are the alternative routes.
    preparation: {
      characters: {
        percival: [{ discoveryIds: s1Reads, minMet: 1 }],
        arjun: [],
        ong: [],
      },
      decision: [{ discoveryIds: s1Reads, minMet: 2 }],
      essentialCharacters: [
        { characterId: 'percival', discoveryIds: ['d-percival-plan'] },
      ],
    },
  },
  {
    id: 's2', title: 'What should weigh most?', timePlace: 'The Battlebox, Fort Canning, 15 February 1942',
    centralQuestion: 'The "fortress" has fallen back in a week. Is there any way to keep fighting, and if not, what should weigh most with Percival?',
    openingNarration: s2Opening('A week ago, the Japanese landed in the northwest.'),
    rooms: [
      { id: 'battlebox', name: 'Battlebox conference room', description: 'An underground room with a long table, maps and telephones. The notes of this morning\'s conference lie on the table.' },
      { id: 'signals', name: 'Signals room', description: 'Telephones ring with messages from units across the island. The signals log of the past week is pinned to the wall. Captain Singh is reading the latest reports.' },
      { id: 'outside', name: 'Outside Fort Canning', description: 'Smoke rises over the city. Soldiers and civil-defence volunteers hurry past.' },
    ],
    startRoomId: 'battlebox',
    placement: { percival: 'battlebox', bennett: 'battlebox', arjun: 'signals', hamid: 'outside', ong: 'outside' },
    documentPlacement: { 'doc-battlebox': 'battlebox', 'doc-island': 'signals', 'doc-fleet': 'signals' },
    // The hinge: stage 2 opens on what Sam advised, and Percival's and Singh's regard for Sam follows from it.
    situations: [
      { outcomeId: 'o-plan-kept', stances: { percival: 'percival-confident', arjun: 'arjun-tired' },
        what: 'You told Percival to keep his strongest forces in the east, and he did. On 8 February, the Japanese landed in the northwest instead. Captain Singh\'s report had warned that the enemy goes around defences. Today you will have to face him, and Percival will want more than agreement from you.' },
      { outcomeId: 'o-refused', stances: { percival: 'percival-doubtful' },
        what: 'You warned Percival about the northwest, but you could not show him enough evidence, and his plan stayed as it was. On 8 February, the Japanese landed there. You were right, and it changed nothing. This time, have your evidence ready.' },
      { outcomeId: 'o-check', stances: { percival: 'percival-doubtful' },
        what: 'You were still checking the northwest coast when, on 8 February, the Japanese landed there. You had raised the doubt; there was no time to act on it.' },
      { outcomeId: 'o-convinced', stances: { percival: 'percival-convinced' },
        what: 'Percival believed your evidence about the northwest, but he had no fresh troops to send. On 8 February, the Japanese landed there. Since then, he has kept you close at hand.' },
    ].map(({ outcomeId, stances, what }) => ({ whenOutcome: { momentId: 'm-briefing', outcomeId }, stances, openingNarration: s2Opening(what) })),
    definingMomentId: 'm-way-out',
    // Quest card: read one source, hear Percival, then two of the three ways out (Singh, Mrs Ong). Bennett, in
    // the start room, is the third. Mrs Ong talks at once if Sam listened to her in stage 1.
    preparation: {
      characters: {
        percival: [{ discoveryIds: ['d-troops', 'd-fleet', 'd-goodman', 'd-bukit-timah'], minMet: 1 }],
        arjun: [{ discoveryIds: ['d-fleet', 'd-bukit-timah'], minMet: 1 }],
        ong: [{ discoveryIds: ['d-goodman', 'd-bukit-timah', 'd-ong-warning'], minMet: 1 }],
        bennett: [], hamid: [],
      },
      decision: [{ discoveryIds: ['d-goodman', 'd-bukit-timah'], minMet: 1 }],
      essentialCharacters: [
        { characterId: 'percival', discoveryIds: ['d-percival-situation'] },
        { characterId: 'arjun', discoveryIds: ['d-no-help'] },
        { characterId: 'ong', discoveryIds: ['d-no-city'] },
      ],
    },
  },
]

// ---------- decisions: Sam chooses only what Sam advises; Percival decides ----------
const atLeast = (stanceId: string) => ({ stanceAtLeast: { characterId: 'percival', stanceId } })
const landing = 'On 8 February, the Japanese land on the northwest coast.'
const definingMoments = [
  {
    id: 'm-briefing', stageId: 's1', deciderId: 'percival',
    scene: 'Percival looks up from the map: the naval base in the east, the long northwest coast facing Johor. "Well, Sam? What do you advise?"',
    nudge: 'Advice counts for more with evidence behind it. Percival has two reasons: more men, and an attack in the east. The strength return or Captain Singh can answer the first; Singh\'s field report or Singh himself can answer the second.',
    finalCallNarration: 'Time is up. Percival wants your advice now.',
    acts: [
      { id: 'a-keep-east', text: 'Advise him to keep the strongest forces in the east, as planned.', reaction: 'Percival looks from the naval base on the map to you. "Hold the east, then."' },
      { id: 'a-move-nw', text: 'Advise him to move more troops to the northwest coast now.', reaction: 'Percival studies the long northwest coast on the map and weighs your advice against what you have shown him.' },
      { id: 'a-check-nw', text: 'Ask for time to check the northwest coast before he decides.', reaction: 'Percival taps the northwest coast and weighs your request against what you have shown him.' },
      // Breadth: both reasons answered, and the city heard too.
      { id: 'a-side-by-side', text: 'Lay your notes side by side: "Sir, the soldiers, the retreat and the city all say this fortress is weaker than it looks."',
        reaction: 'Percival reads each note slowly, then reads them again.',
        secret: { unlock: [answeredMen, answeredEast, passedToPercival('d-ong-warning')], minMet: 3 } },
    ],
    outcomes: [
      { id: 'o-plan-kept', summary: `Percival keeps his strongest forces in the east, as you advised. ${landing}`, predictionText: 'Percival keeps his strongest forces in the east.', because: 'You backed the plan he already had. Whatever your notes showed, your advice gave him no reason to look again at the northwest.', closesEndingIds: [], historical: true },
      { id: 'o-refused', summary: `Percival will not change his plan on the evidence you have shown him. ${landing}`, predictionText: 'Percival will not change his plan on this evidence.', because: 'You asked him to change course, but your notes had not answered his reasons. A general does not move an army on a hunch.', closesEndingIds: [] },
      { id: 'o-check', summary: `Percival agrees the northwest needs a closer look, and you start checking. His plan stays as it is while you do. ${landing}`, predictionText: 'Percival agrees to a check, but the landing comes first.', because: 'Your evidence answered one of his reasons, enough for a doubt. But checking takes time, and a doubt does not move an army at once.', closesEndingIds: [] },
      { id: 'o-convinced', summary: `Percival agrees the northwest is weak. But the troops he could move are exhausted or inexperienced, and there is no time. ${landing}`, predictionText: 'Percival agrees, but has no fresh troops to send.', because: 'You answered both his reasons and changed his mind, which is all an adviser can do. Seeing a weak spot is not the same as having fresh troops to fix it.', closesEndingIds: [] },
    ],
    // Sam picks the advice; Percival's response depends on the advice AND on the evidence Sam has shown him.
    // Keeping the plan needs no evidence; asking for a check needs one reason answered; moving troops needs both.
    rules: [
      { actId: 'a-keep-east', outcomeId: 'o-plan-kept' },
      { actId: 'a-move-nw', when: { not: atLeast('percival-convinced') }, outcomeId: 'o-refused' },
      { actId: 'a-move-nw', outcomeId: 'o-convinced' },
      { actId: 'a-check-nw', when: { not: atLeast('percival-doubtful') }, outcomeId: 'o-refused' },
      { actId: 'a-check-nw', outcomeId: 'o-check' },
      { actId: 'a-side-by-side', outcomeId: 'o-convinced' },
    ],
  },
  {
    id: 'm-way-out', stageId: 's2', deciderId: 'percival',
    scene: 'The officers fall silent. Heath has argued for surrender, and Goodman\'s view is that the fight is useless without water and ammunition. Percival turns to you. "You have been out among the men and the city. What should weigh most with me now?"',
    nudge: 'Each answer can be defended. Back yours with what you found: the conference notes, the soldiers, or the city.',
    finalCallNarration: 'The meeting cannot wait. Percival asks for your answer now.',
    acts: [
      { id: 'a-no-way', text: 'Point to the supplies: "Water and ammunition are failing, sir. There is no way to keep fighting."', reaction: 'Percival looks down at the reports on water and ammunition for a long moment. Goodman\'s diary says the same.' },
      { id: 'a-counterattack', text: 'Speak for the men: "They have not given up, sir. Let them try your counterattack."', reaction: 'Bennett shakes his head. The counterattack was Percival\'s own proposal, and Bennett has already dismissed it. The reports say ammunition is failing.' },
      { id: 'a-civilians', text: 'Speak for the city: "Ordinary people are suffering more every day, sir. Think of them first."', reaction: 'Percival is quiet. Heath has already warned the table against sacrificing "countless lives".' },
      // Percival asks for Sam's whole view only if he trusts Sam, and only Hamid can show that courage was not what ran out.
      { id: 'a-both-truths', text: 'Tell him both truths: "The men have not given up, sir. But water and ammunition are failing, and the city pays for every day."',
        reaction: 'Percival listens. The commanders have spoken about the supplies. You are the only one who speaks for the soldiers too.',
        secret: { unlock: [atLeast('percival-convinced'), { discovered: 'd-hamid-courage' }], minMet: 2 } },
    ],
    outcomes: [
      { id: 'o-agrees', summary: 'You point to the supplies, as Goodman did in his diary. Percival decides to surrender.', predictionText: 'Percival agrees about the supplies, and decides to surrender.', because: 'You weighed the hardest fact in the reports. Heath and Goodman had reached the same view, and the decision was Percival\'s.', closesEndingIds: [], endingId: 'e-no-way', historical: true },
      { id: 'o-no-counterattack', summary: 'You speak for one more effort. Bennett has already dismissed the counterattack, and ammunition is failing. Percival decides to surrender.', predictionText: 'The counterattack is dismissed, and Percival decides to surrender.', because: 'Courage was real, as Pasir Panjang showed. But an attack needs ammunition, and the reports said it was failing.', closesEndingIds: [], endingId: 'e-counterattack' },
      { id: 'o-civilians', summary: 'You speak for the city. The meeting has already heard how bad things are for civilians. Percival decides to surrender.', predictionText: 'Percival hears you about the city, and decides to surrender.', because: 'The reports already included the worsening civilian situation. You put people first; how much that weighed with Percival, the sources do not say.', closesEndingIds: [], endingId: 'e-civilians' },
      { id: 'o-both', summary: 'Percival hears both truths: the soldiers fought on, and the supplies are failing. He decides to surrender.', predictionText: 'Percival accepts both truths, and decides to surrender.', because: 'Courage was real, as Pasir Panjang showed, but it could not replace water and ammunition.', closesEndingIds: [], endingId: 'e-both' },
    ],
    rules: [
      { actId: 'a-no-way', outcomeId: 'o-agrees' },
      { actId: 'a-counterattack', outcomeId: 'o-no-counterattack' },
      { actId: 'a-civilians', outcomeId: 'o-civilians' },
      { actId: 'a-both-truths', outcomeId: 'o-both' },
    ],
  },
]

// ---------- endings ----------
// Each epilogue says what Sam's reasoning did and did not change, and names its real counterpart in the sources.
const surrender = 'What actually happened: on 15 February 1942, Percival decided to surrender. The surrender was arranged at the Ford Factory in Bukit Timah. In a broadcast to Britain, Churchill said: "It is a British and Imperial defeat. Singapore has fallen." More than three years of Japanese occupation followed.'
const interviewFor = (endingId: string) => ({
  interviewer: 'A museum guide at the Former Ford Factory, today',
  question: 'Singapore was called an impregnable fortress. Why did it fall in a week? Choose the answer you can best defend, and back it up with your notes.',
  verdicts: [
    { id: `${endingId}-v-japan`, text: 'Mainly because the Japanese army moved fast, used air power and went around the defences.', counterPoints: ['d-fleet', 'd-bukit-timah'] },
    { id: `${endingId}-v-britain`, text: 'Mainly because the "fortress" was weaker than it looked: no fleet, too few aircraft, and tired or inexperienced troops.', counterPoints: ['d-gemas'] },
    { id: `${endingId}-v-supplies`, text: 'Mainly because, once Bukit Timah fell, water and ammunition ran out.', counterPoints: ['d-fleet', 'd-gemas'] },
  ],
  generalCounter: 'Historian Brian Farrell argues that you must study both armies: the Japanese army\'s plans and skills, not only British mistakes. Does your answer do that? And could any one cause explain it on its own?',
})
const endingCitations = [cite('source-d', 'Surrender was subsequently negotiated at the Ford Factory, not at the Battlebox.'), cite('source-h', 'It is a British and Imperial defeat. Singapore has fallen.')]
const simulation = 'Simulation of your answer; the surrender is historical'
const endings = [
  { id: 'e-no-way', type: 'historical', title: 'The supplies decide', summary: 'You told Percival the supplies mattered most. He decided to surrender.',
    epilogue: `Your simulation: you told Percival that water and ammunition mattered most. Your reasoning matched the real commanders. Goodman wrote that it was "useless to continue the fight as water and ammunition were failing", and Heath argued there was "only one possible course to adopt". Your evidence did not change the result. It showed you understood why the commanders reached it.\n\n${surrender}`,
    interview: interviewFor('e-no-way'), sourceLabel: 'Historical outcome; Sources D, G and H', citations: [...endingCitations, cite('source-d', 'it was useless to continue the fight as water and ammunition were failing'), cite('source-g', 'there is only one possible course to adopt')] },
  { id: 'e-counterattack', type: 'alternative', title: 'One more effort?', summary: 'You spoke for the men and a counterattack. Bennett had already dismissed it, and ammunition was failing.',
    epilogue: `Your simulation: you spoke for the men and one more counterattack. You were not alone. The counterattack was Percival's own proposal, and Simmons was reluctant to surrender. But Bennett dismissed it, and water and ammunition were failing. Your evidence showed that the defenders had not given up. It could not give them what they lacked.\n\n${surrender}`,
    interview: interviewFor('e-counterattack'), sourceLabel: `${simulation} (Sources D, G and H)`, citations: [...endingCitations, cite('source-g', 'dismissed Percival\'s proposal for a counterattack'), cite('source-d', 'Simmons as reluctant but unable to see an alternative')] },
  { id: 'e-civilians', type: 'alternative', title: 'The city first', summary: 'You asked Percival to think first of the city. He decided to surrender.',
    epilogue: `Your simulation: you asked Percival to think first of the people of the city. The real meeting heard reports on "the worsening civilian situation", and Heath warned that "to sacrifice countless lives by a failure to appreciate the true situation would be an act of extreme folly". Your evidence put ordinary people at the centre. It did not change the result, and the sources do not tell us how much the civilians weighed with Percival.\n\n${surrender}`,
    interview: interviewFor('e-civilians'), sourceLabel: `${simulation} (Sources D, G and H)`, citations: [...endingCitations, cite('source-d', 'the worsening civilian situation'), cite('source-g', 'to sacrifice countless lives by a failure to appreciate the true situation would be an act of extreme folly')] },
  { id: 'e-both', type: 'secret', title: 'Both truths', summary: 'You told Percival that the soldiers had not given up, and that the supplies were failing.',
    epilogue: `Your simulation: you spoke for the soldiers as well as the reports. The Malay Regiment had fought at Pasir Panjang, and resistance went on after Bukit Timah fell. But courage could not replace water and ammunition. Your evidence did not change the result. It made sure the soldiers were not blamed for it.\n\n${surrender}`,
    interview: interviewFor('e-both'), sourceLabel: `${simulation} (Sources C, D and H)`, citations: [...endingCitations, cite('source-c', 'Allied resistance continued.')] },
]

// ---------- story events: keyed to the player's progress, with a clock only as a harmless fallback ----------
const all = (...parts: object[]) => ({ all: parts })
const any = (...parts: object[]) => ({ any: parts })
const found = (id: string) => ({ discovered: id })
const after = (seconds: number) => ({ elapsedAtLeast: seconds })
const s2Ready = all(found('d-percival-situation'), found('d-no-help'), found('d-no-city'), found('d-bennett'), any(found('d-goodman'), found('d-bukit-timah')))
const storyEvents = [
  // Stage 1. Percival has laid out his reasons: more evidence arrives (unless Sam already has it).
  { id: 'ev-s1-runner', stageId: 's1', effect: 'deliverDocument', documentId: 'doc-fleet', when: { condition: all({ not: found('d-fleet') }, any(found('d-percival-plan'), after(240))) },
    text: 'A runner from the signals room hands you a file copy of a signal from December. "The General will want this one. It is about the fleet."' },
  // The first crack in the plan: the city, and the fortress notice, come into the story.
  // Fires on leaving the command room after the first doubt (or a while after the plan), never on the runner's turn.
  { id: 'ev-s1-siren', stageId: 's1', effect: 'news', when: { condition: all({ not: found('d-ong-warning') }, { not: { inRoom: 'command-room' } }, any(atLeast('percival-doubtful'), all(found('d-percival-plan'), after(180)))) },
    text: 'Air-raid sirens wail across the city. At the civil-defence post, Mrs Ong\'s volunteers run for their stretchers, under a notice that says Singapore is an impregnable fortress. If the General\'s fortress is weaker than it looks, does the city know?' },
  { id: 'ev-s1-notice', stageId: 's1', effect: 'news', when: { condition: found('d-ong-warning') },
    text: 'Mrs Ong takes the notice down and folds it away. "Show the General what you showed me," she says. "He should hear it from the city too."' },
  { id: 'ev-s1-heard', stageId: 's1', effect: 'news', when: { condition: all({ stanceIs: { characterId: 'percival', stanceId: 'percival-convinced' } }, found('d-percival-plan'), { not: passedToPercival('d-ong-warning') }) },
    text: 'Percival puts down your notes. Both his reasons have been answered. He is waiting for your advice.' },
  // On leaving Mrs Ong with her warning, or as a late reminder while Sam is with Percival and has not yet convinced him.
  { id: 'ev-s1-summons', stageId: 's1', effect: 'summons', characterId: 'percival', when: { condition: any(all(found('d-ong-warning'), { not: { inRoom: 'civil-post' } }), all(found('d-percival-plan'), after(420), { inRoom: 'command-room' }, { not: { stanceIs: { characterId: 'percival', stanceId: 'percival-convinced' } } })) },
    text: 'A message from Percival: he wants your advice on the plan before the day is out.' },
  // With both reasons answered and the city heard, there is nothing left to bring him: the decision opens.
  { id: 'ev-s1-ready', stageId: 's1', effect: 'beginMoment', when: { condition: all({ stanceIs: { characterId: 'percival', stanceId: 'percival-convinced' } }, passedToPercival('d-ong-warning'), found('d-percival-plan')) },
    text: 'Percival lays your notes out on the map table. Both his reasons are answered, and he has heard from the city too.' },
  // Stage 2.
  { id: 'ev-s2-task', stageId: 's2', effect: 'summons', characterId: 'percival', when: { atSeconds: 0 },
    text: 'Percival waves you over. "We are running out of water and ammunition. Is there any way to keep fighting? Ask Bennett about a counterattack, Singh about help, and the people outside about the city."' },
  // On first leaving the Battlebox (or reading the signals log): every player does one or the other.
  { id: 'ev-s2-pasir', stageId: 's2', effect: 'news', when: { condition: all({ not: found('d-hamid-pasir') }, any({ not: { inRoom: 'battlebox' } }, found('d-bukit-timah'))) },
    text: 'Word reaches Fort Canning about the fighting at Pasir Panjang. Corporal Hamid of the Malay Regiment has come back from the west and is waiting outside. Did the defenders give up? He would know.' },
  // On the second way out checked: the decision needs at least two, so every player sees it.
  { id: 'ev-s2-water', stageId: 's2', effect: 'news', when: { condition: any(all(found('d-bennett'), found('d-no-help')), all(found('d-bennett'), found('d-no-city')), all(found('d-no-help'), found('d-no-city'))) },
    text: 'Another report reaches the Battlebox: water is failing.' },
  { id: 'ev-s2-counterattack', stageId: 's2', effect: 'news', when: { condition: found('d-bennett') },
    text: 'Way out checked: a counterattack. Blocked by ammunition: Bennett dismissed it.' },
  { id: 'ev-s2-help', stageId: 's2', effect: 'news', when: { condition: found('d-no-help') },
    text: 'Way out checked: holding on for help. Blocked by the sea: no fleet is coming.' },
  { id: 'ev-s2-city', stageId: 's2', effect: 'news', when: { condition: found('d-no-city') },
    text: 'Way out checked: fighting on in the city. Blocked by water: without it, the city cannot hold out.' },
  // How Percival calls Sam to the table depends on how far he trusts Sam now.
  // One opening line, chosen by how far Percival trusts Sam now; the first that matches opens the decision.
  { id: 'ev-s2-trusted', stageId: 's2', effect: 'beginMoment', when: { condition: all(s2Ready, atLeast('percival-convinced')) },
    text: 'Every way out has been checked. Before the officers sit down, Percival takes you aside: he wants your honest view at the table, not only your reports.' },
  { id: 'ev-s2-guarded', stageId: 's2', effect: 'beginMoment', when: { condition: all(s2Ready, { not: atLeast('percival-doubtful') }) },
    text: 'Every way out has been checked. Percival calls the officers back and hears the senior officers first. If he asks you, make your answer count.' },
  { id: 'ev-s2-ready', stageId: 's2', effect: 'beginMoment', when: { condition: s2Ready },
    text: 'Every way out has been checked. Percival calls the officers back to the table.' },
]

// ---------- assemble ----------
const spec = {
  schemaVersion: '2.1.1',
  id: 'the-fortress-that-fell',
  title: 'The Fortress That Fell',
  readingLevel: 'sec',
  arc: 'Singapore was called an impregnable fortress. A junior officer tests that claim with evidence, advises Percival before the landing, lives with what that advice was worth, then tells him what should weigh most as the island falls in a week.',
  timer: { enabled: false, stageMinutes: [12, 12] },
  role: {
    name: 'Sam',
    position: 'Junior liaison officer at army headquarters (fictional)',
    relationships: [
      'General Percival is your commander. He wants evidence, not guesses.',
      'Captain Arjun Singh fought through the retreat in Malaya. He wants someone to read his report properly.',
      'Mrs Ong helps the wounded at a civil-defence post, under a notice that says Singapore is a fortress.',
    ],
    reputation: 'New, careful, good with reports.',
    stakes: 'Singapore is called an impregnable fortress. Is it? You can\'t give orders. Your power is evidence: what you find, and who you show it to. People will remember what you did with it.',
    privateBrief: {
      goals: ['Test Percival\'s two reasons for his plan, and advise him.', 'When the island is under attack, check whether there is any way to keep fighting, and tell Percival what should weigh most.', 'At the end, explain why the "fortress" fell in a week, using your notes.'],
      fears: ['Giving advice without evidence.', 'Letting down the people who trusted you with theirs.'],
      constraints: ['You advise; Percival decides.', 'Your choices change conversations and how people see you, not history.'],
      knows: ['Japan invaded Malaya on 8 December 1941.', 'By 31 January 1942, the defenders had retreated into Singapore.', 'Many people call Singapore an impregnable fortress.'],
    },
    situation: 'February 1942. Singapore is a British colony, defended by British, Indian, Australian and local soldiers.',
  },
  stages, characters, discoveries, documents,
  triggers: [
    { id: 't-arjun-gemas', characterId: 'arjun', requires: { not: anyBriefing(...s1Outcomes) }, on: { notePassed: 'd-gemas' }, effect: { toStance: 'arjun-open' }, notice: 'Arjun sees his own report in your notes. "You actually read it. Most people stop at the first line. Let me tell you what happened after Gemas."' },
    // Percival's two reasons. Each can be answered by a paper or by Singh; a second answer to the same reason adds nothing.
    { id: 't-percival-troops', characterId: 'percival', requires: { all: [{ not: anyBriefing(...s1Outcomes) }, { not: passedToPercival('d-arjun-tired') }] }, on: { notePassed: 'd-troops' }, effect: { stanceDelta: 1 }, notice: 'Percival reads the remarks on the strength return. "Exhausted, and inexperienced. Very well: more men is not the same as more strength." One of his two reasons is answered.' },
    { id: 't-percival-tired', characterId: 'percival', requires: { all: [{ not: anyBriefing(...s1Outcomes) }, { not: passedToPercival('d-troops') }] }, on: { notePassed: 'd-arjun-tired' }, effect: { stanceDelta: 1 }, notice: 'Percival reads what Captain Singh told you about his men. "Worn out, or new to it. A list does not show that." One of his two reasons is answered.' },
    { id: 't-percival-gemas', characterId: 'percival', requires: { all: [{ not: anyBriefing(...s1Outcomes) }, { not: passedToPercival('d-arjun-retreat') }] }, on: { notePassed: 'd-gemas' }, effect: { stanceDelta: 1 }, notice: 'Percival reads Captain Singh\'s field report to the end. "They went around our positions instead of attacking from the front. Then they may not come where we are strongest." One of his two reasons is answered.' },
    { id: 't-percival-singh', characterId: 'percival', requires: { all: [{ not: anyBriefing(...s1Outcomes) }, { not: passedToPercival('d-gemas') }] }, on: { notePassed: 'd-arjun-retreat' }, effect: { stanceDelta: 1 }, notice: 'Percival reads Captain Singh\'s account. "They went around our positions all through Malaya. Then they may not come where we are strongest." One of his two reasons is answered.' },
    // Stage 2: Sam can earn back (or add to) Percival's trust with evidence from this week.
    { id: 't-percival-supplies', characterId: 'percival', requires: anyBriefing(...s1Outcomes), on: { notePassed: 'd-goodman' }, effect: { stanceDelta: 1 }, notice: 'Percival reads Goodman\'s words in your note, and looks at you properly for the first time today.' },
    { id: 't-percival-log', characterId: 'percival', requires: anyBriefing(...s1Outcomes), on: { notePassed: 'd-bukit-timah' }, effect: { stanceDelta: 1 }, notice: 'Percival reads your note on the signals log. "Bukit Timah, and the depots with it. Yes." He listens more closely now.' },
    { id: 't-percival-courage', characterId: 'percival', requires: anyBriefing(...s1Outcomes), on: { notePassed: 'd-hamid-courage' }, effect: { stanceDelta: 1 }, notice: 'Percival reads what Corporal Hamid told you. He is quiet for a moment, then asks you to go on.' },
    { id: 't-arjun-fleet', characterId: 'arjun', on: { notePassed: 'd-fleet' }, requires: anyBriefing(...s1Outcomes), effect: { toStance: 'arjun-frank' }, notice: 'Arjun reads the note for a long time. "So no ships are coming. Holding on only buys time."' },
    { id: 't-arjun-trust', characterId: 'arjun', on: { discovered: 'd-arjun-warm' }, requires: anyBriefing(...s1Outcomes), effect: { toStance: 'arjun-frank' }, notice: 'Arjun pulls up a chair for you. Whatever he says now, he will say straight.' },
  ],
  definingMoments, endings,
  reveal: {
    whatHappened: 'Many people in Singapore believed it was an impregnable fortress. Japan invaded Malaya on 8 December 1941. Two days later, Japanese aircraft sank Prince of Wales and Repulse, and the promised battle fleet had not arrived. Allied troops won some fights, such as Gemas and Bakri, but kept retreating and crossed into Singapore by 31 January 1942. Percival expected the main attack in the east, but on 8 February Japanese troops landed in the northwest. Misunderstood orders helped cause a withdrawal from the Kranji–Jurong line, and on 11 February Bukit Timah, with its supplies, was captured. The Malay Regiment fought at Pasir Panjang on 13–14 February. On 15 February, with water and ammunition failing, Percival met eleven other men in the Battlebox; Heath argued for surrender, Bennett dismissed Percival\'s proposal for a counterattack, and Percival decided to surrender. The surrender was arranged at the Ford Factory. The battle for the island had lasted a week.',
    interpretations: [
      'Some explanations focus on Allied weaknesses: the missing fleet, too few aircraft, and tired or inexperienced troops.',
      'Others stress Japanese strengths: speed, air power and moving around defences. Historian Brian Farrell argues that both armies must be studied.',
      'Many historians see several causes working together, rather than one mistake or one person.',
    ],
    corrections: [
      'The public notice "Singapore will stand" is not a real document. It was written for this adventure to show the belief Ronald Barth remembered, that "Singapore was an impregnable fortress", and it is deliberately one-sided. It leaves out that the promised fleet had not arrived, that Prince of Wales and Repulse had been sunk, and that many soldiers were exhausted or inexperienced.',
      'The strength return, the December signal, Captain Singh\'s field report, the signals log and the conference notes are reconstructions written for this adventure, based on Sources A to D and G. No real document was copied. Only the quoted words of Barth, Mosbergen, Heath and Goodman are real, and they were checked against the publications that quote them, not the originals.',
      'Captain Arjun Singh, Corporal Hamid bin Osman, Mrs Ong and Sam are fictional. Percival, Bennett, Heath, Simmons and Goodman were real people; what Percival and Bennett say in this game is reconstructed from their recorded positions, and what Percival says about Sam\'s advice is invented, because Sam is invented.',
      'Percival made the decisions. Your advice changed the conversations in this game, and how the people you met treated you, not history. In every version, the Japanese landed in the northwest on 8 February, and Singapore surrendered on 15 February 1942.',
      'The defenders did not lack courage. Gemas, Bakri and Pasir Panjang show that they fought hard.',
    ],
    couldHaveGone: [
      'Historians still debate whether different decisions earlier in the campaign could have changed the result. The sources in this lesson do not show that any one decision would have saved Singapore.',
    ],
  },
  teacherQuestions: [
    'The public notice in the game says "Singapore is an impregnable fortress". Which two other sources challenge it most strongly? Explain why.',
    'Percival had two reasons to trust his plan. Which piece of evidence answers each, and which answer did you find more convincing: a document, or a person who was there? Why?',
    'Heath argued that "there is only one possible course to adopt", and Goodman wrote it was "useless to continue the fight". Does their agreement prove there was no other choice? Explain.',
    'At the end, should the supplies, the soldiers or the civilians have weighed most? Defend your answer with two sources.',
    'Why could the Allies win at Gemas and still lose the campaign?',
    'Which of your sources were written at the time, which are recollections recorded later, and which were reconstructed for this game? Why does that matter?',
  ],
  sources: captured.map(({ id, title, origin, url }) => ({ id, title, origin, url })),
  conflicts: [],
  storyEvents,
  openQuestions: [
    { id: 'oq-plan', stageId: 's1', text: 'Is Singapore really a fortress? Percival has two reasons. What answers each one, and who can tell you?', discoveryIds: ['d-percival-plan', 'd-troops', 'd-arjun-tired', 'd-gemas', 'd-arjun-retreat'] },
    { id: 'oq-city', stageId: 's1', text: 'The notice on Mrs Ong\'s wall says the city is safe. Is it, and should the General hear from the city too?', discoveryIds: ['d-notice', 'd-ong-warning'] },
    { id: 'oq-way-out', stageId: 's2', text: 'Is there any way to keep fighting? What blocks each way out?', discoveryIds: ['d-bennett', 'd-no-help', 'd-no-city'] },
    { id: 'oq-weigh', stageId: 's2', text: 'If every way out is blocked, what should weigh most with Percival: the supplies, the soldiers or the city?', discoveryIds: ['d-goodman', 'd-hamid-courage', 'd-no-city'] },
    { id: 'oq-courage', stageId: 's2', text: 'Did Singapore fall because its soldiers gave up?', discoveryIds: ['d-hamid-pasir', 'd-hamid-courage'] },
  ],
  hintAngles: [
    { id: 'h-plan', discoveryId: 'd-percival-plan', kind: 'ask', text: 'Ask Percival why he is so sure of his plan.' },
    { id: 'h-troops', discoveryId: 'd-troops', kind: 'read', text: 'The strength return on Percival\'s desk looks reassuring. Read the remarks, then show Percival.' },
    { id: 'h-arjun-tired', discoveryId: 'd-arjun-tired', kind: 'ask', text: 'Ask Singh about the men back from Malaya.' },
    { id: 'h-gemas', discoveryId: 'd-gemas', kind: 'read', text: 'Captain Singh\'s field report from Gemas is on his desk in the liaison office. Read it to the end.' },
    { id: 'h-fleet', discoveryId: 'd-fleet', kind: 'read', text: 'The signals and records room keeps a December signal about the fleet.' },
    { id: 'h-arjun', discoveryId: 'd-arjun-retreat', kind: 'show', text: 'Show Captain Singh your note on his Gemas report. He can explain it to Percival better than the paper can.' },
    { id: 'h-notice', discoveryId: 'd-notice', kind: 'read', text: 'A public notice is pinned up at the civil-defence post. Who wrote it, and why?' },
    { id: 'h-fortress', discoveryId: 'd-fortress', kind: 'read', text: 'The records room has memories of the first air raid, recorded after the war.' },
    { id: 'h-ong', discoveryId: 'd-ong-raids', kind: 'ask', text: 'Ask Mrs Ong Bee Lian about the air raids.' },
    { id: 'h-ong-warning', discoveryId: 'd-ong-warning', kind: 'show', text: 'Mrs Ong trusts the notice on her wall. Show her a note that tests one of its claims: the fleet, the soldiers, or the sirens.' },
    { id: 'h-task', discoveryId: 'd-percival-situation', kind: 'ask', text: 'Ask Percival about the water and ammunition.' },
    { id: 'h-recall', discoveryId: 'd-recall-kept', kind: 'ask', text: 'Ask Percival about the landing.' },
    { id: 'h-goodman', discoveryId: 'd-goodman', kind: 'read', text: 'The notes of this morning\'s conference are on the Battlebox table.' },
    { id: 'h-island', discoveryId: 'd-bukit-timah', kind: 'read', text: 'The signals log on the wall covers the week since the landing.' },
    { id: 'h-bennett', discoveryId: 'd-bennett', kind: 'ask', text: 'Ask Bennett about a counterattack.' },
    { id: 'h-bennett-heath', discoveryId: 'd-bennett-heath', kind: 'show', text: 'Show Bennett your note on Goodman\'s diary.' },
    { id: 'h-arjun-landing', discoveryId: 'd-arjun-cold', kind: 'ask', text: 'Ask Singh about the landing.' },
    { id: 'h-hope', discoveryId: 'd-arjun-hope', kind: 'ask', text: 'Ask Singh about help from outside.' },
    { id: 'h-no-help', discoveryId: 'd-no-help', kind: 'show', text: 'Captain Singh hopes help will come. Show him your note about the fleet.' },
    { id: 'h-ong-notice', discoveryId: 'd-ong-believed', kind: 'ask', text: 'Ask Mrs Ong Bee Lian about the notice.' },
    { id: 'h-no-city', discoveryId: 'd-no-city', kind: 'show', text: 'Show Mrs Ong your note about Goodman\'s diary.' },
    { id: 'h-hamid', discoveryId: 'd-hamid-pasir', kind: 'ask', text: 'Ask Hamid about Pasir Panjang.' },
    { id: 'h-hamid-courage', discoveryId: 'd-hamid-courage', kind: 'show', text: 'Show Corporal Hamid your note on the signals log.' },
  ],
}

fs.writeFileSync(folder + 'adventure.json', JSON.stringify({ format: 'pocket-adventure-v3', version: 1, sources: captured, spec }, null, 2) + '\n')
console.log(`Wrote adventure.json: ${documents.length} documents, ${discoveries.length} discoveries, ${characters.length} characters.`)
