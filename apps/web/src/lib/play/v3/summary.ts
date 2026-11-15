import { EngineSpec, summarise } from "@adventure/engine";
import { compareSeverity, flagSeverity, type ClassSummary, type FlagSeverity } from "@adventure/play-contract";

import { canStaffAdventure } from "./access";
import type { V3PlayStore, V3StoredFlag } from "./store";

export type { FlagSeverity } from "@adventure/play-contract";

export interface FlaggedMessage {
  messageId: string;
  category: string;
  severity: FlagSeverity;
  excerpt: string;
  characterName: string | null;
  stageIndex: number | null;
  source: "chat" | "interview";
  createdAt: string;
}

export interface FlaggedStudent {
  attemptId: string;
  count: number;
  student: string;
  severity: FlagSeverity;
  messages: FlaggedMessage[];
}

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
      flagged: FlaggedStudent[];
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
    !(await canStaffAdventure(deps.store, adventure, userId))
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
  const flaggedAttemptIds = summary.flags.map(({ attemptId }) => attemptId);
  const storedFlags = flaggedAttemptIds.length
    ? await deps.store.listFlags(flaggedAttemptIds)
    : [];
  const flagsByAttempt = new Map<string, V3StoredFlag[]>();
  for (const flag of storedFlags) {
    const attemptFlags = flagsByAttempt.get(flag.attemptId) ?? [];
    attemptFlags.push(flag);
    flagsByAttempt.set(flag.attemptId, attemptFlags);
  }
  const characterNames = new Map(
    parsedSpec.data.characters.map((character) => [character.id, character.name]),
  );
  const flagged = await Promise.all(
    summary.flags.map(async ({ attemptId, count }) => {
      const studentId = attemptsById.get(attemptId)!.studentId;
      const email = await deps.store.studentEmail(studentId);
      const severity = (events.get(attemptId) ?? [])
        .filter((event) => event.type === "flag")
        .map((event) => flagSeverity(event.category))
        .reduce<FlagSeverity>(
          (highest, current) =>
            compareSeverity(current, highest) < 0 ? current : highest,
          "review",
        );
      const messages = (flagsByAttempt.get(attemptId) ?? [])
        .map((flag) => ({
          messageId: flag.messageId,
          category: flag.category,
          severity: flagSeverity(flag.category),
          excerpt: flag.excerpt,
          characterName: flag.characterId
            ? characterNames.get(flag.characterId) ?? null
            : null,
          stageIndex: flag.stageIndex,
          source: flag.source,
          createdAt: flag.createdAt,
        }))
        .sort(
          (a, b) =>
            compareSeverity(a.severity, b.severity) ||
            a.createdAt.localeCompare(b.createdAt),
        );
      return {
        attemptId,
        count,
        student: email ?? `Student ${studentId.slice(0, 8)}`,
        severity,
        messages,
      };
    }),
  );
  flagged.sort(
    (a, b) =>
      compareSeverity(a.severity, b.severity) ||
      b.count - a.count ||
      a.student.localeCompare(b.student),
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
