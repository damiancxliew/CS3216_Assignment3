import type { StoryArt } from './story-art.js'

/** Flavour only: passers-by are cosmetic, so their lines never touch the transcript,
 * evidence or any agent's private context. Lines are drawn from the public setting words
 * so a harbour stage sounds like a harbour without inventing historical claims.
 */
export interface StreetTalk {
  name: string
  lines: readonly string[]
}

const NAMES: Record<StoryArt['id'], readonly string[]> = {
  civic: ['Clerk', 'Petitioner', 'Street vendor', 'Messenger', 'Printer'],
  harbor: ['Dock hand', 'Net mender', 'Boat boy', 'Cargo checker', 'Fish seller'],
  village: ['Farmhand', 'Water carrier', 'Weaver', 'Goat herder', 'Neighbour'],
  jungle: ['Porter', 'Tracker', 'Rubber tapper', 'Camp cook', 'Guide'],
  desert: ['Caravan hand', 'Water seller', 'Spice trader', 'Camel driver', 'Well keeper'],
  industrial: ['Millworker', 'Stoker', 'Foreman', 'Cart driver', 'Apprentice'],
  winter: ['Wood carrier', 'Trapper', 'Sled hand', 'Stove tender', 'Neighbour'],
  palace: ['Court attendant', 'Guard', 'Scribe', 'Gardener', 'Kitchen hand'],
  ruins: ['Caretaker', 'Stone gatherer', 'Wanderer', 'Herb picker', 'Shepherd'],
  battlefield: ['Stretcher bearer', 'Supply hand', 'Sentry', 'Cook', 'Runner'],
}

const LINES: Record<StoryArt['id'], readonly string[]> = {
  civic: [
    'Everyone is queueing at the records office today.',
    'The notices went up this morning. Nobody agrees on them.',
    'Officials talk, we wait. That is how it always goes.',
    'Read it yourself before you sign anything.',
  ],
  harbor: [
    'Tide turns soon. The crews are shouting already.',
    'Another ship in, another list of goods to count.',
    'Careful on the boards, they are wet through.',
    'Whoever controls the quay controls the bargaining.',
  ],
  village: [
    'The elders have been meeting since dawn.',
    'Mind the goats, they wander into everything.',
    'We heard strangers came with papers to sign.',
    'Water first, talk after.',
  ],
  jungle: [
    'The path floods past the second bend.',
    'Carry less and you will get there faster.',
    'The camp has been restless since the visitors came.',
    'Listen for the birds. They stop before the rain.',
  ],
  desert: [
    'Travel at dusk. The midday sun is a punishment.',
    'The caravan waits for the agreement, not for us.',
    'Water costs more than words here.',
    'Cover your face, the wind is picking up.',
  ],
  industrial: [
    'The machines have not stopped in three days.',
    'Wages are late again. Ask at the office.',
    'Mind the pipes, they run hot along the wall.',
    'Talk is cheap until the whistle goes.',
  ],
  winter: [
    'Keep moving or the cold finds you.',
    'Stores are thin and the meeting drags on.',
    'The road is packed hard. Sleds run well today.',
    'Stand by the brazier if your hands ache.',
  ],
  palace: [
    'Speak softly in the courtyard, everything is heard.',
    'The audience is delayed. Again.',
    'The seal matters more than the speech.',
    'Keep to the path when the guards pass.',
  ],
  ruins: [
    'People took the stones for their own walls.',
    'Nobody has kept this place for years.',
    'Watch your footing, the floor gives way.',
    'They say the papers were lost with the roof.',
  ],
  battlefield: [
    'Rations came short again this morning.',
    'Stay low past the wall, orders are orders.',
    'Everyone has a different account of yesterday.',
    'Rest while you can. It will not last.',
  ],
}

const GREETINGS: Record<StoryArt['id'], readonly string[]> = {
  civic: ['Excuse me.', 'Mind the queue.', 'Good day to you.'],
  harbor: ['Coming through!', 'Mind the ropes.', 'Heave!'],
  village: ['Good day.', 'Peace be with you.', 'Mind the path.'],
  jungle: ['Watch your step.', 'Keep close.', 'This way.'],
  desert: ['Water?', 'Peace upon you.', 'Mind the sand.'],
  industrial: ['Out the way!', 'Mind the pipes.', 'Shift change.'],
  winter: ['Keep warm.', 'Cold one today.', 'Mind the ice.'],
  palace: ['Make way.', 'Quietly, now.', 'Your pardon.'],
  ruins: ['Careful there.', 'Nothing left here.', 'Mind the stones.'],
  battlefield: ['Stay low.', 'Make way!', 'Orders came through.'],
}

/** Setting words worth repeating back to the player, in priority order. */
const TOPICS: Array<[RegExp, string]> = [
  [/\btreaty|agreement|accord\b/i, 'They say the treaty will be settled before the week is out.'],
  [/\bpension|claim|petition\b/i, 'Another claim sent off, another year of waiting.'],
  [/\belection|vote|assembly|council\b/i, 'The whole quarter is arguing about the vote.'],
  [/\bration|food|sugar|grain|harvest\b/i, 'The rations were counted twice and still came up short.'],
  [/\btrade|tariff|cargo|goods\b/i, 'Trade is good for someone. Not for us.'],
  [/\bland|border|territory|boundary\b/i, 'They are drawing lines across land they have never walked.'],
  [/\bcharter|law|court|magistrate\b/i, 'The law is whatever the man with the seal reads out.'],
  [/\bstrike|wages|labour|labor\b/i, 'If the wages stay short, nobody lifts another crate.'],
]

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

/** Deterministic: the same passer-by keeps their name and lines for the whole stage. */
export function streetTalk(seed: string, art: StoryArt['id'], context = ''): StreetTalk {
  const names = NAMES[art]
  const pool = LINES[art]
  const random = hash(seed)
  const lines = [pool[random % pool.length]!, pool[(random >>> 8) % pool.length]!]
  const topic = TOPICS.find(([pattern]) => pattern.test(context))
  if (topic) lines.splice(1 + (random % 2), 0, topic[1])
  return {
    name: names[(random >>> 16) % names.length]!,
    lines: [...new Set(lines)],
  }
}

/** The short line a passer-by calls out when the player walks past them. */
export function passingRemark(seed: string, art: StoryArt['id']): string {
  const pool = GREETINGS[art]
  return pool[hash(`pass:${seed}`) % pool.length]!
}
