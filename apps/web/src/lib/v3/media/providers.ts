/** Server-owned resource registry. Factual discovery remains OpenAI + pinned extraction. */
import { z } from "zod";
import { fetchSourceBytes, htmlToText } from "@adventure/generation";
export const RESOURCE_PROVIDERS = {
  commons: {
    id: "commons",
    label: "Wikimedia Commons",
    capabilities: ["imageSearch", "imageMetadata"],
    recordHosts: ["commons.wikimedia.org"],
    imageHosts: ["upload.wikimedia.org"],
    reuse: "explicit-pd-cc0-cc-by-cc-by-sa",
  },
  loc: {
    id: "loc",
    label: "Library of Congress",
    capabilities: ["imageSearch", "imageMetadata"],
    recordHosts: ["loc.gov", "www.loc.gov"],
    imageHosts: ["tile.loc.gov", "cdn.loc.gov", "www.loc.gov", "loc.gov"],
    reuse: "explicit-pd-cc0-cc-by-cc-by-sa",
    searchCollections: ["detroit-publishing-company", "national-photo-company"],
  },
  un: {
    id: "un",
    label: "United Nations",
    capabilities: ["information", "externalImage"],
    recordHosts: ["un.org"],
    imageHosts: ["un.org"],
    reuse: "private-teacher-confirmation",
  },
  bundled: {
    id: "bundled",
    label: "Ninja Adventure",
    capabilities: ["walkingSpriteCatalog"],
    recordHosts: [],
    imageHosts: [],
    reuse: "CC0",
  },
} as const;
export type ImageProvider = "commons" | "loc";
export type ProviderImage = {
  provider: ImageProvider;
  itemId: string;
  title: string;
  imageUrl: string;
  thumbnail: string;
  width?: number;
  height?: number;
  date?: string;
  credit: string;
  recordUrl: string;
  licence: { label: string; url?: string };
};
export function approvedHttps(
  value: string,
  hosts: readonly string[],
  subdomains = false,
): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !hosts.some(
      (host) =>
        parsed.hostname === host ||
        (subdomains && parsed.hostname.endsWith(`.${host}`)),
    )
  )
    throw Error("Use an HTTPS URL on an approved provider host.");
  return parsed.href;
}
const clean = (text: string) => htmlToText(text).text.slice(0, 2000);
const textList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) =>
    Array.isArray(value) ? value.join(" ") : (value ?? ""),
  );
const ccLicence = (
  label: string,
  rawUrl: string,
): ProviderImage["licence"] | null => {
  try {
    const url = new URL(rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl);
    if (
      url.hostname !== "creativecommons.org" ||
      !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
    )
      return null;
    const path = url.pathname.replace(/\/$/, "");
    if (
      !/^\/(?:licenses\/(?:by|by-sa)\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/(?:zero|mark)\/1\.0)$/.test(
        path,
      )
    )
      return null;
    url.protocol = "https:";
    return { label: clean(label), url: url.href };
  } catch {
    return null;
  }
};
const infoSchema = z.object({
  url: z.string(),
  descriptionurl: z.string(),
  thumburl: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  mime: z.string(),
  extmetadata: z.record(z.string(), z.object({ value: z.union([z.string(), z.number(), z.boolean()]) })),
});
const commonsPage = z.object({
  pageid: z.number().int(),
  title: z.string(),
  imageinfo: z.array(infoSchema),
});
const commonsResponse = z.object({
  query: z.object({ pages: z.array(commonsPage) }).optional(),
  continue: z.object({ gsroffset: z.number().int().optional() }).optional(),
});
export function parseCommonsImages(raw: unknown): ProviderImage[] {
  const parsed = commonsResponse.parse(raw);
  return (parsed.query?.pages ?? []).flatMap((page) => {
    const info = page.imageinfo[0];
    if (
      !info ||
      !["image/jpeg", "image/png", "image/webp"].includes(info.mime) ||
      info.width * info.height > 40_000_000
    )
      return [];
    const meta = (key: string) => {
      const value = info.extmetadata[key]?.value;
      return typeof value === "string" ? clean(value) : "";
    };
    if (meta("Restrictions")) return [];
    const label = meta("LicenseShortName"),
      licence =
        ccLicence(label, meta("LicenseUrl")) ??
        (/^(public domain|pd)$/i.test(label) && meta("Copyrighted") === "False"
          ? { label: "Public domain" }
          : null);
    if (!licence) return [];
    try {
      return [
        {
          provider: "commons" as const,
          itemId: String(page.pageid),
          title:
            meta("ImageDescription") || clean(page.title.replace(/^File:/, "")),
          imageUrl: approvedHttps(
            info.url,
            RESOURCE_PROVIDERS.commons.imageHosts,
          ),
          thumbnail: approvedHttps(
            info.thumburl ?? info.url,
            RESOURCE_PROVIDERS.commons.imageHosts,
          ),
          width: info.width,
          height: info.height,
          date: meta("DateTimeOriginal"),
          credit: meta("Attribution") || meta("Artist") || "Wikimedia Commons",
          recordUrl: approvedHttps(
            info.descriptionurl,
            RESOURCE_PROVIDERS.commons.recordHosts,
          ),
          licence,
        },
      ];
    } catch {
      return [];
    }
  });
}
async function json(url: string, provider: ImageProvider) {
  const result = await fetchSourceBytes(url, {
    policy: { extraDomains: [...RESOURCE_PROVIDERS[provider].recordHosts] },
    allowedHosts: RESOURCE_PROVIDERS[provider].recordHosts,
    headers: { accept: "application/json", "user-agent": "PocketAdventure/1.0 (https://github.com/damiancxliew/CS3216_Assignment3)" },
    contentTypes: ["application/json"],
    maxBytes: 2 * 1024 * 1024,
  });
  return JSON.parse(new TextDecoder().decode(result.bytes)) as unknown;
}
function commonsUrl(params: Record<string, string>): string {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "600",
    ...params,
  }).toString();
  return url.href;
}
const locItem = z.object({
  id: z.string(),
  title: z.string(),
  image_url: z.array(z.string()).optional(),
  date: z.string().optional(),
  rights_advisory: textList,
  rights: textList,
  credit_line: textList,
  contributor: textList,
});
export function parseLocImage(raw: unknown): ProviderImage | null {
  const envelope = z
    .object({
      item: locItem,
      resources: z
        .array(
          z.object({
            files: z
              .array(
                z.array(
                  z.object({
                    url: z.string(),
                    mimetype: z.string().optional(),
                    width: z.number().optional(),
                    height: z.number().optional(),
                  }),
                ),
              )
              .optional(),
          }),
        )
        .optional(),
    })
    .parse(raw);
  const item = envelope.item;
  const rights = clean(`${item.rights_advisory} ${item.rights}`);
  // Ambiguous rights such as "no known restrictions" are deliberately ineligible.
  if (
    !/\bpublic domain\b/i.test(rights) ||
    /\b(not|may|might|unknown|uncertain)\b/i.test(rights)
  )
    return null;
  const files =
    envelope.resources
      ?.flatMap((r) => r.files?.flat() ?? [])
      .filter(
        (f) =>
          ["image/jpeg", "image/png", "image/webp"].includes(
            f.mimetype ?? "",
          ) &&
          (!f.width || !f.height || f.width * f.height <= 40_000_000),
      )
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0)) ?? [];
  const image = files[0];
  if (!image || !item.image_url?.length) return null;
  try {
    const recordUrl = approvedHttps(
      item.id,
      RESOURCE_PROVIDERS.loc.recordHosts,
    );
    return {
      provider: "loc",
      itemId: recordUrl,
      title: clean(item.title),
      imageUrl: approvedHttps(image.url, RESOURCE_PROVIDERS.loc.imageHosts),
      thumbnail: approvedHttps(
        item.image_url[0]!,
        RESOURCE_PROVIDERS.loc.imageHosts,
      ),
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
      ...(item.date ? { date: clean(item.date) } : {}),
      credit:
        clean(item.credit_line || item.contributor) || "Library of Congress",
      recordUrl,
      licence: { label: "Public domain" },
    };
  } catch {
    return null;
  }
}
export async function providerMetadata(
  provider: ImageProvider,
  id: string,
): Promise<ProviderImage> {
  if (provider === "commons") {
    if (!/^\d+$/.test(id)) throw Error("Invalid Commons item.");
    const item = parseCommonsImages(
      await json(commonsUrl({ pageids: id }), "commons"),
    )[0];
    if (!item)
      throw Error("This image has no supported reuse licence or image format.");
    return item;
  }
  const url = new URL(approvedHttps(id, RESOURCE_PROVIDERS.loc.recordHosts));
  if (!/^\/(?:pictures\/)?item\/[^/]+\/$/.test(url.pathname))
    throw Error("Invalid LOC item.");
  url.search = "fo=json";
  const item = parseLocImage(await json(url.href, "loc"));
  if (!item)
    throw Error("This item does not explicitly permit supported reuse.");
  return item;
}
export async function searchProvider(
  provider: ImageProvider,
  query: string,
  page = 1,
): Promise<{ items: ProviderImage[]; nextPage: number | null }> {
  if (provider === "commons") {
    const raw = await json(
      commonsUrl({
        generator: "search",
        gsrsearch: query,
        gsrnamespace: "6",
        gsrlimit: "6",
        gsroffset: String((page - 1) * 6),
      }),
      provider,
    );
    const parsed = commonsResponse.parse(raw);
    return {
      items: parseCommonsImages(raw),
      nextPage: parsed.continue?.gsroffset !== undefined ? page + 1 : null,
    };
  }
  const collections = RESOURCE_PROVIDERS.loc.searchCollections;
  const collection = collections[(page - 1) % collections.length]!;
  const url = new URL(`https://www.loc.gov/collections/${collection}/`);
  url.search = new URLSearchParams({
    fo: "json",
    q: query,
    c: "6",
    sp: String(Math.floor((page - 1) / collections.length) + 1),
  }).toString();
  const result = z
    .object({
      results: z.array(z.object({ id: z.string() })),
      pagination: z
        .object({ next: z.string().nullable().optional() })
        .optional(),
    })
    .parse(await json(url.href, provider));
  const settled = await Promise.allSettled(
    result.results.slice(0, 6).map((item) => providerMetadata("loc", item.id)),
  );
  return {
    items: settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    nextPage: result.pagination?.next ? page + 1 : null,
  };
}
