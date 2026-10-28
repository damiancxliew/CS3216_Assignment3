import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AdventureSpec } from "@adventure/spec-v3";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";
import { publishAdventure, unpublishAdventure } from "@/lib/play/v3/publish";
import { publishSelectedVersion } from "@/lib/v3/versions";
const env = {};
function setup() {
  const store = new MemoryV3PlayStore();
  const spec = AdventureSpec.parse(JSON.parse(readFileSync("fixtures/golden-1819.json", "utf8")));
  store.addAdventure({ id: "a", schoolId: "school", ownerId: "owner", status: "draft", specVersion: 1, publishedVersion: null, spec });
  store.addSchoolAdmin("school", "publisher");
  return { store, deps: { store, env }, spec };
}
describe("publication attribution", () => {
  it("records the authenticated publisher rather than the owner or last editor", async () => {
    const { store, deps } = setup();
    expect((await publishAdventure(deps, "publisher", "a")).status).toBe(200);
    expect(await store.listPublications("a")).toMatchObject([{ version: 1, publishedBy: "publisher" }]);
    // An already-live version is not a new publication by the next caller.
    expect((await publishAdventure(deps, "owner", "a")).status).toBe(200);
    expect((await store.listPublications("a"))[0].publishedBy).toBe("publisher");
  });
  it("attributes selected revisions and republishes independently without attributing failed requests", async () => {
    const { store, deps, spec } = setup();
    await publishAdventure(deps, "owner", "a");
    await store.saveDraft("a", 1, { ...spec, title: "Second draft" });
    expect((await publishSelectedVersion(deps, "publisher", "a", 2, { version: 2, publishedVersion: 1 })).status).toBe(200);
    expect((await publishSelectedVersion(deps, "owner", "a", 1, { version: 1, publishedVersion: 2 })).status).toBe(409);
    expect(await store.listPublications("a")).toMatchObject([{ version: 1, publishedBy: "owner" }, { version: 2, publishedBy: "publisher" }]);
    await unpublishAdventure(deps, "owner", "a");
    await publishSelectedVersion(deps, "publisher", "a", 1, { version: 2, publishedVersion: null });
    expect((await store.listPublications("a"))[0].publishedBy).toBe("publisher");
  });
  it("leaves publishers unknown for legacy operations without an authenticated actor", async () => {
    const { store } = setup();
    await store.publishVersion("a", 1, null, true);
    expect((await store.listPublications("a"))[0].publishedBy).toBeNull();
  });
});
