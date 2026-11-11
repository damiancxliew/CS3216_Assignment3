import { describe, expect, it } from "vitest";
import type { PlayerView } from "@adventure/play-contract";
import { emptyQuestMemory, parsePreparationHint, questPlan, rememberQuest } from "@/components/play/v3/quest-steps";

const rooms = [{ id: "command", name: "Command room" }, { id: "dossier", name: "History dossier (today)" }, { id: "liaison", name: "Liaison office" }];
const doc = (id: string, title: string, status?: "passed" | "unanswered") => ({
  id, title, kind: "report", body: "", provenance: { masthead: null, date: null, sender: null, recipient: null, place: null },
  real: false, sourceLabel: null, glossary: [], open: false,
  ...(status ? { readingCheck: { status, question: null, recovery: null, feedback: null, explanation: null } } : {}),
});
const view = (overrides: { preparation?: Record<string, unknown>; [key: string]: unknown } = {}): PlayerView => {
  const { preparation, ...rest } = overrides;
  return {
    phase: "stage",
    stage: {
      index: 0, count: 2, title: "Fort Canning", timePlace: "1942", centralQuestion: "Why is Percival so sure?", intro: null,
      preparation: {
        completed: 0, required: 2, ready: false, timerExpired: false,
        hint: "Read “More soldiers” in Command room and complete its reading check.",
        essentialConversations: [{ characterId: "percival", name: "Arthur Percival", complete: false }, { characterId: "arjun", name: "Captain Arjun Singh", complete: false }],
        ...preparation,
      },
    },
    rooms, currentRoomId: "command",
    characters: [{ id: "percival", name: "Arthur Percival", title: "General", stanceId: null, portraitKey: "percival", preparation: { completed: 0, required: 1, ready: false, hint: "Read “More soldiers” in Command room and complete its reading check." } }],
    speakers: [], messages: [], notes: [], documents: [],
    documentsHere: [{ id: "doc-troops", kind: "report", title: "More soldiers", read: false }],
    definingMoment: null, timer: null, pendingCheck: false,
    ...rest,
  } as unknown as PlayerView;
};

describe("quest steps from stage preparation", () => {
  it("parses the engine's preparation hints into places, sources and people", () => {
    const base = view();
    expect(parsePreparationHint("Read “Where is the fleet?” in History dossier (today) and complete its reading check.", base))
      .toEqual({ kind: "read", title: "Where is the fleet?", roomId: "dossier", held: false });
    expect(parsePreparationHint("Show your note from “Gemas” to Captain Arjun Singh in Liaison office.", base))
      .toEqual({ kind: "talk", characterId: "arjun", name: "Captain Arjun Singh", roomId: "liaison", noteFrom: "Gemas" });
    expect(parsePreparationHint("Speak with Arthur Percival about the evidence you have collected.", base))
      .toMatchObject({ kind: "talk", characterId: "percival", roomId: null });
    expect(parsePreparationHint("Something unexpected", base)).toBeNull();
  });

  it("starts with the source in the room, locks the talk behind it, and points the map at it", () => {
    const plan = questPlan(view())!;
    expect(plan.next).toMatchObject({ text: "Read “More soldiers”", where: "Here in this room" });
    expect(plan.guideTarget).toEqual({ kind: "document", id: "doc-troops" });
    const percival = plan.steps.find((step) => step.id === "talk-percival")!;
    expect(percival).toMatchObject({ locked: true, lockReason: "Read “More soldiers” first" });
    expect(plan.steps.at(-1)).toMatchObject({ kind: "decide", text: "Make your decision", locked: true });
    expect(plan.steps.map((step) => step.text).join(" ")).not.toMatch(/Evidence preparation|Essential conversations|steps left/);
  });

  it("prefers talking to an unlocked person here, then walks to the hinted room", () => {
    const afterRead = view({
      preparation: { completed: 1, hint: "Read “Where is the fleet?” in History dossier (today) and complete its reading check." },
      characters: [{ id: "percival", name: "Arthur Percival", title: "General", stanceId: null, portraitKey: "percival", preparation: { completed: 1, required: 1, ready: true, hint: null } }],
      documents: [doc("doc-troops", "More soldiers", "passed")],
      documentsHere: [{ id: "doc-troops", kind: "report", title: "More soldiers", read: true }],
    });
    const talk = questPlan(afterRead)!;
    expect(talk.next).toMatchObject({ id: "talk-percival", where: "Here in this room" });
    expect(talk.guideTarget).toEqual({ kind: "character", id: "percival" });
    expect(talk.steps[0]).toMatchObject({ text: "Read “More soldiers”", done: true });

    const walk = questPlan(view({
      characters: afterRead.characters,
      documents: afterRead.documents,
      documentsHere: afterRead.documentsHere,
      preparation: { completed: 1, hint: "Read “Where is the fleet?” in History dossier (today) and complete its reading check.", essentialConversations: [{ characterId: "percival", name: "Arthur Percival", complete: true }, { characterId: "arjun", name: "Captain Arjun Singh", complete: false }] },
    }))!;
    expect(walk.next).toMatchObject({ text: "Read “Where is the fleet?”", where: "In History dossier (today)" });
    expect(walk.guideTarget).toEqual({ kind: "room", id: "dossier" });
    // Nothing in the view says where Captain Arjun Singh is, so that step carries no target.
    expect(walk.steps.find((step) => step.id === "talk-arjun")).toMatchObject({ target: null, where: null });
  });

  it("remembers people's prerequisites and named sources after leaving the room", () => {
    const memory = emptyQuestMemory();
    const liaison = view({
      currentRoomId: "liaison",
      preparation: { completed: 1, hint: "Read “Gemas” in History dossier (today) and complete its reading check." },
      characters: [{ id: "arjun", name: "Captain Arjun Singh", title: "Captain", stanceId: null, portraitKey: "arjun", preparation: { completed: 0, required: 1, ready: false, hint: "Read “Gemas” in History dossier (today) and complete its reading check." } }],
      documentsHere: [],
      documents: [doc("doc-troops", "More soldiers", "passed")],
    });
    rememberQuest(memory, liaison, questPlan(liaison, memory)?.steps);
    const elsewhere = view({ currentRoomId: "command", characters: [], documents: liaison.documents, documentsHere: [], preparation: { completed: 1, hint: null } });
    const plan = questPlan(elsewhere, memory)!;
    expect(plan.steps.find((step) => step.id === "talk-arjun")).toMatchObject({ locked: true, lockReason: "Read “Gemas” first" });
    expect(plan.next).toMatchObject({ text: "Read “Gemas”", target: { kind: "room", id: "dossier" } });
  });

  it("ends on the decision once preparation is ready, without a map target", () => {
    const plan = questPlan(view({ preparation: { completed: 2, ready: true, hint: null, essentialConversations: [{ characterId: "percival", name: "Arthur Percival", complete: true }] } }))!;
    expect(plan.ready).toBe(true);
    expect(plan.next).toMatchObject({ kind: "decide", locked: false, where: "You’re ready!" });
    expect(plan.guideTarget).toBeNull();
  });

  it("returns null for stages without preparation", () => {
    const plain = view();
    delete (plain.stage as { preparation?: unknown }).preparation;
    expect(questPlan(plain)).toBeNull();
  });
});
