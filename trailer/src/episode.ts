/**
 * Everything the viewer reads, in one place, so wording and the episode can change without touching the scenes.
 * Episode: Singapore, 1819. Dialogue, notes and documents are illustrative, written for the trailer.
 */
export const cast = {
  player: { name: "Ahmad", role: "Interpreter", sprite: "Villager3" },
  temenggong: { name: "Temenggong Abdul Rahman", short: "The Temenggong", sprite: "OldMan" },
  raffles: { name: "Sir Stamford Raffles", short: "Raffles", sprite: "Inspector" },
  farquhar: { name: "Major William Farquhar", short: "Farquhar", sprite: "Master" },
  hussein: { name: "Tengku Hussein", short: "Tengku Hussein", sprite: "Sultan" },
  clerk: { name: "A Company clerk, 1824", short: "Clerk", sprite: "OldMan3" },
} as const;

/** Pitch beats. Words in *asterisks* take the accent colour. */
export const pitch = {
  open: ["Singapore, 1819.", "What would you have done?"],
  problem: ["Textbooks tell students *what* *happened.*", "Chatbots tell them what they *want* *to* *hear.*"],
  neither: ["Neither makes them think.", "*Here,* *they* *have* *to.*"],
  people: ["Everyone *wants* *something.*"],
  sources: ["Real sources.", "*Read* *closely.*"],
  disagree: ["Accounts *disagree.*"],
  share: ["What you share", "*changes* *minds.*"],
  choose: ["Some paths", "*close* *for* *good.*"],
  defend: ["Then they", "*defend* *their* *view.*"],
  real: ["And see what", "*really* *happened.*"],
  rapid: ["Your sources.", "One lesson.", "No marks.", "Just thinking."],
  close: "What would you have done?",
  tagline: "Turn your history sources into a game students can play.",
  audience: "For secondary and JC history",
  wip: "Early preview: we're building it now.",
};

export const game = {
  question: {
    answer: "My people keep their share of the trade. That is my price.",
    note: "The Temenggong will only agree if he keeps his share of the trade.",
  },
  read: { note: "The Temenggong bargained hard for a share of the river's duties." },
  compare: { note: "Raffles calls the island empty. The scribe's memoir says otherwise." },
  share: {
    noteInserted: "Tengku Hussein will sign if he is recognised as Sultan.",
    reaction: "Hussein, as Sultan? Then the treaty would stand.",
  },
  choice: {
    prompt: "Raffles asks: what should I do?",
    options: ["Recognise Tengku Hussein as Sultan", "Wait for orders from Calcutta", "Deal with the Temenggong alone"],
    picked: 0,
  },
  explain: {
    question: "Was the treaty fair to the people already here?",
    verdicts: ["Yes, everyone gained", "No, they were not asked", "Only partly"],
    picked: 2,
    pushBack: "But you noted Raffles called the island empty. Were its people really heard?",
  },
  real: {
    yours: ["Recognised Hussein as Sultan", "The Temenggong kept a trade share", "Treaty signed"],
    differs: [false, true, false],
    /** Summary of the historical record. */
    history: [
      "Tengku Hussein recognised as Sultan of Johor",
      "The Company may build a trading post",
      "Yearly allowances: 5,000 Spanish dollars to the Sultan, 3,000 to the Temenggong",
    ],
  },
};
