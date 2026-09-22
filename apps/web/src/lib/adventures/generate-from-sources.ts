/**
 * The seam between ingest/generation (D1–D4, Di Heng) and the console's write
 * path (P5, Damian): the adventure's stored sources go through the planner and
 * the resulting spec lands as the next draft version via `persistSpecVersion`.
 *
 * Kept free of Next.js so the DB test can drive it with a `FakeLlmClient`. The
 * server action in `app/teacher/actions.ts` only parses the form, checks
 * ownership and supplies the real OpenAI client.
 */
import {
  contentHash,
  ExtractionError,
  extractPlainText,
  slugify,
  type ExtractedDocument,
  type ExtractedPage,
} from "@adventure/generation/ingest";
import type { LlmClient } from "@adventure/generation/llm";
import {
  generateAdventure,
  type GenerationResult,
  type TeacherInputRaw,
} from "@adventure/generation/planner";
import type { SupabaseClient } from "@supabase/supabase-js";

import { persistSpecVersion, SpecPersistError, type PersistedVersion } from "./persist-spec";

/** A `source` row as the console stores it (`addTextSource`, `addFileSource`). */
export type SourceRow = {
  id: string;
  title: string | null;
  kind: string;
  page_map: unknown;
  content_hash?: string | null;
};

type StoredPageMap = {
  chars?: unknown;
  warnings?: unknown;
  page_texts?: unknown;
  text?: unknown;
};

function storedPages(pageMap: unknown): ExtractedPage[] | undefined {
  if (!pageMap || typeof pageMap !== "object") return undefined;
  const raw = (pageMap as StoredPageMap).page_texts;
  if (!Array.isArray(raw)) return undefined;
  const pages: ExtractedPage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return undefined;
    const { page, text } = entry as { page?: unknown; text?: unknown };
    if (typeof page !== "number" || typeof text !== "string") return undefined;
    pages.push({ page, text });
  }
  return pages.length > 0 ? pages : undefined;
}

/** The brief stored on the adventure row: everything the planner needs besides the title and timer. */
export type GenerationBrief = Pick<
  TeacherInputRaw,
  "setting" | "studentRole" | "learningObjectives" | "readingLevel" | "stageCount" | "stageOutline"
>;

export type GenerateFromSourcesResult =
  | { ok: true; version: PersistedVersion; missingInformation: string[]; warnings: string[] }
  | { ok: false; error: string; result?: GenerationResult };

/**
 * Turns stored source rows into planner documents. Extraction already happened
 * at upload time, so the stored per-page text is reused verbatim — pages are
 * the unit of citation, and re-paginating a PDF here would point every
 * `SourceSpan.page` at the wrong page. A row without usable text is reported
 * rather than silently skipped, so a teacher never generates from fewer
 * sources than they think they have.
 */
export function sourcesToDocuments(rows: readonly SourceRow[]): {
  documents: ExtractedDocument[];
  skipped: string[];
} {
  const documents: ExtractedDocument[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    const title = row.title?.trim() || "Pasted source";
    const pages = storedPages(row.page_map);
    const flat =
      row.page_map && typeof row.page_map === "object"
        ? (row.page_map as StoredPageMap).text
        : undefined;
    if (!pages && (typeof flat !== "string" || flat.trim().length === 0)) {
      skipped.push(`${title} (${row.kind}: no extractable text)`);
      continue;
    }
    let id = slugify(title);
    for (let n = 2; used.has(id); n += 1) id = `${slugify(title)}-${n}`;
    used.add(id);
    if (pages) {
      const text = pages.map((p) => p.text).join("\n");
      documents.push({
        id,
        title,
        kind: row.kind === "pdf" ? "pdf" : "text",
        contentHash: row.content_hash ?? contentHash(pages),
        pageCount: pages.length,
        charCount: text.length,
        pages,
        warnings: [],
      });
      continue;
    }
    try {
      documents.push(
        extractPlainText({ id, title, kind: "text", text: flat as string }),
      );
    } catch (error) {
      if (!(error instanceof ExtractionError)) throw error;
      skipped.push(`${title} (${error.message})`);
    }
  }
  return { documents, skipped };
}

function describeFailure(result: Extract<GenerationResult, { status: "failed" }>): string {
  const detail = result.issues
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join("; ");
  switch (result.reason) {
    case "invalid-teacher-input":
      return `The brief is incomplete${detail ? ` — ${detail}` : ""}`;
    case "refusal":
      return "The model declined to build an adventure from these sources";
    case "llm-error":
      return `The model call failed${detail ? ` — ${detail}` : ""}`;
    case "unparseable":
      return "The model returned something that was not an adventure; try again";
    case "invalid-after-repair":
      return `The generated adventure was still invalid after ${result.metrics.repairs} repair${result.metrics.repairs === 1 ? "" : "s"}${detail ? ` — ${detail}` : ""}`;
  }
}

export async function generateFromSources(options: {
  admin: SupabaseClient;
  adventureId: string;
  adventure: { title: string; default_timer_seconds: number };
  sources: readonly SourceRow[];
  brief: GenerationBrief;
  llm: LlmClient;
  createdBy?: string | null;
}): Promise<GenerateFromSourcesResult> {
  const { documents, skipped } = sourcesToDocuments(options.sources);
  if (documents.length === 0) {
    return {
      ok: false,
      error:
        skipped.length > 0
          ? `None of the sources could be read: ${skipped.join(", ")}`
          : "Add at least one source before generating",
    };
  }

  const result = await generateAdventure({
    teacher: {
      ...options.brief,
      title: options.adventure.title,
      defaultTimerSeconds: options.adventure.default_timer_seconds,
    },
    documents,
    llm: options.llm,
  });
  if (result.status === "failed") return { ok: false, error: describeFailure(result), result };

  try {
    const version = await persistSpecVersion(options.admin, options.adventureId, result.spec, {
      generatorVersion: `planner:${result.metrics.model}@${result.metrics.promptVersion}`,
      createdBy: options.createdBy ?? null,
    });
    return {
      ok: true,
      version,
      missingInformation: result.missingInformation,
      warnings: [...result.warnings, ...skipped.map((s) => `Skipped source ${s}`)],
    };
  } catch (error) {
    if (error instanceof SpecPersistError) return { ok: false, error: error.message, result };
    throw error;
  }
}
