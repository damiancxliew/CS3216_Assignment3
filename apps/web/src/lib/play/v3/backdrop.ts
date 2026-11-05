import type { EngineSpec, EngineState } from "@adventure/engine";
import type { CharacterView, PlayerView } from "@adventure/play-contract";

/** The last stage's map, kept on screen behind the epilogue and the Interview. */
export type V3MapBackdrop = {
  stageIndex: number;
  rooms: PlayerView["rooms"];
  currentRoomId: string | null;
  characters: CharacterView[];
};

export function backdropFromView(view: PlayerView): V3MapBackdrop | null {
  if (view.phase !== "stage" || !view.stage || view.stage.intro !== null || view.rooms.length === 0) return null;
  return {
    stageIndex: view.stage.index,
    rooms: view.rooms,
    currentRoomId: view.currentRoomId,
    characters: view.characters,
  };
}

/** `project` sends no rooms after the stages end, so the page rebuilds the last stage's map from the pinned spec. */
export function backdropFromState(spec: EngineSpec, state: EngineState): V3MapBackdrop | null {
  if (state.phase !== "epilogue" && state.phase !== "interview") return null;
  const stage = spec.stages[state.stageIndex];
  if (!stage || stage.rooms.length === 0) return null;
  return {
    stageIndex: state.stageIndex,
    rooms: stage.rooms.map(({ id, name }) => ({ id, name })),
    currentRoomId: state.playerRoomId,
    characters: spec.characters
      .filter((character) => state.playerRoomId !== null && state.characters[character.id]?.roomId === state.playerRoomId)
      .map((character) => {
        const stanceId = state.characters[character.id]?.stanceId ?? null;
        return {
          id: character.id,
          name: character.name,
          title: character.title,
          stanceId,
          portraitKey: stanceId === null ? character.id : `${character.id}:${stanceId}`,
        };
      }),
  };
}
