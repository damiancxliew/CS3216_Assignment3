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
  it("uses the active draft's portrait before landmarks, regardless of row order", () => {
    expect(selectLibraryArtwork(adventure, versions, [asset("other", "portrait"), asset("published", "portrait"), asset("draft", "landmark", "cached"), asset("draft", "portrait")]))
      .toEqual({ cover: { url: "/draft-portrait.png", kind: "portrait" }, portraits: [] });
  });
  it("falls back to landmark art when the draft has no portrait", () => {
    expect(selectLibraryArtwork(adventure, versions, [asset("draft", "landmark")]))
      .toEqual({ cover: { url: "/draft-landmark.png", kind: "landmark" }, portraits: [] });
  });
  it("falls back to prop art when the draft has only props", () => {
    expect(selectLibraryArtwork(adventure, versions, [asset("draft", "prop")]))
      .toEqual({ cover: { url: "/draft-prop.png", kind: "prop" }, portraits: [] });
  });
  it("does not show stale published artwork while an unillustrated draft is active", () => {
    expect(selectLibraryArtwork(adventure, versions, [asset("published", "landmark"), asset("draft", "landmark", "pending"), asset("draft", "portrait", "failed")]))
      .toEqual({ cover: null, portraits: [] });
  });
  it("uses the pinned published version when there is no draft", () => {
    expect(selectLibraryArtwork(adventure, versions.filter((v) => v.id !== "draft"), [asset("published", "portrait", "cached"), asset("other", "landmark")]).cover)
      .toEqual({ url: "/published-portrait.png", kind: "portrait" });
  });
  it("returns an empty projection when there is no version or usable artwork", () => {
    expect(selectLibraryArtwork(adventure, [], [asset("other", "landmark")])).toEqual({ cover: null, portraits: [] });
  });
});
