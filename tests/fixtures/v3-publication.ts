import type { V3PlayStore } from "@/lib/play/v3/store";

/** Missing publications deliberately yield an unknown ID for closed-link tests. */
export async function publishedVersionId(store: V3PlayStore, adventureId: string, version = 1) {
  return (await store.listPublications(adventureId)).find(row => row.version === version)?.id ?? "unpublished-version";
}
