/** Hand-authored standalone lesson. Never consumed by v2/v3 generation. */
export type Source = {
  id: string;
  title: string;
  date: string;
  kind: string;
  credit: string;
  displayCredit?: string;
  url: string;
  summary: string;
  limitation: string;
  tags: string[];
  image?: string;
  imageAlt?: string;
  license?: string;
};
export const sources: Source[] = [
  {
    id: "gan-photo",
    title: "Gan Choo Neo: the photograph behind her portrait",
    date: "13 January 1946 · after the occupation",
    kind: "Archival photograph",
    credit:
      "Tham Sien Yen Collection, courtesy of National Archives of Singapore · 20080000015-0099. Viewing permitted; commercial use and reproduction require written permission from the copyright owner. Permission has not been obtained for redistribution.",
    displayCredit: "Tham Sien Yen Collection · National Archives of Singapore · 20080000015-0099",
    url: "https://www.nas.gov.sg/archivesonline/photographs/record-details/9e4a7381-1162-11e3-83d5-0050568939ad",
    summary:
      "The archive identifies Gan Choo Neo as the woman at the far right in black at Lim Bo Seng’s funeral at MacRitchie Reservoir. The chatbot frames her face from this photograph; this source view preserves the full scene.",
    limitation:
      "This is a post-war funeral photograph, not a portrait taken during the occupation or evidence of a wartime meeting. Her game sprite is an AI-generated illustration based on this reference; its colours, unseen angles and movements are reconstructed.",
    image: "/demo/lim-bo-seng/portraits/gan.webp",
    imageAlt:
      "Lim Bo Seng’s funeral in 1946; Gan Choo Neo stands at the far right in black",
    tags: ["gan", "photograph", "family"],
  },
  {
    id: "tham-photo",
    title: "Tham Sien Yen: a post-war photograph",
    date: "8 June 1946 · London",
    kind: "Archival photograph",
    credit:
      "Tham Sien Yen Collection, courtesy of National Archives of Singapore · 20080000015-0103. Viewing permitted; commercial use and reproduction require written permission from the copyright owner. Permission has not been obtained for redistribution.",
    displayCredit: "Tham Sien Yen Collection · National Archives of Singapore · 20080000015-0103",
    url: "https://www.nas.gov.sg/archivesonline/photographs/record-details/9eb7c379-1162-11e3-83d5-0050568939ad",
    summary:
      "The archive identifies Tham Sien Yen as the Force 136 member shaking hands with Admiral Lord Louis Mountbatten. Tham is in the right foreground. This is the visual reference for his chatbot portrait and illustrated sprite.",
    limitation:
      "Photographed after the war. It does not establish his precise clothing during training or covert operations. The sprite’s colours and walking frames are illustrative reconstructions.",
    image: "/demo/lim-bo-seng/portraits/tham.webp",
    imageAlt:
      "Tham Sien Yen, right foreground, shaking hands with Mountbatten in London in 1946",
    tags: ["tham", "photograph", "force136"],
  },
  {
    id: "tan-photo",
    title: "Tan Chong Tee: a pre-war portrait",
    date: "2 November 1936",
    kind: "Historical photograph · Commons reproduction",
    credit:
      "Unknown photographer · The Straits Times, 2 November 1936, via Wikimedia Commons. Commons marks the photograph public domain in Singapore (PD-SG-photo).",
    url: "https://commons.wikimedia.org/wiki/File:Tan_Chong_Tee.jpg",
    summary:
      "This pre-war photograph shows Tan Chong Tee in sporting clothes. It supplies the facial and hair reference for his chatbot portrait and game sprite.",
    limitation:
      "The photograph predates his wartime service. The sprite’s field clothing and colours are an illustration, not a reproduction of this sporting outfit.",
    image: "/demo/lim-bo-seng/portraits/tan.webp",
    imageAlt: "Tan Chong Tee in a sports shirt in 1936",
    tags: ["tan", "photograph"],
  },
  {
    id: "elizabeth-photo",
    title: "Elizabeth Choy: a 1941 photograph",
    date: "16 August 1941",
    kind: "Historical wedding photograph · Commons reproduction",
    credit:
      "Family of Elizabeth Choy, via Wikimedia Commons. Commons marks the photograph public domain in Singapore (PD-SG-photo).",
    url: "https://commons.wikimedia.org/wiki/File:Elizabeth_Choy,_1941.jpg",
    summary:
      "Elizabeth Choy’s wedding photograph supplies the face and hair reference for her chatbot portrait and illustrated character.",
    limitation:
      "This is a wedding photograph, not a scene from her wartime canteen work. The sprite wears reconstructed everyday clothes; its colours and movements are illustrative.",
    image: "/demo/lim-bo-seng/portraits/elizabeth.webp",
    imageAlt: "Elizabeth Choy in her wedding photograph, 1941",
    tags: ["elizabeth", "choy", "photograph"],
  },
  {
    id: "choy",
    title: "Elizabeth Choy: civilian help and its risks",
    date: "1942–1943 · retrospective biography",
    kind: "Biographical account",
    credit:
      "Singapore Council of Women’s Organisations · Singapore Women’s Hall of Fame",
    url: "https://www.scwo.org.sg/profiles/elizabeth-choy/",
    summary:
      "Elizabeth Choy and her husband ran a hospital canteen during the occupation and carried food, medicine, money, letters and radios to prisoners of war. Arrested in 1943, she was detained for 193 days. Her story connects civilian assistance with the risks of occupation control.",
    limitation:
      "A later biography, not a transcript of her words. It does not establish a meeting with Lim Bo Seng or Gan Choo Neo, or involvement in a Perak safe house. Her later political role must not be projected into the occupation years.",
    tags: [
      "elizabeth",
      "choy",
      "civilian",
      "prisoners",
      "resistance",
      "detention",
      "help",
    ],
  },
  {
    id: "currency",
    title: "Occupation currency: an actual ten-cent note",
    date: "Note: 1942 · scan: 2015",
    kind: "Primary artefact · modern scan",
    credit:
      "National Numismatic Collection, National Museum of American History · scan by Godot13",
    url: "https://commons.wikimedia.org/wiki/File:MAL-M3b-Malaya-Japanese_Occupation-10_Cents_ND_(1942).jpg",
    summary:
      "This is a ten-cent note issued by the Japanese occupation administration for Malaya and Borneo. The denomination and issuer are visible material evidence. This is not the ten-dollar note with the banana-plant motif. A note's face value alone cannot establish what it bought; compare it with evidence about shortages and changing prices.",
    limitation:
      "The surviving object does not measure inflation, show a family's income or prove that goods were available. The scan was made long after the war.",
    tags: ["currency", "money", "inflation", "prices", "banknote"],
    image: "/demo/lim-bo-seng/currency.jpg",
    imageAlt:
      "Front and back of a Japanese occupation ten-cent banknote for Malaya, 1942",
    license: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  {
    id: "farewell-b",
    title: "Account B: a confident farewell",
    date: "1983 interview · guidebook adaptation, p. 63",
    kind: "Adapted oral testimony · supplied curriculum",
    credit:
      "Tham Sien Yen, as adapted in the supplied Sec 2 guidebook; original recording not independently verified",
    url: "https://biblioasia.nlb.gov.sg/all-sections/vol-13-issue-1-apr-jun-2017-voices-that-remain/",
    summary:
      "The guidebook's adaptation attributes to Force 136 member Tham Sien Yen a memory of high spirits at a farewell despite awareness of a dangerous mission. His recollection stresses collective resolve. It can be compared with Account C on remembered mood and awareness of risk.",
    limitation:
      "A paraphrase of a school adaptation, not a verified verbatim transcript. The link provides context on the oral-history collection, not this exact interview. Do not assume B and C describe the same party or all recruits.",
    tags: [
      "training",
      "farewell",
      "comparison",
      "memory",
      "confidence",
      "fear",
    ],
  },
  {
    id: "farewell-c",
    title: "Account C: a gathering with mixed feelings",
    date: "1994 published account · guidebook adaptation, p. 63",
    kind: "Adapted retrospective account · supplied curriculum",
    credit:
      "Tan Chong Tee, as adapted in the supplied Sec 2 guidebook; full original account not independently verified",
    url: "https://biblioasia.nlb.gov.sg/all-sections/vol-13-issue-1-apr-jun-2017-voices-that-remain/",
    summary:
      "The guidebook attributes to Tan Chong Tee a recollection of training followed by a farewell marked by uncertainty and mixed emotions. It differs from B in the mood it emphasises, while both accounts recognise danger. A comparison should keep a shared basis rather than claiming one writer discussed a topic the other omitted.",
    limitation:
      "A school adaptation of a later publication. Memory, selection and the precise occasion need checking. The linked article explains oral-history context and is not the original of this account.",
    tags: [
      "training",
      "farewell",
      "comparison",
      "memory",
      "uncertainty",
      "fear",
    ],
  },
  {
    id: "press",
    title: "A promise and a threat in occupation print",
    date: "28 February 1942 · guidebook Source D, p. 63",
    kind: "Adapted occupation newspaper text · supplied curriculum",
    credit:
      "Attributed to Syonan Shimbun in the supplied guidebook; original issue and newspaper title require verification",
    url: "https://corporate.nas.gov.sg/former-ford-factory/whatson/exhibition-syonan/",
    summary:
      "The supplied extract pairs a promise to protect compliant civilians with explicit threats against anti-Japanese movements and espionage. Its persuasive purpose is to discourage opposition and define obedience as peace. It is evidence of the message presented by an occupation authority, not independent proof that civilians were safe.",
    limitation:
      "The guidebook labels this February 1942 text Syonan Shimbun, although contemporary newspaper naming needs checking. The linked exhibition supports context, not verification of the exact issue. This is a paraphrase, not an authenticated transcription.",
    tags: [
      "propaganda",
      "threat",
      "purpose",
      "reliability",
      "control",
      "repression",
    ],
  },
  {
    id: "life",
    title: "Lim Bo Seng: the documented timeline",
    date: "NLB account, updated 2023",
    kind: "Historical synthesis",
    credit: "Wong Heng and Valerie Chew · Singapore Infopedia, NLB",
    url: "https://www.nlb.gov.sg/main/article-detail?cmsuuid=18b892a1-9b32-4f8c-a72a-6ad72122bdd4",
    summary:
      "Lim organised anti-Japanese support and civil-defence labour in Singapore. He left before its fall, trained abroad, recruited agents and returned to occupied Malaya in 1943. His intelligence network operated around Perak. He was captured on 27 March 1944 and died at Batu Gajah on 29 June. His remains were reburied at MacRitchie on 13 January 1946.",
    limitation:
      "A later synthesis, not Lim's own voice. Some operational labels and dates differ between accounts; this demo avoids treating those details as settled.",
    tags: ["lim", "family", "singapore", "perak", "resistance", "timeline"],
    image: "/demo/lim-bo-seng/portrait.jpg",
  },
  {
    id: "family",
    title: "A family behind the public figure",
    date: "NHB biographical account",
    kind: "Historical synthesis",
    credit: "National Heritage Board · Roots",
    url: "https://www.roots.gov.sg/stories-landing/stories/lim-bo-seng/story",
    summary:
      "Lim was a businessman, husband and father as well as an anti-Japanese organiser. His marriage to Gan Choo Neo and separation from his family make the private cost of his work visible. Accounts count the children differently depending on whether they include a child who died young.",
    limitation:
      "A commemorative biography selects and interprets a life. It does not record the conversations or choices enacted in this game.",
    tags: ["family", "lim", "sacrifice"],
  },
  {
    id: "force",
    title: "Force 136 and the Malayan connection",
    date: "NHB World War II trail booklet, 2016",
    kind: "Heritage research",
    credit: "National Heritage Board · World War II trail",
    url: "https://www.roots.gov.sg/-/media/Roots/Files/world-war-2/world-war-2-trail-booklet.pdf",
    summary:
      "The British Special Operations Executive recruited local agents whose language skills and knowledge mattered. Teams entered occupied Malaya by submarine in the Gustavus operations. Lim trained in India and joined the Malayan operation in late 1943. The organisation commonly remembered as Force 136 linked Allied support with local resistance.",
    limitation:
      "A broad public-history account. Force 136 was not simply Lim's personal army, and its work in Malaya must not be relocated to Singapore. Names used retrospectively are not necessarily contemporary labels.",
    tags: [
      "force",
      "training",
      "submarine",
      "perak",
      "intelligence",
      "resistance",
    ],
  },
  {
    id: "ration",
    title: "A rice purchasing card",
    date: "1942–1945 · accession 1995-01744",
    kind: "Primary artefact, museum description",
    credit: "Collection of the National Museum of Singapore · NHB",
    url: "https://www.roots.gov.sg/Collection-Landing/listing/1077611",
    summary:
      "A surviving rice purchasing card records a household's entitlement to buy a specified quantity of rice. War disrupted imports and the supply of necessities, prompting rationing. A purchasing entitlement is different from evidence that the rice was actually available.",
    limitation:
      "One object shows how rationing was administered. It cannot establish what every household ate or whether every shop met the entitlement.",
    tags: ["rice", "food", "ration", "household", "shortage"],
  },
  {
    id: "food",
    title: "When money could not buy a meal",
    date: "Lee Geok Boi · 4 April 2019",
    kind: "Research using oral histories",
    credit: "BiblioAsia · National Library Board",
    url: "https://biblioasia.nlb.gov.sg/all-sections/vol-15-issue-1-apr-jun-2019-wartime-victuals/",
    summary:
      "Interrupted supply chains, shrinking rations and rising prices shaped civilian survival. People substituted tapioca and sweet potatoes, bartered possessions and sought scarce goods on the black market. Expanding issues of occupation currency worsened inflation. Access to food varied with work, wealth and connections; adaptation did not remove hardship.",
    limitation:
      "A later article combining different experiences and different years. Late-war prices must not be projected back to early 1942. Its Singapore evidence is context, not proof of a particular Perak household's life.",
    tags: [
      "food",
      "currency",
      "inflation",
      "barter",
      "rice",
      "civilian",
      "shortage",
    ],
  },
  {
    id: "control",
    title: "Becoming Syonan: power and fear",
    date: "NAS exhibition interpretation",
    kind: "Archival exhibition",
    credit: "National Archives of Singapore · Former Ford Factory",
    url: "https://corporate.nas.gov.sg/former-ford-factory/whatson/exhibition-syonan/",
    summary:
      "Singapore was renamed Syonan-to after the British surrender on 15 February 1942. The Sook Ching screening and killings targeted suspected anti-Japanese elements in the Chinese community. Occupation rule combined coercion with promises of Asian prosperity. Experiences differed; neither compliance nor silence proves approval.",
    limitation:
      "An exhibition overview is a starting point for investigation. This game does not reenact a massacre or make civilian survival depend on choosing a 'correct' response.",
    tags: ["sook", "fear", "control", "propaganda", "singapore", "repression"],
  },
  {
    id: "school",
    title: "Classrooms under occupation",
    date: "MOE Heritage Centre",
    kind: "Educational history",
    credit: "Ministry of Education · Heritage Centre",
    url: "https://moehc.moe.edu.sg/explore/beginnings-of-education-1819-to-1958/the-japanese-occupation/",
    summary:
      "Schooling was disrupted. Japanese-language instruction and rituals promoted loyalty to the emperor. Schools also cultivated vegetables as shortages worsened. These policies linked everyday routines with occupation control, while gardening also responded to a practical need for food.",
    limitation:
      "Policies and official routines do not demonstrate what individual pupils believed. Language learning could be a means of coping rather than an expression of loyalty.",
    tags: ["school", "language", "propaganda", "loyalty", "garden", "civilian"],
  },
  {
    id: "memory",
    title: "How survivors' voices entered the archive",
    date: "BiblioAsia · April–June 2017",
    kind: "Archive methodology",
    credit: "National Library Board · Voices That Remain",
    url: "https://biblioasia.nlb.gov.sg/all-sections/vol-13-issue-1-apr-jun-2017-voices-that-remain/",
    summary:
      "The Japanese Occupation oral-history project began in 1981 and deliberately sought varied social perspectives. Recollections offer experiences absent from official records. They were recorded decades after the events and need to be read with attention to the speaker, question, memory and later context.",
    limitation:
      "Two memories may disagree without either being wholly false. They may refer to different people, occasions or interpretations. Cross-reference specific claims rather than counting sources as votes.",
    tags: ["memory", "oral", "reliability", "comparison", "evidence"],
  },
  {
    id: "ledger",
    title: "Households in community records",
    date: "Occupation-era records · NLB collection essay, 2022",
    kind: "Primary records, curator description",
    credit: "National Library Singapore · Chinese community collections",
    url: "https://biblioasia.nlb.gov.sg/all-sections/vol-18-issue-2-jul-to-sep-2022-national-library-japanese-occupation-collection-english/",
    summary:
      "Clan-association records list household members for food-card allocation. Rent registers document the use of occupation currency. These mundane records connect administration with the lives of people who might not appear in military narratives.",
    limitation:
      "Administrative entries record categories and transactions, not the full experience of hunger or the private views of the people listed.",
    tags: ["household", "ration", "currency", "civilian", "records"],
  },
  {
    id: "surrender",
    title: "Singapore, 15 February 1942",
    date: "15 February 1942 · AWM 127902",
    kind: "Primary photograph",
    credit: "Australian War Memorial · unknown photographer · public domain",
    url: "https://commons.wikimedia.org/wiki/File:British_troops_surrender_in_Singapore.png",
    summary:
      "British troops surrender in the city area after the fall of Singapore. The photograph records a visible moment in military defeat. It introduces the change of rule that frames this lesson.",
    limitation:
      "This is not a photograph of Lim's departure, a civilian food queue or resistance work. A camera's view cannot show every person's feelings.",
    tags: ["singapore", "surrender", "photo", "evidence"],
    image: "/demo/lim-bo-seng/surrender.png",
  },
  {
    id: "letter",
    title: "A letter home survives",
    date: "Lim's 1942 letter · MOE release, 13 December 2007",
    kind: "Primary document described in official release",
    credit: "Ministry of Education · NAS document 20071213994",
    url: "https://www.nas.gov.sg/archivesonline/data/pdfdoc/20071213994.pdf",
    summary:
      "An official release describes a four-page letter Lim wrote to his wife after escaping Singapore in 1942, expressing commitment to the war effort and hopes for his children's education. It supports exploring family and public duty together.",
    limitation:
      "The demo has verified the release's description, not a full transcription of the letter. No invented game dialogue should be presented as a quotation from it.",
    tags: ["letter", "family", "duty", "lim", "primary"],
  },
];
export const sourceById = (id: string) => sources.find((s) => s.id === id)!;
export type Npc = {
  id: string;
  name: string;
  role: string;
  color: string;
  x: number;
  y: number;
  opening: string;
  concerns: string;
  prompts: string[];
};
export type Choice = {
  id: string;
  title: string;
  detail: string;
  cost: string;
  outcome: string;
  effect: [number, number, number];
  animation: "handover" | "gather" | "depart";
  actor: 0 | 1;
};
export type Stage = {
  id: string;
  title: string;
  date: string;
  place: string;
  duration: string;
  theme: "town" | "camp" | "coast" | "jungle";
  intro: string;
  objective: string;
  question: string;
  sources: string[];
  npcs: Npc[];
  choices: Choice[];
  reflection: string;
  historian: string;
};
export const stages: Stage[] = [
  {
    id: "departure",
    title: "Singapore: the people left behind",
    date: "February 1942 · before the surrender",
    place: "Singapore · reconstructed departure quarter",
    duration: "9–12 min",
    theme: "town",
    intro:
      "Begin at the Singapore waterfront before the surrender in February 1942. Speak with Lim and Gan about departure and the people staying behind. At the records desk, you may also explore a clearly labelled later encounter with Elizabeth Choy and records of civilian life under occupation. Those later records are available to you as a student observer; they are not events happening on this quay.",
    objective:
      "Use the family evidence to recommend who needs support when Lim leaves. Explore civilian assistance and scarcity as optional later context, without making another allocation decision.",
    question:
      "What will you put in place before leaving Singapore, and whose needs might your decision leave unresolved?",
    sources: ["family", "letter", "life", "choy", "food", "ration", "currency"],
    npcs: [
      {
        id: "lim",
        name: "Lim Bo Seng",
        role: "Anti-Japanese organiser",
        color: "#c29472",
        x: 270,
        y: 330,
        opening:
          "Public duty and family both matter. The record shows that I left Singapore before its fall. What would you want to know before judging that decision?",
        concerns:
          "Use life, family and letter. Discuss documented commitments, not invented departure logistics, family conversations or the unverified wording of the letter.",
        prompts: [
          "Why did you leave Singapore?",
          "What did resistance ask of your family?",
          "What can your later letter tell us?",
        ],
      },
      {
        id: "gan",
        name: "Gan Choo Neo",
        role: "Lim Bo Seng’s wife",
        color: "#b4b88a",
        x: 780,
        y: 330,
        opening:
          "A public story of resistance also has a family behind it. What does the biography tell you about the people left in Singapore—and what does it leave unanswered?",
        concerns:
          "Use family and letter. Biography establishes marriage and separation, not her exact wartime feelings or arrangements. Acknowledge those gaps rather than inventing memories.",
        prompts: [
          "How does the family change our view of resistance?",
          "What evidence survives about the separation?",
          "What should we avoid assuming about your experience?",
        ],
      },
      {
        id: "elizabeth",
        name: "Elizabeth Choy",
        role: "Later evidence encounter · Singapore, 1942–1943",
        color: "#c29472",
        x: 270,
        y: 330,
        opening:
          "In this later evidence encounter, we look beyond the departure. My husband and I helped prisoners of war with supplies and messages during the occupation. What does civilian help add to your picture of resistance?",
        concerns:
          "Use choy for biography. Singapore evidence encounter, not a Perak safe-house keeper or a documented associate of Lim. Describe assistance only at the documented level: food, medicine, money, letters and radios. The source gives no delivery methods, concealment, packaging or radio parts; say those details are unavailable if asked. No invented private recollections, exact ration quantities or graphic descriptions of detention. This is an optional later evidence encounter within a pre-surrender map: explicitly date occupation events to 1942–1943. Do not claim she met Lim or Gan on this quay.",
        prompts: [
          "How did civilians help prisoners of war?",
          "What risks did helping others carry?",
          "How do food records help us understand the wider setting?",
        ],
      },
    ],
    choices: [
      {
        id: "family",
        title: "Recommend support for the household",
        detail:
          "Prioritise a clear family support arrangement in the scenario.",
        cost: "The departure preparations receive less of your attention.",
        outcome:
          "The household side receives your recommendation. It makes family responsibilities visible, but a plan cannot guarantee safety.",
        effect: [2, 0, 0],
        animation: "handover",
        actor: 0,
      },
      {
        id: "contacts",
        title: "Recommend connecting people",
        detail:
          "Prioritise communication between the household and departure preparations.",
        cost: "More people become involved in a sensitive arrangement.",
        outcome:
          "The two figures come together in the illustrative scene. Your recommendation links responsibilities while involving more people.",
        effect: [1, 2, -1],
        animation: "gather",
        actor: 0,
      },
      {
        id: "depart",
        title: "Recommend departure first",
        detail:
          "Prioritise leaving while recording which family questions remain unresolved.",
        cost: "The household receives no detailed plan from you.",
        outcome:
          "The scene moves toward the quay. Your recommendation protects the departure timetable while leaving household questions open.",
        effect: [-1, 0, 2],
        animation: "depart",
        actor: 1,
      },
    ],
    reflection:
      "Name one piece of evidence for the tension between family and public duty. What does it leave unknown?",
    historian:
      "Lim left before Singapore fell. The neighbourhood and proposed preparations are reconstructions. Named figures are historical; dialogue and animated choices are not recorded conversations or decisions. Elizabeth and the food records are later evidence encounters, not people or objects documented at this departure.",
  },
  {
    id: "resistance",
    title: "Malaya: what can you rely on?",
    date: "Late 1943–early 1944 · before Lim’s capture",
    place: "Perak, occupied Malaya · reconstructed coastal meeting place",
    duration: "10–13 min",
    theme: "coast",
    intro:
      "After training abroad, Lim returned to occupied Malaya in late 1943. The journey is condensed into this coastal setting. Compare Tan Chong Tee’s and Tham Sien Yen’s later accounts, investigate the limits of occupation claims, and speak with Lim about the people a resistance network depends on. Make one evidence-based judgement; training, landing and the network are parts of this chapter, not separate missions.",
    objective:
      "Choose a claim to examine. Compare what a recollection or occupation message can establish, then decide whether to seek another perspective, limit the recommendation, or proceed while recording uncertainty.",
    question:
      "What is strong enough evidence to act on—and what uncertainty must you carry with you?",
    sources: [
      "force",
      "farewell-c",
      "farewell-b",
      "press",
      "control",
      "memory",
    ],
    npcs: [
      {
        id: "lim",
        name: "Lim Bo Seng",
        role: "Resistance organiser · evidence encounter",
        color: "#c29472",
        x: 270,
        y: 330,
        opening:
          "An authority’s promise of safety is a claim to examine. Compare its purpose with evidence of occupation control before deciding what it proves.",
        concerns:
          "Use life and force for biography, press and control for learner comparison. Do not claim Lim personally read this extract or had this exact conversation. No future knowledge in character.",
        prompts: [
          "Can propaganda be useful evidence?",
          "Does obedience establish loyalty?",
          "What limits should guide our judgement?",
        ],
      },
      {
        id: "tan",
        name: "Tan Chong Tee",
        role: "Force 136 member · retrospective evidence",
        color: "#b4b88a",
        x: 780,
        y: 330,
        opening:
          "A remembered mood is valuable evidence, but it does not speak for everyone. Which precise claim would you cross-check before relying on it?",
        concerns:
          "Use farewell-c for personal account and memory for methodology. No invented reports, immediate threats or statements of what every recruit felt.",
        prompts: [
          "How should we compare two memories?",
          "What would corroboration add?",
          "Which uncertainty should we keep in our conclusion?",
        ],
      },
      {
        id: "tham",
        name: "Tham Sien Yen",
        role: "Force 136 member · Account B",
        color: "#c29472",
        x: 270,
        y: 330,
        opening:
          "The school extract of my later recollection emphasises high spirits at a farewell despite the danger. Does confidence mean there was no fear?",
        concerns:
          "Only farewell-b supports personal recollections. It is a school adaptation of a 1983 interview, not a verified verbatim transcript. This is an evidence encounter, not proof of a meeting with Tan.",
        prompts: [
          "What does Account B emphasise?",
          "Can courage and fear coexist?",
          "How does remembering years later affect this evidence?",
        ],
      },
    ],
    choices: [
      {
        id: "corroborate",
        title: "Seek a second perspective",
        detail:
          "Bring source claims together and separate observation from interpretation.",
        cost: "The decision takes longer.",
        outcome:
          "The figures gather at the table. Your recommendation puts accounts alongside one another rather than counting them as votes.",
        effect: [0, 2, 1],
        animation: "gather",
        actor: 0,
      },
      {
        id: "limit",
        title: "Narrow the recommendation",
        detail:
          "Recommend a smaller commitment that acknowledges missing evidence.",
        cost: "The network can undertake less.",
        outcome:
          "One figure steps toward the shelter. The movement illustrates limiting a commitment while uncertainty remains.",
        effect: [2, -1, 2],
        animation: "handover",
        actor: 1,
      },
      {
        id: "record",
        title: "Record uncertainty and proceed",
        detail:
          "Recommend proceeding while keeping the report explicitly unconfirmed.",
        cost: "People act while important questions remain open.",
        outcome:
          "The scene moves onward while a figure remains beside the notes. Uncertainty remains visible in your learning record.",
        effect: [0, 1, -1],
        animation: "depart",
        actor: 0,
      },
    ],
    reflection:
      "Explain how an occupation authority's message can be useful for studying its aims while remaining weak evidence for civilian safety.",
    historian:
      "These are source-reasoning decisions, not a reenactment of Lim's capture. No choice can prevent his documented arrest or turn historical suffering into a player failure. The coastal setting condenses the regional journey, not a verified landing site. The training accounts are retrospective, and no documented meeting among these figures is asserted.",
  },
];
