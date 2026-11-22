import type { PreviewInsight } from "@adventure/engine";
import type { PlayerView } from "@adventure/play-contract";
import type { AdventureSpec } from "@adventure/spec-v3";

import type { PlayFocus } from "@/components/play/v3/play-focus";
import { textFields, type Path } from "@/lib/v3/review-chat/outline";

/** A line the teacher can change in place: the field path and its current text. */
export type ContextEdit = { path: Path; value: string };
export type ContextLine = { text: string; edit?: ContextEdit };
/** `cleared`: an editable single field whose text is empty; shown as a small row to fill in again. */
export type ContextEntry = { label: string; lines: ContextLine[]; list?: boolean; cleared?: boolean };
export type PreviewContext = {
  title: string;
  /** Teacher-facing description of what is in focus, also sent to the chat. */
  subject: string;
  /** State from the running preview; read-only. */
  live: ContextEntry[];
  entries: ContextEntry[];
};

const present = (value: string | undefined | null): value is string => Boolean(value?.trim());

function builder(spec: AdventureSpec, itemPath: Path) {
  const editable = new Set(
    textFields(spec, itemPath).filter((field) => !field.locked).map((field) => field.path.join(".")),
  );
  const line = (text: string, path?: Path, value = text): ContextLine =>
    path && editable.has(path.join(".")) ? { text, edit: { path, value } } : { text };
  const field = (label: string, text: string | undefined, path: Path): ContextEntry[] =>
    present(text)
      ? [{ label, lines: [line(text, path)] }]
      : text !== undefined && editable.has(path.join("."))
        ? [{ label, lines: [line("", path, text)], cleared: true }]
        : [];
  const list = (label: string, lines: ContextLine[]): ContextEntry[] =>
    lines.length ? [{ label, lines, list: true }] : [];
  return { line, field, list };
}

function readOnly(label: string, texts: string[], list = true): ContextEntry[] {
  const lines = texts.filter(present).map((text) => ({ text }));
  return lines.length ? [{ label, lines, list }] : [];
}

/**
 * The readable form of what the game gives the model for the item in focus: a character's prompt,
 * a document's text and reading check, the stage's setting, the role brief, or the reveal.
 */
export function previewContext(
  spec: AdventureSpec,
  focus: PlayFocus,
  insight: PreviewInsight | null,
  view: PlayerView,
): PreviewContext | null {
  if (focus.kind === "character") {
    const index = spec.characters.findIndex((character) => character.id === focus.id);
    const character = spec.characters[index];
    if (!character) return null;
    const base: Path = ["characters", index];
    const { line, field, list } = builder(spec, base);
    const now = insight?.characters[character.id];
    return {
      title: character.name,
      subject: `character "${character.name}" (${base.join(".")}), whom the student is talking to`,
      live: [
        ...(now?.stance ? readOnly(`Current stance: ${now.stance.label}`, [now.stance.demeanour], false) : []),
        ...readOnly("May share now", now?.mayShare ?? []),
        ...readOnly("Not yet", now?.notYet ?? []),
      ],
      entries: [
        ...field("Title", character.title, [...base, "title"]),
        ...field("Public position", character.persona.publicPosition, [...base, "persona", "publicPosition"]),
        ...field("Voice", character.persona.voice, [...base, "persona", "voice"]),
        ...list("Phrases", character.persona.phrases.map((phrase, i) => line(phrase.text, [...base, "persona", "phrases", i, "text"]))),
        ...field("Knew then", character.persona.knewThen, [...base, "persona", "knewThen"]),
        ...field("Wants from the student", character.persona.wantsFromStudent, [...base, "persona", "wantsFromStudent"]),
        ...field("Private agenda", character.persona.privateAgenda, [...base, "persona", "privateAgenda"]),
        ...list("Holds back", character.persona.withholds.map((text, i) => line(text, [...base, "persona", "withholds", i]))),
        ...list("Slants", character.slants.map((slant, i) => line(slant.claim, [...base, "slants", i, "claim"]))),
      ],
    };
  }
  if (focus.kind === "document") {
    const index = spec.documents.findIndex((document) => document.id === focus.id);
    const document = spec.documents[index];
    if (!document) return null;
    const base: Path = ["documents", index];
    const { line, field, list } = builder(spec, base);
    const provenance = document.provenance;
    const held = view.documents.find((item) => item.id === document.id);
    const notes = new Map(
      spec.discoveries.flatMap((discovery, i) => "documentId" in discovery.holder && discovery.holder.documentId === document.id
        ? [[discovery.holder.keyPassageId, { note: discovery.note, index: i }] as const]
        : []),
    );
    const passages = document.keyPassages.map((passage) => {
      const quote = `“${document.body.slice(passage.start, passage.end).trim()}”`;
      const note = notes.get(passage.id);
      if (!note) return { text: quote };
      const notePath: Path = ["discoveries", note.index, "note"];
      return builder(spec, ["discoveries", note.index]).line(`${quote} Student's note: ${note.note}`, notePath, note.note);
    });
    return {
      title: document.title,
      subject: `document "${document.title}" (${base.join(".")}), which the student is reading`,
      live: readOnly("In this preview", [
        held?.readingCheck?.status ? `Reading check: ${held.readingCheck.status}` : "",
      ], false),
      entries: [
        ...field("Title", document.title, [...base, "title"]),
        ...readOnly("Provenance", [
          [document.kind, provenance.masthead, provenance.date, provenance.place].filter(present).join(", "),
          present(provenance.sender) ? `From ${provenance.sender}${present(provenance.recipient) ? ` to ${provenance.recipient}` : ""}` : "",
        ], false),
        ...field("Body", document.body, [...base, "body"]),
        ...list("Key passages", passages),
        ...list("Reading check", (document.readingCheck?.variants ?? []).map((question, i) => line(question.prompt, [...base, "readingCheck", "variants", i, "prompt"]))),
        ...list("Glossary", document.glossary.map((entry, i) => line(`${entry.term}: ${entry.meaning}`, [...base, "glossary", i, "meaning"], entry.meaning))),
      ],
    };
  }
  if (focus.kind === "stage") {
    const stage = spec.stages[focus.index];
    if (!stage) return null;
    const base: Path = ["stages", focus.index];
    const { line, field, list } = builder(spec, base);
    const momentIndex = spec.definingMoments.findIndex((moment) => moment.id === stage.definingMomentId);
    const moment = spec.definingMoments[momentIndex];
    const momentPath: Path = ["definingMoments", momentIndex];
    const momentFields = builder(spec, momentPath);
    const preparation = view.stage?.index === focus.index ? view.stage.preparation : undefined;
    return {
      title: stage.title,
      subject: `stage ${focus.index + 1} "${stage.title}" (${base.join(".")}), where the student is on the map`,
      live: preparation
        ? [
            ...readOnly("Preparation", [`${preparation.completed} of ${preparation.required} done`], false),
            ...readOnly("Conversations to have", preparation.essentialConversations.map((item) => `${item.name}${item.complete ? " (done)" : ""}`)),
          ]
        : [],
      entries: [
        ...field("Time and place", stage.timePlace, [...base, "timePlace"]),
        ...field("Central question", stage.centralQuestion, [...base, "centralQuestion"]),
        ...field("Opening narration", stage.openingNarration, [...base, "openingNarration"]),
        ...list("Rooms", stage.rooms.map((room, i) => line(`${room.name}: ${room.description}`, [...base, "rooms", i, "description"], room.description))),
        ...(moment ? momentFields.field("Defining moment", moment.scene, [...momentPath, "scene"]) : []),
        ...(moment ? momentFields.list("Choices", moment.acts.map((act, i) => momentFields.line(act.text, [...momentPath, "acts", i, "text"]))) : []),
      ],
    };
  }
  if (focus.kind === "role") {
    const { line, field, list } = builder(spec, ["role"]);
    const brief = spec.role.privateBrief;
    return {
      title: spec.role.name,
      subject: `the student's role "${spec.role.name}" (role), shown in the briefing`,
      live: [],
      entries: [
        ...field("Position", spec.role.position, ["role", "position"]),
        ...field("Reputation", spec.role.reputation, ["role", "reputation"]),
        ...field("Stakes", spec.role.stakes, ["role", "stakes"]),
        ...field("Situation", spec.role.situation, ["role", "situation"]),
        ...list("Goals", brief.goals.map((text, i) => line(text, ["role", "privateBrief", "goals", i]))),
        ...list("Fears", brief.fears.map((text, i) => line(text, ["role", "privateBrief", "fears", i]))),
        ...list("Constraints", brief.constraints.map((text, i) => line(text, ["role", "privateBrief", "constraints", i]))),
        ...list("Knows", brief.knows.map((text, i) => line(text, ["role", "privateBrief", "knows", i]))),
      ],
    };
  }
  const reveal = spec.reveal;
  const { line, field, list } = builder(spec, ["reveal"]);
  return {
    title: "Reveal and questions",
    subject: "the reveal and discussion questions (reveal, teacherQuestions) at the end of the adventure",
    live: [],
    entries: [
      ...(reveal ? field("What happened", reveal.whatHappened, ["reveal", "whatHappened"]) : []),
      ...(reveal ? list("Interpretations", reveal.interpretations.map((text, i) => line(text, ["reveal", "interpretations", i]))) : []),
      ...(reveal ? list("Corrections", reveal.corrections.map((text, i) => line(text, ["reveal", "corrections", i]))) : []),
      ...(reveal ? list("Could have gone", reveal.couldHaveGone.map((text, i) => line(text, ["reveal", "couldHaveGone", i]))) : []),
      ...readOnly("Discussion questions", spec.teacherQuestions),
    ],
  };
}

/** Plain text of the context, for the editor chat. */
export function previewContextText(context: PreviewContext): string {
  const block = (entry: ContextEntry) =>
    entry.list
      ? `${entry.label}:\n${entry.lines.map((line) => `- ${line.text}`).join("\n")}`
      : `${entry.label}: ${entry.lines.map((line) => line.text).join(" ")}`;
  return [
    `The teacher is previewing the adventure and looking at the ${context.subject}.`,
    ...context.live.map((entry) => `Right now in the preview, ${block(entry)}`),
    ...context.entries.filter((entry) => !entry.cleared).map(block),
  ].join("\n").slice(0, 6000);
}
