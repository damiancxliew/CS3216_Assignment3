/**
 * Everything the viewer reads, in one place, so wording and the episode can change without touching the scenes.
 * Episode: Singapore, 1819. Dialogue and notes are illustrative, written for the trailer.
 */
export const cast = {
  player: { name: "Ahmad", role: "Interpreter", sprite: "Villager3" },
  temenggong: { name: "Temenggong Abdul Rahman", short: "The Temenggong", sprite: "OldMan" },
  raffles: { name: "Sir Stamford Raffles", short: "Raffles", sprite: "Inspector" },
  farquhar: { name: "Major William Farquhar", short: "Farquhar", sprite: "Master" },
  hussein: { name: "Tengku Hussein", short: "Tengku Hussein", sprite: "Sultan" },
  clerk: { name: "A Company clerk, 1824", short: "Clerk", sprite: "OldMan3" },
} as const;

export const copy = {
  problem: [
    "Students read about history.",
    "But do they get to think it through?",
    'Chatting with an AI "historical figure" is fun.',
    "But it rarely makes students think.",
  ],
  blandReply: "Hello! I'm happy to answer any questions about my life and times.",
  bigIdea: ["History is people making hard choices…", "…without knowing how it will turn out."],
  outcomes: {
    lead: "So students should…",
    first: "Understand what happened",
    second: "Learn to think it through for themselves",
  },
  people: "Everyone they meet wants something.",
  sources: "Sources don't always agree. Students notice.",
  share: "What they share changes how people react.",
  choices: "Their choices change what happens next.",
  explain: "At the end, they explain their thinking.",
  real: "Then they see what really happened.",
  schools: ["Built from your own source materials.", "Fits one lesson.", "No marks, just thinking."],
  tagline: "Turn your history sources into a game students can play.",
  audience: "For secondary and JC history",
  wip: "Early preview: we're building it now.",
  illustrative: "Illustrative example",
};

export const scenes = {
  chat: {
    question: "Why do you need the Englishman's treaty at all?",
    answer: "Tell him my people must keep their share of the trade. That is my price.",
    note: "The Temenggong will only agree if he keeps his share of the port's trade.",
  },
  sources: {
    masthead: "Letter to the Governor-General, Calcutta",
    date: "February 1819",
    lines: [
      "The island is all but deserted,",
      "with scarcely any settlement of note,",
      "and no prince with a claim to it",
      "who could object to our design.",
    ],
    highlight: 2,
    rival: "My people have fished and traded here for generations.",
    note: "Raffles describes the island as empty and unclaimed. The Temenggong disagrees.",
  },
  share: {
    noteInserted: "Tengku Hussein will sign if he is recognised as Sultan.",
    reaction: "Raffles leans forward. This changes things.",
  },
  choice: {
    prompt: "Raffles asks: what should I do?",
    options: [
      "Recognise Tengku Hussein as Sultan",
      "Wait for orders from Calcutta",
      "Deal with the Temenggong alone",
    ],
    picked: 0,
    closed: "A quiet deal with the Temenggong is no longer possible.",
  },
  explain: {
    question: "Was the treaty fair to the people already living here?",
    verdicts: ["Yes, everyone gained", "No, they were not asked", "Only partly"],
    picked: 2,
    attached: "The Temenggong will only agree if he keeps his share…",
    pushBack: "But you wrote that Raffles called the island empty. Were its people really heard?",
  },
  real: {
    yours: ["Recognised Hussein", "Temenggong kept a trade share", "Treaty signed"],
    history: ["Recognised Hussein", "Both chiefs paid yearly allowances", "Treaty signed, 6 Feb 1819"],
    /** Which steps of the student's story differ from what really happened. */
    differs: [false, true, false],
  },
  classView: [
    { label: "Got stuck finding the Temenggong's terms", value: 0.62 },
    { label: "Said the treaty was only partly fair", value: 0.48 },
    { label: "Noticed the sources disagree", value: 0.71 },
  ],
};
