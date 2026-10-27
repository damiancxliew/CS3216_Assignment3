import { AdventureSpec, type AdventureSpec as Spec } from "@adventure/spec-v3";
import { z } from "zod";
import { portraitKeys, preserveLegacyStageImages, resolvePortraitImage } from "./media/resolvers";

export const MAX_SPEC_BYTES = 10 * 1024 * 1024;
const Source = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  kind: z.enum(["pdf", "text"]),
  origin: z.enum(["teacher", "outside"]).optional(),
  url: z.url().regex(/^https?:\/\//).optional(),
  pages: z.array(z.strictObject({ page: z.number().int().positive(), text: z.string() })),
}).refine((source) => source.origin !== "outside" || !!source.url, "Outside sources require a URL.");
export type TransferSource = z.infer<typeof Source>;
const Bundle = z.strictObject({
  format: z.literal("pocket-adventure-v3"),
  version: z.literal(1),
  spec: AdventureSpec,
  sources: z.array(Source),
});
export type SpecBundle = z.infer<typeof Bundle>;

export function parseSpecImport(text: string): SpecBundle {
  if (new TextEncoder().encode(text).length > MAX_SPEC_BYTES) throw Error("Choose a JSON file smaller than 10 MB.");
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw Error("That file is not valid JSON."); }
  const wrapped = raw !== null && typeof raw === "object" && "format" in raw;
  const parsed = Bundle.safeParse(wrapped ? raw : { format: "pocket-adventure-v3", version: 1, spec: raw, sources: [] });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Error(`Invalid v3 adventure JSON: ${issue.path.join(".") || "file"}: ${issue.message}`);
  }
  const ids = parsed.data.sources.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw Error("Duplicate source ids in JSON.");
  return parsed.data;
}

/** Pin generated art to its original URLs before giving the adventure a new id. */
export function specExport(spec: Spec, sources: TransferSource[], id: string, version: number): SpecBundle {
  const copy = preserveLegacyStageImages(spec, id, version);
  const portraits = ((copy.authoring ??= {}).portraitImages ??= {});
  for (const key of portraitKeys(spec)) {
    if (portraits[key]) continue;
    const image = resolvePortraitImage(spec, id, version, key);
    portraits[key] = image.version === null ? { type: "fallback" } : { type: "legacy", url: image.url, version: image.version };
  }
  return Bundle.parse({ format: "pocket-adventure-v3", version: 1, spec: copy, sources: sources.map(({ id, title, kind, pages, origin, url }) => ({ id, title, kind, pages, ...(origin ? { origin } : {}), ...(url ? { url } : {}) })) });
}
