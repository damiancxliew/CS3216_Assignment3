import { describe, expect, it } from "vitest";
import { selectLibraryArtwork, type LibraryAsset, type LibraryVersion } from "@/lib/teacher/library";

const adventure = { id: "story", published_version: 1 };
const versions: LibraryVersion[] = [
  { id: "published", adventure_id: "story", version: 1, published_at: "2026-09-01" },
  { id: "draft", adventure_id: "story", version: 2, published_at: null },
  { id: "other", adventure_id: "someone-else", version: 3, published_at: null },
];
const asset = (version: string, kind: string, status = "ready"): LibraryAsset => ({ spec_version_id: version, asset_id: `${version}-${kind}`, kind, status, url: `/${version}-${kind}.png` });

describe("adventure library artwork", () => {
  it("uses the active draft's landmark before portraits, regardless of row order", () => {
    expect(selectLibraryArtwork(adventure, versions, [asset("other", "landmark"), asset("published", "landmark"), asset("draft", "portrait"), asset("draft", "landmark", "cached")]))
      .toEqual({ cover: "/draft-landmark.png", portraits: ["/draft-portrait.png"] });
  });
  it("does not show stale published artwork while an unillustrated draft is active", () => {
    expect(selectLibraryArtwork(adventure, versions, [asset("published", "landmark"), asset("draft", "landmark", "pending"), asset("draft", "portrait", "failed")]))
      .toEqual({ cover: null, portraits: [] });
  });
  it("uses the pinned published version when there is no draft", () => {
    expect(selectLibraryArtwork(adventure, versions.filter((v) => v.id !== "draft"), [asset("published", "portrait", "cached"), asset("other", "landmark")]).cover).toBe("/published-portrait.png");
  });
  it("returns an empty projection when there is no version or usable artwork", () => {
    expect(selectLibraryArtwork(adventure, [], [asset("other", "landmark")])).toEqual({ cover: null, portraits: [] });
  });
});
