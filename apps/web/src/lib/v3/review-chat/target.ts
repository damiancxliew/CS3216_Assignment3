import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateSkeleton,
  validateSpec,
  type CheckIssue,
} from "@adventure/spec-v3";
import { supabaseJobStore } from "@adventure/jobs";
import { v3SchoolAllowed } from "../flag";
import type { V3BriefRow } from "../brief/store";
import { defaultGenerationDeps } from "../generation/deps";
import {
  loadPause,
  requirePause,
  skeletonIssues,
  pausedPass,
} from "../generation/service";
import { applyTeacherEdits, capturedSources } from "../edit/apply";
import { applySkeletonEdits } from "../edit/skeleton";
import { checkTeacherEdits } from "../edit/validation";
import type { V3Edit } from "../edit/commands";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import type { ReviewChatInput, ReviewChatProposal } from "./types";

type SetEdit = Extract<V3Edit, { type: "set" }>;
type Target = {
  ok: true;
  current: unknown;
  roots: string[];
  validate(changes: SetEdit[]): Promise<CheckIssue[]>;
  proposal(changes: SetEdit[]): ReviewChatProposal;
  stillCurrent(): Promise<boolean>;
};
const failure = (message: string) => ({ ok: false as const, message });
const issue = (message: string): CheckIssue[] => [
  { code: "invalid-edit", path: "", message },
];

/** Load the authoritative review base and validate proposed replacements against it. */
export async function loadReviewChatTarget(
  admin: SupabaseClient,
  row: V3BriefRow,
  userId: string,
  input: ReviewChatInput,
): Promise<Target | { ok: false; message: string }> {
  const adventureId = row.id;
  const deps = defaultGenerationDeps();
  const steps = supabaseJobStore(admin);
  let current: unknown;
  let roots: string[];
  let validate: (changes: SetEdit[]) => Promise<CheckIssue[]>;
  let proposal: (changes: SetEdit[]) => ReviewChatProposal;
  let stillCurrent: () => Promise<boolean>;

  if (input.pass === "draft") {
    const store = new SupabaseV3PlayStore(admin);
    const adventure = await store.loadAdventure(adventureId);
    if (
      !["draft", "published", "archived"].includes(row.status) ||
      !adventure ||
      adventure.status !== row.status ||
      adventure.specVersion !== input.version
    )
      return failure(
        "The draft changed. Reload before requesting another suggestion.",
      );
    const base = validateSpec(adventure.spec);
    if (!base.ok) return failure("The saved draft could not be read.");
    const sources = capturedSources(await deps.sources.load(adventureId));
    try {
      current = applyTeacherEdits(base.spec, input.edits, sources);
    } catch {
      return failure("Check the current edits before requesting a suggestion.");
    }
    roots = [
      "title",
      "stages",
      "characters",
      "documents",
      "discoveries",
      "definingMoments",
      "endings",
      "reveal",
      "teacherQuestions",
    ];
    const savedErrors = await store.loadCheckErrors(adventureId);
    validate = async (changes) => {
      const result = checkTeacherEdits(
        base.spec,
        [...input.edits, ...changes],
        sources,
        savedErrors,
      );
      return result.ok ? [] : result.errors;
    };
    proposal = (changes) => ({
      pass: "draft",
      edits: [...input.edits, ...changes],
    });
    stillCurrent = async () => {
      const latest = await store.loadAdventure(adventureId);
      return latest?.status === row.status && latest.specVersion === input.version;
    };
  } else {
    const paused = async () => {
      if (input.pass !== "skeleton")
        return requirePause(
          deps,
          steps,
          userId,
          adventureId,
          input.pass,
          process.env,
        );
      const candidate = await deps.adventures.get(adventureId);
      return candidate?.ownerId === userId &&
        v3SchoolAllowed(candidate.schoolId) &&
        candidate.status === "needs_review" &&
        pausedPass(await steps.list(adventureId)) === "skeleton"
        ? candidate
        : null;
    };
    const adventure = await paused();
    const pause = adventure
      ? input.pass === "skeleton"
        ? { pass: "skeleton" as const, index: 2 as const }
        : await loadPause(deps, steps, adventure)
      : null;
    if (!adventure || !pause || pause.pass !== input.pass)
      return failure(
        "Wait for the current step to finish before sending this request.",
      );
    stillCurrent = async () => Boolean(await paused());
    if (input.pass === "sources" && pause.pass === "sources") {
      if (
        input.removedSourceIds.some(
          (id) => !pause.outside.some((source) => source.id === id),
        )
      )
        return failure("A source selection is no longer available.");
      const sources = [
        ...pause.uploads.map((source) => ({
          ...source,
          uploaded: true,
          included: true,
        })),
        ...pause.outside.map((source) => ({
          ...source,
          uploaded: false,
          included: !input.removedSourceIds.includes(source.id),
        })),
      ];
      current = { sources };
      roots = ["sources"];
      const selected = (changes: SetEdit[]) =>
        sources.map((source, index) => ({
          ...source,
          included:
            changes.findLast((change) => change.path[1] === index)?.value ??
            source.included,
        }));
      validate = async (changes) => {
        const next = selected(changes);
        return next.some((source) => source.uploaded && !source.included)
          ? issue("Uploads must stay included.")
          : next.some((source) => source.included)
            ? []
            : issue("Keep at least one source.");
      };
      proposal = (changes) => ({
        pass: "sources",
        removedSourceIds: selected(changes)
          .filter((source) => !source.uploaded && !source.included)
          .map((source) => source.id),
      });
    } else if (input.pass === "skeleton" && pause.pass === "skeleton") {
      const output = (await steps.outputs(adventureId, ["skeleton"]))
        .skeleton as { skeleton?: unknown } | undefined;
      const base = validateSkeleton(output?.skeleton);
      const edited = validateSkeleton(input.skeleton);
      if (!base.ok || !edited.ok)
        return failure("Check the outline before requesting a suggestion.");
      current = edited.spec;
      roots = Object.keys(edited.spec);
      const baseline = new Set(
        (await skeletonIssues(deps, adventureId, base.spec)).map(
          (error) => `${error.code}|${error.path}|${error.message}`,
        ),
      );
      validate = async (changes) =>
        (
          await skeletonIssues(
            deps,
            adventureId,
            applySkeletonEdits(edited.spec, changes),
          )
        ).filter(
          (error) =>
            !baseline.has(`${error.code}|${error.path}|${error.message}`),
        );
      proposal = (changes) => {
        const candidate = validateSkeleton(
          applySkeletonEdits(edited.spec, changes),
        );
        if (!candidate.ok) throw Error("Invalid outline suggestion");
        return { pass: "skeleton", skeleton: candidate.spec };
      };
    } else if ("edits" in input && "base" in pause) {
      const sources = capturedSources(await deps.sources.load(adventureId));
      try {
        current = applyTeacherEdits(pause.base, input.edits, sources);
      } catch {
        return failure(
          "Check the current edits before requesting a suggestion.",
        );
      }
      roots =
        input.pass === "details"
          ? ["stages", "characters", "documents", "discoveries"]
          : input.pass === "endings"
            ? ["definingMoments", "endings"]
            : ["reveal", "teacherQuestions"];
      validate = async (changes) => {
        const result = checkTeacherEdits(
          pause.base,
          [...input.edits, ...changes],
          sources,
        );
        return result.ok ? [] : result.errors;
      };
      const pass = pause.pass;
      proposal = (changes) => ({ pass, edits: [...input.edits, ...changes] });
    } else return failure("This step is not ready for suggestions.");
  }
  return { ok: true, current, roots, validate, proposal, stillCurrent };
}
