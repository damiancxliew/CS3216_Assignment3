import { ArrowRight, ChevronDown, Compass, DoorOpen, Lock, ScrollText, Search } from "lucide-react";
import type { PlayState } from "@/lib/play/session";
import styles from "./room-panel.module.css";

function closeControls(button: HTMLButtonElement) {
  const detail = button.closest("details");
  if (detail) {
    detail.open = false;
    detail.querySelector("summary")?.focus();
  }
}

/** Secondary room controls stay available without competing with the conversation. */
export function RoomActions({ state, roomId, busy, onRoom, onLandmark, onDocument, onDoor }: {
  state: PlayState;
  /** The room the map shows the player in, which may be a step ahead of the server. */
  roomId: string | null;
  busy: boolean;
  onRoom: (id: string) => void;
  onLandmark: (id: string) => void;
  onDocument: (id: string) => void;
  onDoor: () => void;
}) {
  const here = state.rooms.find((room) => room.id === roomId);
  const landmarks = state.landmarks.filter((landmark) => landmark.roomId === roomId);
  // Documents come from the map's placements so they appear the moment the player walks in;
  // the server's list for its acknowledged room only adds whether one is already within reach.
  const documents = state.props
    .filter((prop) => prop.roomId === roomId && !prop.found)
    .map((prop) => ({ ...prop, canInspect: state.evidenceHere.some((item) => item.id === prop.id && item.canInspect) }));
  return (
    <div className={styles.roomActions} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      const expanded = event.currentTarget.querySelector<HTMLDetailsElement>("details[open]");
      if (expanded) { expanded.open = false; expanded.querySelector("summary")?.focus(); }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        event.currentTarget.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((detail) => { detail.open = false; });
      }
    }}>
      <details className={styles.actionGroup} name="room-actions">
        <summary><Search size={17} aria-hidden /> Look around <ChevronDown size={16} aria-hidden /></summary>
        <div className={styles.actionBody}>
          {documents.length ? <p>Read documents to gather evidence. You’ll walk over before opening them.</p> : null}
          {documents.map((item) => (
            <button key={item.id} type="button" disabled={busy || item.position === null && !item.canInspect} onClick={(event) => { closeControls(event.currentTarget); onDocument(item.id); }}>
              <ScrollText size={18} aria-hidden /><span>Read {item.name}</span><ArrowRight size={16} aria-hidden />
            </button>
          ))}
          {landmarks.length ? <p>Inspect objects for details about this place.</p> : null}
          {landmarks.map((landmark) => (
            <button key={landmark.id} type="button" disabled={busy} onClick={(event) => { closeControls(event.currentTarget); onLandmark(landmark.id); }}>
              <Search size={18} aria-hidden /><span>Inspect {landmark.name}</span><ArrowRight size={16} aria-hidden />
            </button>
          ))}
          {!landmarks.length && !documents.length ? <p>There are no objects or documents to inspect here.</p> : null}
          {here?.enclosure === "enclosed" ? (
            <div className={styles.doorControl}>
              <p>The door is {here.doorOpen ? "open" : "closed"}. A closed door keeps the conversation inside this room.</p>
              <button type="button" disabled={busy} onClick={onDoor}><DoorOpen size={18} aria-hidden /><span>{here.doorOpen ? "Close" : "Open"} this room’s door</span></button>
            </div>
          ) : null}
        </div>
      </details>
      <details className={styles.actionGroup} name="room-actions">
        <summary><Compass size={17} aria-hidden /> Go somewhere <ChevronDown size={16} aria-hidden /></summary>
        <div className={styles.actionBody}>
          <p>Choose a place and your character will walk there.</p>
          {state.rooms.filter((room) => room.id !== roomId).map((room) => (
            <button key={room.id} type="button" disabled={busy} onClick={(event) => { closeControls(event.currentTarget); onRoom(room.id); }}>
              <ArrowRight size={18} aria-hidden /><span>Go to {room.name}{!room.doorOpen ? <small>Door closed · walk over to knock</small> : null}</span>
              {!room.doorOpen ? <Lock size={16} aria-label="Door closed" /> : null}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
