/**
 * The opening of a stage, told as cinematic beats before the player takes control.
 *
 * Only public stage framing belongs here: the setting, the shared context, the
 * player's own brief, the goals and the dilemma. Private agent context, hidden
 * evidence and unrevealed decisions stay on the server.
 */
import type { PlayState } from "@/lib/play/session";

export interface CutsceneBeat {
  id: string;
  kicker: string;
  title?: string;
  body?: string;
  items?: string[];
}

/** A backdrop for the cinematic, when the stage has generated art to show. */
export function cutsceneBackdrop(state: PlayState): string | null {
  return state.landmarks.find((landmark) => landmark.imageUrl)?.imageUrl ?? null;
}

export function cutsceneBeats(state: PlayState): CutsceneBeat[] {
  const { stage, player } = state;
  const goals = stage.objectives.filter((objective) => !objective.met).map((objective) => objective.title);
  const beats: CutsceneBeat[] = [
    {
      id: "place",
      kicker: `Stage ${stage.index + 1} of ${state.stageCount}`,
      title: stage.title,
      ...(stage.setting ? { body: stage.setting } : {}),
    },
    { id: "situation", kicker: "The situation", body: stage.sharedContext },
    { id: "role", kicker: `You are ${player.name}`, title: player.role, body: player.brief },
  ];
  if (goals.length > 0) beats.push({ id: "goals", kicker: "Before you decide", items: goals });
  beats.push({ id: "decision", kicker: "The decision ahead", body: state.decisionPrompt });
  return beats;
}
