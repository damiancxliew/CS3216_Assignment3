import { EngineSpec, summarise } from "@adventure/engine";
import type { ClassSummary } from "@adventure/play-contract";

import { canStaffAdventure } from "./access";
import type { V3PlayStore } from "./store";

export interface V3SummaryDeps {
  store: V3PlayStore;
  env?: NodeJS.ProcessEnv;
}

export type ClassSummaryResult =
  | { status: 404 }
  | { status: 409; code: "not_published"; title: string | null }
  | {
      status: 200;
      title: string;
      adventureId: string;
      version: number;
      versions: { version: number; attempts: number }[];
      summary: ClassSummary;
      flagged: { attemptId: string; count: number; student: string }[];
    };

export async function loadClassSummary(
  deps: V3SummaryDeps,
  userId: string,
  adventureId: string,
  requestedVersion?: number,
): Promise<ClassSummaryResult> {
  const adventure = await deps.store.loadAdventure(adventureId);
  if (
    !adventure ||
    !(await canStaffAdventure(deps.store, adventure, userId, deps.env))
  ) {
    return { status: 404 };
  }

  if (adventure.specVersion < 1) {
    const currentTitle =
      adventure.spec &&
      typeof adventure.spec === "object" &&
      "title" in adventure.spec &&
      typeof adventure.spec.title === "string"
        ? adventure.spec.title
        : null;
    return { status: 409, code: "not_published", title: currentTitle };
  }

  const attempts = await deps.store.listAttempts(adventureId);
  const counts = new Map<number, number>();
  for (const attempt of attempts) {
    counts.set(attempt.specVersion, (counts.get(attempt.specVersion) ?? 0) + 1);
  }
  for (const publication of await deps.store.listPublications(adventureId)) {
    if (!counts.has(publication.version)) counts.set(publication.version, 0);
  }
  if (
    adventure.publishedVersion != null &&
    adventure.publishedVersion > 0 &&
    !counts.has(adventure.publishedVersion)
  )
    counts.set(adventure.publishedVersion, 0);
  if (requestedVersion !== undefined && Number.isSafeInteger(requestedVersion) && requestedVersion > 0 && !counts.has(requestedVersion)
    && await deps.store.loadVersionSpec(adventureId, requestedVersion)) counts.set(requestedVersion, 0);
  if (!counts.size) {
    const parsed = EngineSpec.safeParse(adventure.spec);
    return {
      status: 409,
      code: "not_published",
      title: parsed.success ? parsed.data.title : null,
    };
  }

  const versions = [...counts.entries()]
    .map(([version, attemptCount]) => ({ version, attempts: attemptCount }))
    .sort((a, b) => b.version - a.version);
  const selectedVersion = versions.some(
    ({ version }) => version === requestedVersion,
  )
    ? requestedVersion!
    : adventure.publishedVersion != null &&
        counts.has(adventure.publishedVersion)
      ? adventure.publishedVersion
      : versions[0].version;
  const versionAttempts = attempts.filter(
    (attempt) => attempt.specVersion === selectedVersion,
  );
  const storedSpec = await deps.store.loadVersionSpec(
    adventureId,
    selectedVersion,
  );
  const parsedSpec = EngineSpec.safeParse(storedSpec);
  if (!parsedSpec.success) {
    console.error("Unable to load a valid v3 class summary spec.", {
      adventureId,
      version: selectedVersion,
      reason: storedSpec === null ? "missing" : "invalid",
    });
    return { status: 404 };
  }

  const events = await deps.store.loadEvents(
    versionAttempts.map(({ id }) => id),
  );
  const summary = summarise(
    parsedSpec.data,
    versionAttempts.map(({ id }) => ({
      attemptId: id,
      events: events.get(id) ?? [],
    })),
  );
  const attemptsById = new Map(
    versionAttempts.map((attempt) => [attempt.id, attempt]),
  );
  const flagged = await Promise.all(
    summary.flags.map(async ({ attemptId, count }) => {
      const studentId = attemptsById.get(attemptId)!.studentId;
      const email = await deps.store.studentEmail(studentId);
      return {
        attemptId,
        count,
        student: email ?? `Student ${studentId.slice(0, 8)}`,
      };
    }),
  );

  return {
    status: 200,
    title: parsedSpec.data.title,
    adventureId,
    version: selectedVersion,
    versions,
    summary,
    flagged,
  };
}
