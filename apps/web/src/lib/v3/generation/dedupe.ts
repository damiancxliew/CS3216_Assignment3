import type { ExtractedDocument } from "@adventure/generation";

/**
 * sources_v3 is unique on (adventure_id, source_key), and two uploads can produce
 * the same doc id (two pasted bodies, two files named alike). Make ids unique
 * within one upload batch by appending -2, -3, … to repeats, in order.
 */
export function dedupeUploadIds<T extends { doc: ExtractedDocument }>(uploads: T[]): T[] {
  const seen = new Map<string, number>();
  return uploads.map((upload) => {
    const count = (seen.get(upload.doc.id) ?? 0) + 1;
    seen.set(upload.doc.id, count);
    if (count === 1) return upload;
    return { ...upload, doc: { ...upload.doc, id: `${upload.doc.id}-${count}` } };
  });
}
