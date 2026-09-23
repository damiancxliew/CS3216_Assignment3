/**
 * The transcript is one scrolling log, but a stage is several conversations:
 * lines said in the smithy, then lines said to someone else in the yard. Breaks
 * are derived from the lines themselves, so the log reads as scenes without the
 * server having to record where a conversation started and stopped.
 */
import type { PublicMessage } from "@/lib/turn-api/contract";

export type TranscriptItem =
  | { kind: "message"; message: PublicMessage }
  | { kind: "break"; id: string; icon: "room" | "person"; label: string };

export interface TranscriptScene {
  /** Where the player stands now, so walking into a room shows up before anyone speaks. */
  currentRoomId: string | null;
  roomName: (roomId: string | null) => string;
  actorName: (actorId: string) => string;
}

/**
 * Who a line was part of a conversation with: the speaker for an agent line,
 * and for the player's own line the agent who answers it (or, failing that, the
 * one they were already speaking to in that room).
 */
function partnerOf(transcript: PublicMessage[], index: number): string | null {
  const line = transcript[index];
  if (line.authorType === "agent") return line.authorId;
  if (line.authorType !== "player") return null;
  for (let ahead = index + 1; ahead < transcript.length; ahead += 1) {
    if (transcript[ahead].roomId !== line.roomId) break;
    if (transcript[ahead].authorType === "agent") return transcript[ahead].authorId;
  }
  for (let back = index - 1; back >= 0; back -= 1) {
    if (transcript[back].roomId !== line.roomId) break;
    if (transcript[back].authorType === "agent") return transcript[back].authorId;
  }
  return null;
}

export function withSceneBreaks(transcript: PublicMessage[], scene: TranscriptScene): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let room: string | null | undefined;
  let partner: string | null = null;

  transcript.forEach((message, index) => {
    const next = partnerOf(transcript, index);
    if (room === undefined || message.roomId !== room) {
      items.push({ kind: "break", id: `room:${message.id}`, icon: "room", label: `You entered ${scene.roomName(message.roomId)}` });
      partner = null;
    } else if (next !== null && partner !== null && next !== partner) {
      items.push({ kind: "break", id: `person:${message.id}`, icon: "person", label: `You turned to ${scene.actorName(next)}` });
    }
    room = message.roomId;
    if (next !== null) partner = next;
    items.push({ kind: "message", message });
  });

  if (room !== undefined && scene.currentRoomId !== room) {
    items.push({
      kind: "break",
      id: `room:current:${scene.currentRoomId ?? "outside"}`,
      icon: "room",
      label: `You entered ${scene.roomName(scene.currentRoomId)}`,
    });
  }

  return items;
}
