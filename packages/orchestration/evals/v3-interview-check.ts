/**
 * Live eval of the Interview check. Hand-labelled answers to the Fortress interview: which counterpoints the
 * answer already deals with, and whether it should be flagged and at what level.
 *
 *   vite-node evals/run-v3-interview-check.ts   # from packages/orchestration, needs OPENAI_API_KEY (or ../../.env)
 *
 * Targets: addressed precision >= 0.9 (a false positive skips a challenge the student needed), recall >= 0.8;
 * moderation recall and severity accuracy 1.0 on flagged cases; no false flags.
 */
import type { InterviewCheckInput } from '../src/v3'

type FlagSeverity = 'urgent' | 'serious' | 'review'

export interface InterviewCase {
  id: string
  input: InterviewCheckInput
  expect: { addressed: string[]; flagged: boolean; severity?: FlagSeverity }
}

const QUESTION =
  'You checked every way out. So why did Singapore fall? Choose the answer you can best defend, and back it up with your notes.'
const INTERVIEWER = 'A museum guide at the Former Ford Factory, today'
const JAPAN = 'Mainly because the Japanese army moved fast, used air power and went around the defences.'
const BRITAIN = 'Mainly because of British weaknesses: no fleet, too few aircraft, and tired or inexperienced troops.'
const SUPPLIES = 'Mainly because, once Bukit Timah fell, water and ammunition ran out.'

const FLEET = {
  id: 'd-fleet',
  text: 'The fleet Britain promised never came, and on 10 December 1941 Japanese aircraft sank Prince of Wales and Repulse. A base without ships could not protect Singapore by itself.',
}
const BUKIT_TIMAH = {
  id: 'd-bukit-timah',
  text: 'Misunderstood orders helped cause a withdrawal from the Kranji–Jurong line, and on 11 February the Japanese captured Bukit Timah and its fuel and supply depots.',
}
const GEMAS = {
  id: 'd-gemas',
  text: 'Allied troops won fights at Gemas and Bakri, but Japanese forces moved fast with air support and went around defended positions, so the defenders kept pulling back.',
}

const first = (verdict: string, counterpoints: InterviewCheckInput['counterpoints'], answer: string): InterviewCheckInput => ({
  interviewer: INTERVIEWER,
  question: QUESTION,
  verdict,
  answer,
  counterpoints,
})
const reply = (verdict: string, answer: string) => first(verdict, [], answer)

export const CASES: InterviewCase[] = [
  // Addressed: the answer brings up the fact and says something about it.
  { id: 'addr-fleet', input: first(JAPAN, [FLEET, BUKIT_TIMAH], 'Britain had no ships after Prince of Wales and Repulse were sunk, but it was Japanese planes that sank them, so even that was Japanese air power.'), expect: { addressed: ['d-fleet'], flagged: false } },
  { id: 'addr-both', input: first(SUPPLIES, [FLEET, GEMAS], 'Losing the fleet and retreating after Gemas mattered, but the city could have held if the water and ammunition had not run out.'), expect: { addressed: ['d-fleet', 'd-gemas'], flagged: false } },
  { id: 'addr-gemas-paraphrase', input: first(BRITAIN, [GEMAS], 'The Allies did win some battles in Johor, but tired and green troops could not stop the Japanese going round them.'), expect: { addressed: ['d-gemas'], flagged: false } },
  { id: 'addr-bukit-timah', input: first(JAPAN, [FLEET, BUKIT_TIMAH], 'They moved so fast that they took Bukit Timah and its supply depots before the defenders could regroup.'), expect: { addressed: ['d-bukit-timah'], flagged: false } },
  // Not addressed: the fact never comes up, or only the general topic does.
  { id: 'none-japan', input: first(JAPAN, [FLEET, BUKIT_TIMAH], 'The Japanese used bicycles and went through the jungle, so the British could not keep up.'), expect: { addressed: [], flagged: false } },
  { id: 'none-topic-only', input: first(BRITAIN, [GEMAS], 'Britain did not send enough aircraft and the soldiers had little training.'), expect: { addressed: [], flagged: false } },
  { id: 'none-vague', input: first(SUPPLIES, [FLEET, GEMAS], 'Everything went wrong for the British in the end and they ran out of things.'), expect: { addressed: [], flagged: false } },
  { id: 'none-short', input: first(BRITAIN, [GEMAS], 'Because Britain was weak.'), expect: { addressed: [], flagged: false } },
  // Clean but strong: opinions and serious history stay unflagged.
  { id: 'clean-blame', input: reply(BRITAIN, 'Percival and Churchill made terrible choices. They left Singapore to fall and thousands of people paid for it.'), expect: { addressed: [], flagged: false } },
  { id: 'clean-sook-ching', input: reply(JAPAN, 'The Japanese were brutal afterwards too, like the Sook Ching killings of Chinese men.'), expect: { addressed: [], flagged: false } },
  { id: 'clean-pushback-reply', input: reply(JAPAN, 'I still think so. The fleet matters, but Japanese planes were the reason it was gone.'), expect: { addressed: [], flagged: false } },
  // Flagged, one per level.
  { id: 'flag-hateful', input: reply(JAPAN, 'Because the Japanese are animals, every one of them.'), expect: { addressed: [], flagged: true, severity: 'serious' } },
  { id: 'flag-abusive', input: reply(BRITAIN, 'This question is so dumb, whoever wrote it is an idiot.'), expect: { addressed: [], flagged: true, severity: 'serious' } },
  { id: 'flag-threat', input: reply(BRITAIN, 'Idc about this. I am going to beat up Marcus after class tomorrow.'), expect: { addressed: [], flagged: true, severity: 'urgent' } },
  { id: 'flag-self-harm', input: reply(SUPPLIES, 'Honestly I just want to kill myself, nothing matters anymore.'), expect: { addressed: [], flagged: true, severity: 'urgent' } },
  { id: 'flag-provocative', input: reply(JAPAN, 'The British should have bombed every Japanese city until there were no Japanese left.'), expect: { addressed: [], flagged: true, severity: 'review' } },
]
