import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { publishSelectedVersion } from "@/lib/v3/versions";

const env = {};
function setup() {
  const store = new MemoryV3PlayStore();
  const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
  store.addAdventure({ id: "a", schoolId: "school", ownerId: "teacher", status: "published", specVersion: 2, publishedVersion: 2, spec });
  store.addVersionSpec("a", 1, { ...spec, title: "Earlier adventure" });
  return { store, deps: { store, env }, spec };
}
describe("publishing a selected snapshot", () => {
  it("publishes an older snapshot without replacing the editable draft or student attempts", async () => {
    const { store, deps, spec } = setup();
    store.addAttemptWithEvents({ id: "attempt", adventureId: "a", specVersion: 2, studentId: "student", events: [] });
    const result = await publishSelectedVersion(deps, "teacher", "a", 1, { version: 2, publishedVersion: 2 });
    expect(result.status).toBe(200);
    expect(await store.loadAdventure("a")).toMatchObject({ specVersion: 2, publishedVersion: 1, spec });
    expect((await store.listAttempts("a"))[0].specVersion).toBe(2);
  });
  it("checks the chosen snapshot rather than the latest draft", async () => {
    const { store, deps } = setup();
    store.addVersionSpec("a", 1, { title: "Broken snapshot" });
    expect((await publishSelectedVersion(deps, "teacher", "a", 1, { version: 2, publishedVersion: 2 })).status).toBe(409);
    expect((await store.loadAdventure("a"))!.publishedVersion).toBe(2);
  });
  it("rejects unauthorized, missing and stale selections", async () => {
    const { deps } = setup();
    expect((await publishSelectedVersion(deps, "other", "a", 1, { version: 2, publishedVersion: 2 })).status).toBe(404);
    expect((await publishSelectedVersion(deps, "teacher", "a", 99, { version: 2, publishedVersion: 2 })).status).toBe(404);
    expect((await publishSelectedVersion(deps, "teacher", "a", 1, { version: 1, publishedVersion: 2 })).status).toBe(409);
  });
});
