import type { RoleBriefingView, StageView } from "@adventure/play-contract";

export interface V3CinematicBeat {
  id: string;
  kicker: string;
  title?: string;
  body?: string;
  items?: string[];
  image?: { src: string; alt: string; caption: string; credit: string; href: string };
  journey?: { stops: string[]; current: number };
  /** Held back behind "More about your role" on first viewing so the opening stays short. */
  more?: boolean;
}

export const BRIEFING_BEGIN_LABEL = "Enter the first stage";
export const STAGE_INTRO_BEGIN_LABEL = "Start exploring";

function cleanItems(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function nonEmpty(beat: V3CinematicBeat): V3CinematicBeat | null {
  const title = beat.title?.trim() || undefined;
  const body = beat.body?.trim() || undefined;
  const items = beat.items ? cleanItems(beat.items) : undefined;
  if (!title && !body && !items?.length) return null;
  return {
    id: beat.id,
    kicker: beat.kicker,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(items?.length ? { items } : {}),
    ...(beat.more ? { more: true } : {}),
  };
}

/** Generated fragments ("he did not yet trust the British") read as a sentence once capitalised and closed. */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capitalised = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?…"'”’)]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export function briefingBeats(briefing: RoleBriefingView, firstStage?: StageView): V3CinematicBeat[] {
  return [
    nonEmpty({
      id: "role",
      kicker: "Your role",
      title: briefing.name,
      body: briefing.position,
      ...(firstStage?.timePlace ? { items: [`At ${firstStage.timePlace}`] } : {}),
    }),
    nonEmpty({ id: "situation", kicker: "The situation", body: briefing.situation }),
    nonEmpty({
      id: "stakes",
      kicker: "What is at stake",
      body: briefing.stakes,
      ...(briefing.reputation.trim() ? { items: [`Your reputation: ${briefing.reputation}`] } : {}),
    }),
    nonEmpty({ id: "goals", kicker: "Your goals", items: briefing.privateBrief.goals }),
    nonEmpty({ id: "fears", kicker: "Your fears", items: briefing.privateBrief.fears, more: true }),
    nonEmpty({ id: "knows", kicker: "What you already know", items: briefing.privateBrief.knows, more: true }),
    nonEmpty({ id: "relationships", kicker: "People you know", items: briefing.relationships, more: true }),
  ].filter((beat): beat is V3CinematicBeat => beat !== null);
}

/**
 * Two short beats at most: what is happening, then the question. The stage title card already names the
 * place, and the map's quest card covers preparation, so neither is repeated here.
 */
export function stageIntroBeats(stage: StageView): V3CinematicBeat[] {
  const prediction = stage.intro?.predictionReveal;
  const happening = prediction
    ? nonEmpty({
        id: "what-happened",
        kicker: "What happened",
        body: prediction.actual,
        // Set the student's own call beside what happened, so the stage opens on the consequence of their guess.
        items: [
          prediction.predicted.trim() ? `You predicted: ${asSentence(prediction.predicted)}` : "",
          prediction.because.trim() ? `Why: ${asSentence(prediction.because)}` : "",
        ],
      })
    : stage.intro
      ? nonEmpty({ id: "narration", kicker: "Meanwhile", body: stage.intro.narration })
      : null;
  return [
    happening,
    nonEmpty({ id: "question", kicker: "The question", body: stage.centralQuestion }),
  ].filter((beat): beat is V3CinematicBeat => beat !== null);
}

/** Sentences, keeping closing quotes with their sentence ("…a fortress." Is it?). */
export function sentences(text: string): string[] {
  return (text.trim().match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) ?? []).map((part) => part.trim()).filter(Boolean);
}

/** The first `count` sentences for the screen, and whatever is left for "Read more". */
export function briefExcerpt(text: string, count = 2): { lead: string; rest: string } {
  const all = sentences(text);
  // A dateline ("February 1942.") rides along with the next sentence instead of using up the budget.
  let taken = 0;
  let counted = 0;
  while (taken < all.length && counted < count) {
    if (all[taken]!.split(/\s+/).length >= 4) counted += 1;
    taken += 1;
  }
  return { lead: all.slice(0, taken).join(" "), rest: all.slice(taken).join(" ") };
}

/**
 * The adventure's big question. There is no adventure-level question field, so it comes from the role's
 * stakes ("Singapore is called an impregnable fortress. Is it?"): the first question there, with the
 * sentence before it when the question alone is too short to stand. Otherwise the first stage's question.
 */
export function bigQuestion(briefing: Pick<RoleBriefingView, "stakes">, stage?: Pick<StageView, "centralQuestion"> | null): string | null {
  const parts = sentences(briefing.stakes);
  const index = parts.findIndex((part) => /\?["'”’)]*$/.test(part));
  if (index >= 0) {
    const question = parts[index]!;
    const lead = parts[index - 1];
    if (question.split(/\s+/).length < 6 && lead && `${lead} ${question}`.length <= 140) return `${lead} ${question}`;
    return question;
  }
  return stage?.centralQuestion.trim() || null;
}

/** "Fort Canning, Singapore, early February 1942", or before the first stage opens the situation's short dateline ("February 1942"). */
export function roleWhenWhere(briefing: Pick<RoleBriefingView, "situation">, stage?: Pick<StageView, "timePlace"> | null): string | null {
  const timePlace = stage?.timePlace.trim();
  if (timePlace) return timePlace;
  const first = sentences(briefing.situation)[0]?.replace(/[.!]+$/, "");
  return first && first.length <= 48 && /\b(1[0-9]{3}|20[0-9]{2})\b/.test(first) ? first : null;
}

/** "Junior liaison officer (fictional)" -> the position and a separate fictional flag, shown as a tag. */
export function splitFictional(position: string): { position: string; fictional: boolean } {
  const match = position.match(/\s*\((?:a\s+)?fictional(?:\s+(?:role|character))?\)\s*$/i);
  return match ? { position: position.slice(0, match.index).trim(), fictional: true } : { position: position.trim(), fictional: false };
}
