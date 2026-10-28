import { describe, expect, it } from "vitest";
import type { PlayerView } from "@adventure/play-contract";
import { recentMissionItem } from "@/components/play/v3/mission-focus";

const hint = { id: "hint", kind: "thought", text: "Ask the clerk about the ships.", stageIndex: 0, at: 60_000 };
const note = { id: "note", text: "The ships need permission.", stageIndex: 0, at: 120_000 };
const document = { id: "letter", title: "Harbour letter", body: "The ships arrived today." };
const view = (overrides: Record<string, unknown> = {}) => ({
  stage: { index: 0 }, messages: [], notes: [], documents: [], ...overrides,
}) as unknown as PlayerView;

describe("Mission's shared focus", () => {
  it("restores a saved hint and replaces it with a more recent discovery", () => {
    expect(recentMissionItem(view({ messages: [hint] }))).toMatchObject({ label: "Hint", text: hint.text, tab: "log" });
    expect(recentMissionItem(view({ messages: [hint], notes: [note] }))).toMatchObject({ label: "Latest note", text: note.text, tab: "notes" });
  });

  it("shows a newly collected document instead of an older hint", () => {
    const before = view({ messages: [hint] });
    expect(recentMissionItem(view({ messages: [hint], documents: [document] }), before)).toMatchObject({ label: "Latest document", documentId: "letter" });
  });

  it("lets a new hint replace the document and ignores player messages", () => {
    const before = view({ documents: [document] });
    expect(recentMissionItem(view({ documents: [document], messages: [hint, { ...hint, id: "player", kind: "player" }] }), before)).toMatchObject({ label: "Hint", text: hint.text });
  });

  it("does not surface previous-stage hints or notes, or replay unchanged content", () => {
    expect(recentMissionItem(view({ stage: { index: 1 }, messages: [hint], notes: [note], documents: [document] }))).toBeNull();
    const unchanged = view({ messages: [hint] });
    expect(recentMissionItem(unchanged, unchanged)).toBeNull();
  });

  it("uses timestamps across notes and log entries, even if the arrays arrive out of order", () => {
    expect(recentMissionItem(view({ messages: [{ ...hint, id: "new-hint", at: 180_000 }, hint], notes: [note] })))
      .toMatchObject({ label: "Hint", text: hint.text });
  });
});
