import { canStaffAdventure } from "./access";
import type { V3PlayStore } from "./store";

export async function loadPublicationHistory(
  deps: { store: V3PlayStore; env?: NodeJS.ProcessEnv },
  userId: string,
  id: string,
) {
  const adventure = await deps.store.loadAdventure(id);
  if (
    !adventure ||
    !(await canStaffAdventure(deps.store, adventure, userId, deps.env))
  )
    return null;
  const [publications, attempts] = await Promise.all([
    deps.store.listPublications(id),
    deps.store.listAttempts(id),
  ]);
  const events = await deps.store.loadEvents(attempts.map((a) => a.id));
  const rows = await Promise.all(
    publications
      .sort((a, b) => b.version - a.version)
      .map(async (publication) => {
        const mine = attempts.filter(
          (a) => a.specVersion === publication.version,
        );
        const completed = mine.filter((a) =>
          (events.get(a.id) ?? []).some(
            (e) => e.type === "phase" && e.to === "reveal",
          ),
        ).length;
        const raw = await deps.store.loadVersionSpec(id, publication.version);
        const title =
          raw &&
          typeof raw === "object" &&
          "title" in raw &&
          typeof raw.title === "string"
            ? raw.title
            : `Version ${publication.version}`;
        return {
          ...publication,
          title,
          live:
            adventure.status === "published" &&
            adventure.publishedVersion === publication.version,
          started: mine.length,
          completed,
          inProgress: mine.length - completed,
        };
      }),
  );
  return { adventure, rows };
}
