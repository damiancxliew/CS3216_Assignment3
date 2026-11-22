import type { PlayerView } from "@adventure/play-contract";

/** What the player is looking at, so the teacher preview can show the content behind it. */
export type PlayFocus =
  | { kind: "character"; id: string }
  | { kind: "document"; id: string }
  | { kind: "stage"; index: number }
  | { kind: "role" }
  | { kind: "reveal" };

export const playFocusKey = (focus: PlayFocus) =>
  focus.kind === "character" || focus.kind === "document"
    ? `${focus.kind}:${focus.id}`
    : focus.kind === "stage"
      ? `stage:${focus.index}`
      : focus.kind;

/** The focus outside the map, where only the phase says what is on screen. */
export function phaseFocus(view: PlayerView): PlayFocus {
  if (view.phase === "briefing") return { kind: "role" };
  if (view.phase === "stage") return { kind: "stage", index: view.stage?.index ?? 0 };
  return { kind: "reveal" };
}
