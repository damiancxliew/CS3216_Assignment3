import { describe, expect, it } from "vitest";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { loadPublicationHistory } from "@/lib/play/v3/publication-history";

const env = { V3_ENABLED: "true", V3_SCHOOL_IDS: "school" };
function setup() {
  const store = new MemoryV3PlayStore();
  store.addAdventure({
    id: "a",
    schoolId: "school",
    ownerId: "teacher",
    status: "draft",
    specVersion: 1,
    spec: { title: "First release" },
  });
  return store;
}
describe("student link and version history", () => {
  it("includes published versions with zero attempts and version-specific completion", async () => {
    const store = setup();
    await store.publishVersion("a", 1, null, true);
    store.addAttemptWithEvents({
      adventureId: "a",
      specVersion: 1,
      studentId: "A",
      events: [{ type: "phase", from: "interview", to: "reveal" }],
    });
    store.addAttemptWithEvents({
      adventureId: "a",
      specVersion: 1,
      studentId: "B",
      events: [],
    });
    await store.saveDraft("a", 1, { title: "Second release" });
    await store.publishVersion("a", 2, 1, true);
    await store.saveDraft("a", 2, { title: "Unpublished draft" });
    const result = await loadPublicationHistory({ store, env }, "teacher", "a");
    expect(result?.rows).toMatchObject([
      {
        version: 2,
        live: true,
        title: "Second release",
        started: 0,
        completed: 0,
        inProgress: 0,
      },
      { version: 1, live: false, started: 2, completed: 1, inProgress: 1 },
    ]);
    await store.publishVersion("a", 3, 2, false);
    expect(
      (
        await loadPublicationHistory({ store, env }, "teacher", "a")
      )?.rows.every((r) => !r.live),
    ).toBe(true);
  });
  it("restricts history to adventure staff in enabled schools", async () => {
    const store = setup();
    expect(
      await loadPublicationHistory({ store, env }, "outsider", "a"),
    ).toBeNull();
    expect(
      await loadPublicationHistory(
        { store, env: { V3_ENABLED: "false" } },
        "teacher",
        "a",
      ),
    ).toBeNull();
  });
});
