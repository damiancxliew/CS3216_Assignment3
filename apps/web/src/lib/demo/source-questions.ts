import { discoveries } from "./discoveries";
/** Curated checks of evidence, not scores for a student's moral decisions. */
export type SourceQuestion = {
  question: string;
  options: [string, string, string];
  answer: number;
  explanation: string;
  hint: string;
  footnote: string;
};
export const sourceQuestions: Record<string, SourceQuestion> = {
  ...Object.fromEntries(Object.entries(discoveries).map(([id, record]) => [`discovery-${id}`, {
    question: record.question, options: [...record.options] as [string, string, string],
    answer: record.answer, explanation: record.explanation, hint: record.hint, footnote: record.footnote,
  }])),
  "gan-photo": {
    question: "Which moment does this photograph preserve?",
    options: ["Lim's departure in 1942", "Lim's funeral in 1946", "A family meal during the occupation"], answer: 1,
    explanation: "Gan is identified at the far right in black at the post-war funeral.",
    hint: "Use the photograph to identify Gan; use the family biography to investigate wartime responsibilities.",
    footnote: "Post-war photograph; sprite clothing and movement are reconstructed.",
  },
  "tham-photo": {
    question: "What does this photograph show Tham doing?",
    options: ["Training in wartime Malaya", "Leaving Singapore", "Shaking hands with Mountbatten in London"], answer: 2,
    explanation: "The archive dates the London photograph to 8 June 1946, after the war.",
    hint: "Keep this post-war image separate from Tham's later recollection of training.",
    footnote: "Photographed after the war; wartime clothing is reconstructed.",
  },
  "tan-photo": {
    question: "How does the photograph relate to Tan's wartime service?",
    options: ["It predates his wartime service", "It shows a Force 136 mission", "It shows his wartime uniform"], answer: 0,
    explanation: "The photograph shows Tan in sporting clothes in 1936.",
    hint: "A portrait helps identify a person; their written account supplies different evidence.",
    footnote: "Pre-war photograph; the sprite's field clothing is illustrative.",
  },
  "elizabeth-photo": {
    question: "What occasion is recorded in Elizabeth's photograph?",
    options: ["Her canteen work", "Her wedding in 1941", "A meeting with Lim"], answer: 1,
    explanation: "This is Elizabeth Choy's wedding photograph, dated 16 August 1941.",
    hint: "Read her biography next to learn about the civilian assistance she later provided.",
    footnote: "Wedding photograph; the game's everyday clothing is reconstructed.",
  },
  choy: {
    question: "What kind of assistance does this account describe?",
    options: ["Commanding all of Force 136", "Serving as a wartime minister", "Providing civilian help, including food and medicine"], answer: 2,
    explanation: "The biography describes civilian assistance to internees, including food, medicine, money, letters and radios.",
    hint: "Ask how civilian support contributed to resistance, and who carried its risks.",
    footnote: "Later biography; her occupation work belongs to Singapore in 1942–1943.",
  },
  currency: {
    question: "What can this banknote establish on its own?",
    options: ["Its denomination and issuer", "How much rice every family could buy", "The inflation rate throughout the occupation"], answer: 0,
    explanation: "The denomination and issuer are visible. Purchasing power needs evidence about prices and supply.",
    hint: "Pair this note with the food source before making a claim about what money could buy.",
    footnote: "1942 issue, modern scan; face value alone does not show purchasing power.",
  },
  "farewell-b": {
    question: "Which interpretation best fits Account B?",
    options: ["Nobody knew the mission was dangerous", "High spirits coexisted with awareness of danger", "Every recruit felt exactly the same"], answer: 1,
    explanation: "Tham's adapted recollection stresses collective resolve despite the danger.",
    hint: "Compare B and C on the same topic: remembered mood and awareness of risk.",
    footnote: "School adaptation of a 1983 interview; the original recording is unverified here.",
  },
  "farewell-c": {
    question: "What is the strongest comparison with Account B?",
    options: ["C proves B is wholly false", "Only C recognises danger", "Both recognise danger, but emphasise different moods"], answer: 2,
    explanation: "C emphasises mixed emotions while B emphasises resolve. Their awareness of danger is shared.",
    hint: "Check the precise occasion before claiming the accounts describe the same gathering.",
    footnote: "School adaptation of a later account; check occasion and context when comparing.",
  },
  press: {
    question: "Why does the extract combine promises with threats?",
    options: ["To discourage opposition and encourage obedience", "To prove that all civilians were safe", "To report civilian opinion impartially"], answer: 0,
    explanation: "The extract promises protection for compliance and threatens opposition: it has a persuasive purpose.",
    hint: "Separate what an authority wanted readers to believe from evidence of civilian experience.",
    footnote: "Guidebook paraphrase; the exact issue and contemporary newspaper title need verification.",
  },
  life: {
    question: "Which sequence is supported by the timeline?",
    options: ["Lim stayed in Singapore throughout the occupation", "Lim left before the fall, then returned to Malaya in 1943", "Lim returned to Singapore in 1943 to command all resistance"], answer: 1,
    explanation: "The account distinguishes his Singapore work from his later resistance network around Perak.",
    hint: "When you ask Lim a question, keep the chapter's place and date in mind.",
    footnote: "Later historical synthesis; some operational details differ between accounts.",
  },
  family: {
    question: "What does the biography add to Lim's public story?",
    options: ["The exact words Gan spoke before he left", "Proof that family duties disappeared", "Family relationships and the private cost of separation"], answer: 2,
    explanation: "Lim's roles as husband and father make family responsibilities part of the historical interpretation.",
    hint: "Ask Gan about the household trade-off before making your recommendation.",
    footnote: "Commemorative biography; private conversations in the game are reconstructed.",
  },
  force: {
    question: "Why were local agents important to the Malayan operation?",
    options: ["Their languages and local knowledge mattered", "Force 136 was Lim's personal army", "All resistance work happened in Singapore"], answer: 0,
    explanation: "The account describes a connection between Allied support and local resistance in Malaya.",
    hint: "Look beyond individual courage: consider the people and knowledge that made cooperation possible.",
    footnote: "Broad heritage account; retrospective organisation names require care.",
  },
  ration: {
    question: "What does a rice purchasing card record?",
    options: ["Proof every household received enough rice", "An entitlement to buy a specified quantity", "The food a family ate every day"], answer: 1,
    explanation: "An entitlement records the rationing system, but does not guarantee stock was available.",
    hint: "Compare entitlement with actual access when you discuss civilian needs.",
    footnote: "One surviving object; household experiences and availability varied.",
  },
  food: {
    question: "Why could having money still fail to secure a meal?",
    options: ["Food was equally available to everyone", "All prices stayed fixed", "Shortages, rising prices and unequal access limited purchases"], answer: 2,
    explanation: "The article connects disrupted supplies and inflation with different opportunities to obtain food.",
    hint: "Use both the currency and rationing sources to explain why money or a card was not enough.",
    footnote: "Accounts span different years; avoid applying late-war prices to early 1942.",
  },
  control: {
    question: "Why is compliance alone weak evidence of support for occupation rule?",
    options: ["Fear and coercion could also lead to compliance", "Every civilian approved of the occupation", "Silence always meant agreement"], answer: 0,
    explanation: "The exhibition describes coercion alongside promises. Behaviour under threat does not establish belief.",
    hint: "Distinguish what people did to survive from what they believed.",
    footnote: "Exhibition overview; individual experiences require further evidence.",
  },
  school: {
    question: "What can the account of school routines support?",
    options: ["Every pupil became loyal to the emperor", "Policies promoted loyalty while gardening addressed shortages", "School life continued without disruption"], answer: 1,
    explanation: "The account describes both ideological routines and practical responses to food shortages.",
    hint: "Separate an official policy's purpose from evidence of how pupils responded.",
    footnote: "School policies describe official intentions, not each pupil's beliefs.",
  },
  memory: {
    question: "How should historians handle differing recollections?",
    options: ["Discard all oral history", "Assume both describe the same occasion", "Compare specific claims, speakers and contexts"], answer: 2,
    explanation: "Memories can preserve different experiences. Disagreement does not automatically make one wholly false.",
    hint: "Use this approach when comparing Tham and Tan's accounts.",
    footnote: "Recollections were recorded decades later and need contextual comparison.",
  },
  ledger: {
    question: "What makes community records useful alongside a famous person's biography?",
    options: ["They bring everyday household experiences into the inquiry", "They give everyone's complete private thoughts", "They prove every family had the same experience"], answer: 0,
    explanation: "Community records broaden the inquiry beyond a public figure's life.",
    hint: "Ask whose everyday work or needs are missing from the main narrative.",
    footnote: "Administrative records show categories and transactions, with limited insight into private experiences.",
  },
  surrender: {
    question: "Which event is directly visible in this photograph?",
    options: ["Lim boarding a boat", "British troops surrendering in Singapore", "Resistance training in Malaya"], answer: 1,
    explanation: "The photograph records British troops surrendering on 15 February 1942.",
    hint: "Use it to establish the wider turning point, then use other sources for Lim's journey.",
    footnote: "A photograph captures a particular scene and cannot establish everyone's feelings.",
  },
  letter: {
    question: "What does the official description of Lim's letter connect?",
    options: ["A complete plan for Gan's daily routine", "The outcome of every resistance mission", "Commitment to the war effort and hopes for his children's education"], answer: 2,
    explanation: "The release describes both public duty and concern for his children in a letter to his wife.",
    hint: "Use this connection to explain why family and public duty cannot be treated as unrelated choices.",
    footnote: "Based on an official description; the full letter has not been transcribed here.",
  },
  "street-newspaper": {
    question: "What should you check when reading an occupation newspaper?",
    options: ["Who controlled publication and whose views are missing", "Whether every reader agreed with it", "Whether a printed claim must be true"], answer: 0,
    explanation: "The occupation press was censored and promoted Japanese propaganda.",
    hint: "A newspaper can reveal the message authorities promoted without proving that civilians accepted it.",
    footnote: "20 February 1942, after the surrender; distinguish published claims from lived experience.",
  },
  rickshaw: {
    question: "Whose labour made the journey shown here possible?",
    options: ["Only the passengers'", "The rickshaw runner's physical work", "A motor hidden in the photograph"], answer: 1,
    explanation: "The runner and hand-pulled vehicle make the labour behind transport visible.",
    hint: "When planning movement or supplies, consider whose work the plan depends on.",
    footnote: "Catalogue dates vary between 1941 and 1941–1945; use it as a period comparison.",
  },
};
