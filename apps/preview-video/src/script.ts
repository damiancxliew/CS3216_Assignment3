/**
 * The preview's script: every word on screen and the order of the shots.
 * Sample story only (Beijing, October 1860). Durations are in seconds at FPS.
 */
export const FPS = 30;

export const GUIDE = { name: "Master Wen", face: "/game/ninja/characters/Master/face.png" };

export const STAGE_ONE = {
  index: 1,
  count: 3,
  title: "Beijing After the Capture",
  setting: "The Forbidden City, October 1860. Rain on the courtyard stones; the Emperor has fled north.",
  painting: "/game/cutscenes/beijing-after-capture.webp",
  player: { name: "Prince Gong", role: "Regent left to hold the capital" },
  goals: [
    { title: "Hear the British envoy's terms", target: "Harry Parkes · Audience Hall" },
    { title: "Read the court's casualty ledger", target: "Ledger · Archive" },
    { title: "Learn what the Russians want", target: "General Ignatiev · West Gallery" },
  ],
  decisionPrompt: "Will you sign the Convention of Peking, or let the foreign armies march on the palace?",
  options: [
    { id: "sign", label: "Sign the Convention and open Tianjin" },
    { id: "stall", label: "Stall for time until the Emperor replies" },
    { id: "resist", label: "Refuse and arm the city guard" },
  ],
  chosen: "sign",
  outcome: {
    announcement: "Prince Gong signs. The British columns halt a mile from the walls, and the Summer Palace burns anyway. Beijing is spared the sack, but every envoy now knows the court will bend.",
    effects: ["The British withdraw to Tianjin", "Kowloon is ceded", "Ignatiev presents his bill"],
    standing: [
      { name: "Harry Parkes", delta: +1, text: "more willing to trust you" },
      { name: "General Ignatiev", delta: +1, text: "sees an opening" },
      { name: "The Court Censors", delta: -2, text: "more wary of you" },
    ],
  },
};

export const STAGE_TWO = {
  index: 2,
  count: 3,
  title: "The Price of Peace",
  setting: "Three weeks later. The envoys have left; the Censorate has not.",
  painting: "/game/cutscenes/beijing-after-capture.webp",
  previousChoice: "Sign the Convention and open Tianjin",
};

/** Guide lines, Pokémon-style: one box each, typed out. */
export const INTRO_LINES = [
  `Welcome back, student. Before you walk these halls, you should know where you stand.`,
  `It is October 1860. The British and French armies are camped outside Beijing. The Emperor has fled.`,
  `You will play ${STAGE_ONE.player.name} — ${STAGE_ONE.player.role.toLowerCase()}. Whatever you decide here, the court will live with.`,
  `Talk to the people in the palace. Read what they leave behind. Then choose — and watch it unfold.`,
];

export const RECAP_LINES = [
  `You chose to sign. The armies turned back… but the Censors have long memories.`,
  `Chapter two begins with the peace you bought. Let us see what it costs.`,
];

/** Mock transcript shown in the gameplay shot. */
export const PLAY_TRANSCRIPT = [
  { who: "Harry Parkes", text: "Your Highness, the terms are not negotiable. Tianjin opens, or the gates do." },
  { who: "You", text: "And if the Emperor refuses to ratify?" },
  { who: "Harry Parkes", text: "Then I cannot answer for Lord Elgin's patience, nor for his engineers." },
];

/**
 * The decision acted out instead of narrated. Five beats; words stay short
 * (RPG speech bubbles and map toasts), pictures carry the outcome.
 */
export const UNFOLD = {
  beats: [
    { id: "walk", seconds: 4 },     // board closes, camera pushes in; Gong walks to Parkes at the table
    { id: "sign", seconds: 3 },     // Gong faces the table; scroll flashes; ink stamp "Convention of Peking — signed"
    { id: "ripple", seconds: 5 },   // British column marches off; Censors turn away (▼); Ignatiev steps in (▲)
    { id: "cost", seconds: 5 },     // cut to painting at night; glow, smoke, embers; one line
    { id: "ledger", seconds: 3 },   // effect chips stamp onto the painting, dissolve to chapter two
  ],
  bubbles: [
    { who: "You", text: "Bring the Convention." },
    { who: "Harry Parkes", text: "Your Highness." },
  ],
  stamp: "Convention of Peking — signed",
  toasts: [
    { text: "The British column turns back", tone: "world" },
    { text: "The Censors turn away", tone: "danger" },
    { text: "Ignatiev steps closer", tone: "signal" },
  ],
  costLine: "The Summer Palace burns anyway.",
} as const;

export interface Shot { id: string; seconds: number }

/** The shot list in order. Total ≈ 96s. */
export const SHOTS: Shot[] = [
  { id: "title", seconds: 5 },          // painting Ken Burns, "Chapter 01 · Beijing After the Capture"
  { id: "intro-dialogue", seconds: 22 }, // guide box, 4 lines typed, face bobbing while typing
  { id: "briefing", seconds: 10 },       // role card + goals checklist slide in + decision prompt
  { id: "to-play", seconds: 2 },         // dialogue shrinks into the HUD; iris/wipe to game
  { id: "gameplay", seconds: 14 },       // mock map + panel; player walks, transcript lines appear, goals tick
  { id: "decision", seconds: 8 },        // case board opens; three options; "sign" is pressed, stamp
  { id: "unfold", seconds: 20 },         // UNFOLD.beats: walk → sign → ripple → cost → ledger
  { id: "chapter-two", seconds: 11 },    // painting dissolves; "Chapter 02 · The Price of Peace"; guide recap (2 lines)
  { id: "end", seconds: 4 },             // "Historical Adventures" end card
];

export const TOTAL_SECONDS = SHOTS.reduce((sum, shot) => sum + shot.seconds, 0);
