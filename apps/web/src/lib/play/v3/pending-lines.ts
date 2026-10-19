import type { Action, PlayerView } from "@adventure/play-contract";

const PENDING_PREFIX = "pending-";

/** Shows the student's own line straight away; the server's view replaces it when the reply lands. */
export function withPendingPlayerLine(view: PlayerView, action: Action, id: string, at: number): PlayerView {
  if (action.type !== "message" && action.type !== "insertNote") return view;
  return {
    ...view,
    messages: [
      ...view.messages,
      {
        id: `${PENDING_PREFIX}${id}`,
        kind: "player",
        text: action.text ?? "",
        roomId: view.currentRoomId,
        characterId: action.characterId,
        insertedNoteId: action.type === "insertNote" ? action.noteId : null,
        at,
      },
    ],
  };
}

export function withoutPendingLines(view: PlayerView): PlayerView {
  const messages = view.messages.filter((message) => !message.id.startsWith(PENDING_PREFIX));
  return messages.length === view.messages.length ? view : { ...view, messages };
}
