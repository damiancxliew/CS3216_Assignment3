import { describe, expect, it } from "vitest";
import {
  approvedHttps,
  parseCommonsImages,
  parseLocImage,
} from "@/lib/v3/media/providers";
function commons(
  license = "CC BY-SA 4.0",
  url = "https://creativecommons.org/licenses/by-sa/4.0/",
) {
  return {
    query: {
      pages: [
        {
          pageid: 42,
          title: "File:Harbour.jpg",
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/harbour.jpg",
              descriptionurl:
                "https://commons.wikimedia.org/wiki/File:Harbour.jpg",
              width: 1024,
              height: 768,
              mime: "image/jpeg",
              extmetadata: {
                CommonsMetadataExtension: { value: 1 },
                LicenseShortName: { value: license },
                LicenseUrl: { value: url },
                Artist: {
                  value:
                    '<a href="bad">Photographer</a><script>alert(1)</script>',
                },
                ImageDescription: { value: "<b>Harbour</b>" },
              },
            },
          ],
        },
      ],
    },
  };
}
describe("provider metadata validation", () => {
  it("sanitizes HTML credits and only accepts supported explicit licences", () => {
    expect(parseCommonsImages(commons())[0]).toMatchObject({
      itemId: "42",
      credit: "Photographer",
      title: "Harbour",
      licence: { label: "CC BY-SA 4.0" },
    });
    expect(parseCommonsImages(commons("All rights reserved", ""))).toEqual([]);
    expect(
      parseCommonsImages(
        commons(
          "CC BY-SA",
          "https://creativecommons.org.example.com/licenses/by-sa/4.0/",
        ),
      ),
    ).toEqual([]);
    expect(
      parseCommonsImages(
        commons(
          "CC BY-NC 4.0",
          "https://creativecommons.org/licenses/by-nc/4.0/",
        ),
      ),
    ).toEqual([]);
  });
  it("rejects unapproved provider image hosts and malformed responses", () => {
    const raw = commons();
    raw.query.pages[0].imageinfo[0].url = "https://evil.example/image.jpg";
    expect(parseCommonsImages(raw)).toEqual([]);
    expect(() => parseCommonsImages({ query: { pages: "bad" } })).toThrow();
    expect(() =>
      approvedHttps("http://un.org/image", ["un.org"], true),
    ).toThrow();
  });
  it("does not infer LOC reuse from ambiguous rights", () => {
    const item = {
      id: "https://www.loc.gov/item/123/",
      title: "Harbour",
      image_url: ["https://tile.loc.gov/thumb.jpg"],
      rights_advisory: ["No known restrictions on publication."],
    };
    const resources = [
      {
        files: [
          [
            {
              url: "https://tile.loc.gov/image.jpg",
              mimetype: "image/jpeg",
              width: 1024,
              height: 800,
            },
          ],
        ],
      },
    ];
    expect(parseLocImage({ item, resources })).toBeNull();
    expect(
      parseLocImage({
        item: {
          ...item,
          rights_advisory: ["This image is in the public domain."],
        },
        resources,
      }),
    ).toMatchObject({ licence: { label: "Public domain" } });
  });
});
