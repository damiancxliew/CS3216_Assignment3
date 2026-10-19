import type { RoleBriefingView, StageView } from "@adventure/play-contract";

export interface V3CinematicBeat {
  id: string;
  kicker: string;
  title?: string;
  body?: string;
  items?: string[];
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
  };
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
    nonEmpty({ id: "fears", kicker: "Your fears", items: briefing.privateBrief.fears }),
    nonEmpty({ id: "knows", kicker: "What you already know", items: briefing.privateBrief.knows }),
    nonEmpty({ id: "relationships", kicker: "People you know", items: briefing.relationships }),
  ].filter((beat): beat is V3CinematicBeat => beat !== null);
}

export function stageIntroBeats(stage: StageView): V3CinematicBeat[] {
  const prediction = stage.intro?.predictionReveal;
  return [
    nonEmpty({
      id: "place",
      kicker: `Stage ${stage.index + 1} of ${stage.count}`,
      title: stage.title,
      body: stage.timePlace,
    }),
    prediction
      ? nonEmpty({
          id: "what-happened",
          kicker: "What happened",
          body: prediction.actual,
          ...(prediction.because.trim() ? { items: [prediction.because] } : {}),
        })
      : null,
    stage.intro
      ? nonEmpty({ id: "narration", kicker: "Meanwhile", body: stage.intro.narration })
      : null,
    nonEmpty({ id: "question", kicker: "The question", body: stage.centralQuestion }),
  ].filter((beat): beat is V3CinematicBeat => beat !== null);
}
