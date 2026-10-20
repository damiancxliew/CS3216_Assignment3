import {
  Action,
  PlayerView,
  type DocumentView,
  type MessageView,
} from "@adventure/play-contract";
import type { V3PlayClient, V3PlayResult } from "@/lib/play/v3/client";
import { sources, sourceById, stages } from "./lim-bo-seng";
import { buildStoryMap } from "./story-maps";

export const DEMO_SAVE_KEY = "standalone.lim-bo-seng.v3.v1";
const roomSets = [
  [
    {
      id: "household",
      name: "Family provision shop",
      description:
        "A Singapore shophouse provision shop with wooden shutters, a five-foot way, shelves, rice sacks, enamel signs, a bicycle and a family writing desk.",
    },
    {
      id: "quay",
      name: "Harbour quay",
      description:
        "A timber harbour quay with moored sampans, cargo crates, baskets, rope, a handcart and boat landing.",
    },
    {
      id: "records",
      name: "Community office",
      description:
        "A modest shophouse office with wooden desks, correspondence, household records, books and an oil lamp.",
    },
  ],
  [
    {
      id: "briefing",
      name: "Training hut",
      description:
        "A canvas and timber training camp hut with maps, a radio set, benches, notebooks and supply crates.",
    },
    {
      id: "gathering",
      name: "Camp gathering",
      description:
        "A camp meeting shelter under trees with wooden benches, enamel mugs, canvas packs and lanterns.",
    },
    {
      id: "records",
      name: "Reading table",
      description:
        "A timber hut with a writing desk, training records, correspondence, books and an oil lamp.",
    },
  ],
  [
    {
      id: "shore",
      name: "Coastal village",
      description:
        "A wooded Malayan coastal village with fishing boats, timber huts, nets, baskets and a harbour landing.",
    },
    {
      id: "liaison",
      name: "Liaison shelter",
      description:
        "A thatched meeting shelter beside the coastal path with benches, provisions and maps.",
    },
    {
      id: "records",
      name: "Stores hut",
      description:
        "A timber hut with supply crates, maps, documents, sacks and lanterns.",
    },
  ],
  [
    {
      id: "shop",
      name: "Provision shop",
      description:
        "An occupied Singapore shophouse with sparse provisions, rice sacks, empty containers, a weighing scale, woven baskets, a handcart and wooden shutters.",
    },
    {
      id: "courier",
      name: "Civilian courtyard",
      description:
        "A shophouse courtyard with a bicycle, supply parcels, a vegetable plot, washing lines and water jars.",
    },
    {
      id: "records",
      name: "Source reading room",
      description:
        "A modest office with a desk, purchasing cards, occupation currency, household registers and an oil lamp. Sources from Singapore are learner evidence rather than documented items in Lim's possession.",
    },
  ],
  [
    {
      id: "meeting",
      name: "Jungle meeting hut",
      description:
        "A timber meeting hut in the Malayan jungle, with a map table, radio, paper reports, provisions and an oil lamp.",
    },
    {
      id: "shelter",
      name: "Volunteer shelter",
      description:
        "A canvas camp shelter under trees, with benches, blankets and supply crates.",
    },
    {
      id: "records",
      name: "Reports table",
      description:
        "A timber jungle hut with a desk, handwritten reports, a newspaper and notebooks.",
    },
  ],
];
export const demoScenery = stages.map((stage, i) => ({
  authored: buildStoryMap(
    i,
    stage.id,
    roomSets[i].map((r) => r.id),
    stage.npcs.map((npc) => npc.id),
  ),
  storyContext: `${stage.place} ${stage.date}. ${i === 0 || i === 2 ? "harbour waterfront" : i === 1 || i === 4 ? "jungle camp" : "occupied town shophouses"}`,
  roomDescriptions: Object.fromEntries(
    roomSets[i].map((r) => [r.id, r.description]),
  ),
}));
export type DemoV3State = {
  version: 1;
  castEdition?: 2;
  previousEditionMessages?: MessageView[];
  revision: number;
  phase: PlayerView["phase"];
  stage: number;
  intro: boolean;
  room: string;
  held: string[];
  open: string | null;
  notes: PlayerView["notes"];
  messages: MessageView[];
  moment: "choosing" | "predicting" | null;
  chosen: string | null;
  decisions: {
    stage: number;
    choice: string;
    prediction: string;
    evidence: string[];
  }[];
  answers: NonNullable<PlayerView["interview"]>["answer"][];
};
export function newDemoV3State(): DemoV3State {
  const state: DemoV3State = {
    version: 1,
    castEdition: 2,
    revision: 0,
    phase: "stage",
    stage: 0,
    intro: true,
    room: roomSets[0][0].id,
    held: [],
    open: null,
    notes: [],
    messages: [],
    moment: null,
    chosen: null,
    decisions: [],
    answers: [],
  };
  roomOpening(state);
  return state;
}
export function restoreDemoV3State(raw: string | null): DemoV3State {
  try {
    if (!raw) return newDemoV3State();
    const s = JSON.parse(raw) as DemoV3State;
    if (
      s.version !== 1 ||
      !Number.isInteger(s.stage) ||
      s.stage < 0 ||
      s.stage >= stages.length ||
      !Number.isInteger(s.revision) ||
      s.revision < 0 ||
      !Array.isArray(s.decisions) ||
      s.decisions.length > stages.length ||
      !Array.isArray(s.answers) ||
      s.answers.length > 2 ||
      typeof s.intro !== "boolean" ||
      !roomSets[s.stage].some((r) => r.id === s.room) ||
      !Array.isArray(s.held) ||
      !s.held.every((id) => sources.some((source) => source.id === id)) ||
      ![null, "choosing", "predicting"].includes(s.moment) ||
      !["briefing", "stage", "epilogue", "interview", "reveal"].includes(
        s.phase,
      )
    )
      return newDemoV3State();
    // Preserve pre-merge demo saves when adopting the journal's new stage field.
    if (Array.isArray(s.messages))
      s.messages = s.messages.map((m) => ({
        ...m,
        stageIndex: m.stageIndex ?? null,
      }));
    // Preserve progress and export old fictional dialogue without attributing it to real people.
    if (s.castEdition !== 2) {
      s.previousEditionMessages = s.messages;
      s.messages = [];
      s.castEdition = 2;
      roomOpening(s);
    }
    // The public contract validates restored message/note/interview structures.
    PlayerView.parse(projectDemoV3(s));
    if (
      !s.decisions.every(
        (d) =>
          stages[d.stage]?.choices.some((c) => c.id === d.choice) &&
          Array.isArray(d.evidence) &&
          d.evidence.every((id) => sources.some((source) => source.id === id)),
      )
    )
      return newDemoV3State();
    return s;
  } catch {
    return newDemoV3State();
  }
}
function document(id: string, open: boolean): DocumentView {
  const source = sourceById(id);
  return {
    id,
    kind:
      source.id === "press"
        ? "newspaper"
        : source.id === "letter"
          ? "letter"
          : source.id.startsWith("farewell")
            ? "memoir"
            : "report",
    title: source.title,
    provenance: {
      masthead: source.credit,
      date: source.date,
      sender: null,
      recipient: null,
      place: null,
    },
    body: `${source.summary}\n\nSOURCE LIMITS\n${source.limitation}\n\nPROVENANCE\n${source.credit}\n${source.url}\n\nThis is a lesson summary or labelled adaptation, not an original verbatim transcript. Historical photographs and the currency scan are available in Source archive.`,
    real: false,
    sourceLabel: `${source.kind} · ${source.credit}`,
    glossary: [],
    open,
  };
}
function sourceRoom(stageIndex: number, id: string) {
  return roomSets[stageIndex][stages[stageIndex].sources.indexOf(id) % 3].id;
}
const briefing: PlayerView["briefing"] = {
  name: "The Cost of Resistance",
  position: "student observer following Lim Bo Seng’s story",
  relationships: [
    "Meet Lim Bo Seng and Gan Choo Neo through biographical evidence.",
    "The resistance depends on local people who bear risks of their own.",
    "Compare the accounts of Tham Sien Yen and Tan Chong Tee; investigate Elizabeth Choy’s civilian help.",
  ],
  reputation:
    "Your task is to build a supported interpretation, not to impersonate a historical figure.",
  stakes:
    "Explore what resistance required from individuals and the communities around them, using the evidence of occupation, hardship and survival.",
  privateBrief: {
    goals: [
      "Build cooperation while recognising its cost",
      "Use evidence to distinguish confident claims from justified conclusions",
    ],
    fears: [
      "Leaving family responsibilities unresolved",
      "Asking others to bear risks they cannot freely choose",
    ],
    constraints: [
      "Named people are historical. Conversations, choices, movements and maps are learning reconstructions.",
      "Your decisions do not change Lim's documented arrest or death.",
      "A general source does not prove a particular household’s experience.",
    ],
    knows: [
      "Lim left Singapore before its fall and later joined resistance work in Malaya.",
      "This standalone Chapter 6 lesson takes about 25–35 minutes with discussion.",
      "Archival opening photograph: Singapore surrender, 15 February 1942, AWM 127902; not Lim's departure.",
    ],
  },
  situation: stages[0].intro,
};
export function projectDemoV3(s: DemoV3State): PlayerView {
  const stage = stages[s.stage];
  const rooms = roomSets[s.stage];
  const choice = stage.choices.find((c) => c.id === s.chosen);
  const previous = s.decisions.at(-1);
  const previousStage = previous ? stages[previous.stage] : null;
  const characters = stage.npcs
    .filter((_, i) => rooms[i].id === s.room)
    .map((n) => ({
      id: n.id,
      name: n.name,
      title: n.role,
      stanceId: null,
      portraitKey: n.id,
    }));
  const historical =
    "Lim Bo Seng was captured on 27 March 1944 and died at Batu Gajah on 29 June 1944. His remains were reburied at MacRitchie on 13 January 1946. These events are not a consequence of the player's choices. The conversations and offered preparations are dramatic reconstructions, not records of his private thoughts.";
  const answer = s.answers[0] ?? null,
    response = s.answers[1] ?? null;
  return {
    phase: s.phase,
    briefing,
    stage: {
      index: s.stage,
      count: stages.length,
      title: stage.title,
      timePlace: `${stage.place} · ${stage.date}`,
      centralQuestion: stage.question,
      intro: s.intro
        ? {
            narration: `${stage.intro}\n\n${stage.objective}\n\n${stage.historian}`,
            predictionReveal:
              previous && previousStage
                ? {
                    predicted: previous.prediction,
                    actual: previousStage.choices.find(
                      (c) => c.id === previous.choice,
                    )!.outcome,
                    because:
                      "This is the consequence of your selected reconstruction, not a claim that Lim made this exact choice.",
                  }
                : null,
          }
        : null,
    },
    rooms: rooms.map(({ id, name }) => ({ id, name })),
    currentRoomId: s.room,
    characters,
    speakers: [
      ...new Map(
        stages
          .flatMap((stage) => stage.npcs)
          .filter((npc) =>
            s.messages.some((message) => message.characterId === npc.id),
          )
          .map((npc) => [
            npc.id,
            { id: npc.id, name: npc.name, title: npc.role },
          ]),
      ).values(),
    ],
    messages: s.messages,
    notes: s.notes,
    documents: s.held.map((id) => document(id, s.open === id)),
    documentsHere: stage.sources
      .filter((id) => sourceRoom(s.stage, id) === s.room)
      .map((id) => ({
        id,
        kind: document(id, false).kind,
        title: sourceById(id).title,
        read: s.held.includes(id),
      })),
    definingMoment: s.moment
      ? {
          momentId: stage.id,
          scene: stage.question,
          deciderId: stage.npcs[0].id,
          deciderName: "the people affected by your choice",
          status: s.moment,
          acts: stage.choices.map((c) => ({
            id: c.id,
            text: `${c.title}. ${c.detail} Trade-off: ${c.cost}`,
          })),
          nudge:
            s.notes.filter((n) => n.stageIndex === s.stage).length <
            stage.sources.length
              ? "You can inspect the other sources before deciding. The archive and notes remain available."
              : null,
          chosenActId: s.chosen,
          reaction: choice ? `${choice.outcome}\n\n${stage.reflection}` : null,
          predictionOptions:
            s.moment === "predicting"
              ? [
                  {
                    outcomeId: "support",
                    text: "The choice improves support but leaves a cost for others.",
                  },
                  {
                    outcomeId: "cooperation",
                    text: "Cooperation grows, but uncertainty remains.",
                  },
                  {
                    outcomeId: "readiness",
                    text: "The group can proceed, while some needs remain unresolved.",
                  },
                ]
              : [],
        }
      : null,
    timer: null,
    pendingCheck: false,
    epilogue:
      s.phase === "epilogue"
        ? {
            title: "The person behind the reconstruction",
            label: "Historical record",
            text: historical,
          }
        : null,
    interview:
      s.phase === "interview"
        ? {
            interviewer: "Your history teacher",
            question:
              "Beyond personal courage, what made resistance possible? Use your notes to explain a cost for civilians and one limitation of your evidence.",
            verdicts: [
              {
                id: "community",
                text: "Resistance depended on local cooperation and material support.",
              },
              {
                id: "courage",
                text: "Personal courage was sufficient on its own.",
              },
              {
                id: "uniform",
                text: "Everyone experienced occupation in the same way.",
              },
            ],
            answer,
            pushBack: answer
              ? "Which source supports your explanation? Distinguish a reconstruction that felt convincing from evidence that establishes a historical claim. Does Singapore evidence prove what happened in Perak?"
              : null,
            response,
            closing: response
              ? "Your explanation is saved. Compare it with a new source in class; no automated attainment grade has been assigned."
              : null,
            closed: response !== null,
          }
        : null,
    reveal:
      s.phase === "reveal"
        ? {
            whatHappened: historical,
            pathVsHistory: s.decisions.map((d) => ({
              stageIndex: d.stage,
              yours: stages[d.stage].choices.find((c) => c.id === d.choice)!
                .outcome,
              history: stages[d.stage].historian,
              matched: false,
              closedEndings: [],
            })),
            corrections: [
              "Fictional NPC speech is not oral testimony.",
              "Original records, school adaptations and modern summaries have different evidential limits.",
            ],
            missedCore: [],
            more: {
              interpretations: [
                "Evaluate a claim, its evidence and its limits rather than treating engagement as proof of learning.",
              ],
              sources: {
                teacher: [
                  "Supplied Sec 2 guidebook: Chapter 6 and resistance exercise, pp. 61–63.",
                ],
                other: sources.map(
                  (source) => `${source.title}: ${source.url}`,
                ),
                invented: [
                  "Supporting NPCs, dialogue, local room layouts, the offered decisions and their immediate consequences.",
                ],
              },
              couldHaveGone: [],
              secretPathExisted: false,
              playback: {
                acts: s.decisions.map(
                  (d) =>
                    stages[d.stage].choices.find((c) => c.id === d.choice)!
                      .title,
                ),
                predictions: s.decisions.map((d) => d.prediction),
                interview: s.answers.map((a) => a?.text ?? ""),
              },
            },
            teacherQuestions: stages.map((stage) => stage.reflection),
          }
        : null,
    ended: s.phase === "reveal",
  };
}
function addMessage(
  s: DemoV3State,
  kind: MessageView["kind"],
  text: string,
  characterId: string | null = null,
  noteId: string | null = null,
) {
  s.messages.push({
    id: `message-${s.revision}-${s.messages.length}`,
    kind,
    characterId,
    roomId: s.room,
    text,
    insertedNoteId: noteId,
    stageIndex: s.stage,
    at: Date.now(),
  });
}
function roomOpening(s: DemoV3State) {
  stages[s.stage].npcs.forEach((npc, i) => {
    if (
      roomSets[s.stage][i].id === s.room &&
      !s.messages.some(
        (m) =>
          m.characterId === npc.id &&
          m.roomId === s.room &&
          m.kind === "character" &&
          m.id.startsWith(`opening-${s.stage}`),
      )
    )
      s.messages.push({
        id: `opening-${s.stage}-${npc.id}`,
        kind: "character",
        characterId: npc.id,
        roomId: s.room,
        text: npc.opening,
        insertedNoteId: null,
        stageIndex: s.stage,
        at: Date.now(),
      });
  });
}
export function createDemoV3Client(
  initial: DemoV3State,
  save: (state: DemoV3State) => void,
  fetchImpl: typeof fetch = fetch,
): V3PlayClient {
  let state = structuredClone(initial);
  const result = (): V3PlayResult => ({
    ok: true,
    revision: state.revision,
    view: projectDemoV3(state),
  });
  return {
    refresh: async () => result(),
    async act(revision, untrusted) {
      if (revision !== state.revision)
        return {
          ok: false,
          kind: "stale",
          revision: state.revision,
          view: projectDemoV3(state),
        };
      try {
        const action = Action.parse(untrusted);
        const next = structuredClone(state);
        const stage = stages[next.stage];
        if (action.type === "continue") {
          if (next.phase === "briefing") next.phase = "stage";
          else if (next.phase === "stage" && next.intro) {
            next.intro = false;
            roomOpening(next);
          } else if (next.phase === "epilogue") next.phase = "interview";
          else if (next.phase === "interview" && next.answers.length === 2)
            next.phase = "reveal";
          else
            throw new Error(
              "Complete the current conversation before continuing.",
            );
        } else if (
          action.type === "interviewAnswer" &&
          next.phase === "interview"
        ) {
          if (
            !action.evidenceNoteIds.every((id) =>
              next.notes.some((n) => n.id === id),
            )
          )
            throw new Error("Choose evidence from your notes.");
          if (next.answers.length >= 2)
            throw new Error("Your reflection is already recorded.");
          next.answers.push({
            verdictId: action.verdictId,
            evidenceNoteIds: action.evidenceNoteIds,
            text: action.text ?? null,
          });
        } else if (next.phase !== "stage" || next.intro)
          throw new Error("Open the map before taking this action.");
        else if (action.type === "enterRoom") {
          if (
            next.moment ||
            !roomSets[next.stage].some((r) => r.id === action.roomId)
          )
            throw new Error("That room is not available now.");
          next.room = action.roomId;
          roomOpening(next);
        } else if (action.type === "openDocument") {
          if (
            !next.held.includes(action.documentId) &&
            (!stage.sources.includes(action.documentId) ||
              sourceRoom(next.stage, action.documentId) !== next.room)
          )
            throw new Error("Walk to the source before picking it up.");
          next.held = [...new Set([...next.held, action.documentId])];
          next.open = action.documentId;
        } else if (action.type === "closeDocument") next.open = null;
        else if (action.type === "selectPassage") {
          if (next.moment || !next.held.includes(action.documentId))
            throw new Error("Read the document before taking a note.");
          const doc = document(action.documentId, true);
          if (action.end > doc.body.length)
            throw new Error("Select a passage inside the document.");
          const id = `source-${next.stage}-${action.documentId}`;
          if (!next.notes.some((n) => n.id === id))
            next.notes.push({
              id,
              text: `${sourceById(action.documentId).title}: ${doc.body.slice(action.start, action.end)}\nSource limit: ${sourceById(action.documentId).limitation}`,
              source: "document",
              stageIndex: next.stage,
              at: Date.now(),
            });
        } else if (action.type === "message" || action.type === "insertNote") {
          if (next.moment)
            throw new Error(
              "Finish the decision before starting another conversation.",
            );
          const npc = stage.npcs.find(
            (n, i) =>
              n.id === action.characterId &&
              roomSets[next.stage][i].id === next.room,
          );
          if (!npc) throw new Error("Walk to this person before speaking.");
          const note =
            action.type === "insertNote"
              ? next.notes.find((n) => n.id === action.noteId)
              : null;
          if (action.type === "insertNote" && !note)
            throw new Error("That note is not in your journal.");
          const text =
            action.type === "message"
              ? action.text
              : `${action.text ?? "What does this evidence suggest for our decision?"}\nEvidence: ${note!.text}`;
          const history = next.messages
            .filter(
              (m) =>
                m.characterId === npc.id &&
                (m.kind === "player" || m.kind === "character"),
            )
            .slice(-8)
            .map((m) => ({
              role: m.kind === "player" ? "user" : "assistant",
              content: m.text.slice(0, 1800),
            }));
          const response = await fetchImpl("/api/demo/lim-bo-seng/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stage: next.stage,
              npc: npc.id,
              question: text.slice(0, 1000),
              history,
              decisions: next.decisions.map((d) => ({
                stage: stages[d.stage].id,
                choice: d.choice,
                reason:
                  "Selected in the v3 decision interface; see conversation and evidence notes.",
              })),
            }),
          });
          if (!response.ok)
            throw new Error(
              "Conversation unavailable. Try again; your sources and map remain available.",
            );
          const answer = await response.json();
          if (
            typeof answer.reply !== "string" ||
            !Array.isArray(answer.sources) ||
            !answer.sources.every((id: string) =>
              sources.some((source) => source.id === id),
            )
          )
            throw new Error(
              "The reply could not be validated. Please try again.",
            );
          addMessage(
            next,
            "player",
            action.type === "message"
              ? action.text
              : (action.text ?? "I want to discuss this evidence."),
            npc.id,
            note?.id ?? null,
          );
          addMessage(
            next,
            "character",
            `${answer.reply}\n\n${answer.mode === "live" ? "" : "Research note · live conversation unavailable. "}Sources: ${answer.sources.map((id: string) => sourceById(id).title).join("; ")}. Inspect records in Source archive.`,
            npc.id,
          );
        } else if (action.type === "endStage") {
          if (!next.notes.some((n) => n.stageIndex === next.stage))
            throw new Error(
              "Read a source and select a passage to save an evidence note before deciding.",
            );
          next.moment = "choosing";
        } else if (action.type === "act") {
          if (
            next.moment !== "choosing" ||
            !stage.choices.some((c) => c.id === action.actId)
          )
            throw new Error("Choose an available action.");
          next.chosen = action.actId;
          next.moment = "predicting";
        } else if (action.type === "predict") {
          if (
            next.moment !== "predicting" ||
            !next.chosen ||
            !["support", "cooperation", "readiness"].includes(action.outcomeId)
          )
            throw new Error("Choose a prediction for the current decision.");
          const prediction = projectDemoV3(
            next,
          ).definingMoment!.predictionOptions.find(
            (p) => p.outcomeId === action.outcomeId,
          )!.text;
          next.decisions.push({
            stage: next.stage,
            choice: next.chosen,
            prediction,
            evidence: next.notes
              .filter((n) => n.stageIndex === next.stage)
              .map((n) => n.id.replace(/^source-\d+-/, "")),
          });
          next.moment = null;
          next.chosen = null;
          next.open = null;
          if (next.stage === stages.length - 1) next.phase = "epilogue";
          else {
            next.stage++;
            next.intro = true;
            next.room = roomSets[next.stage][0].id;
          }
        } else if (action.type !== "tick")
          throw new Error("This action is not available now.");
        next.revision++;
        state = next;
        save(state);
        return result();
      } catch (e) {
        return {
          ok: false,
          kind: "error",
          message:
            e instanceof Error ? e.message : "Please try that action again.",
        };
      }
    },
  };
}
