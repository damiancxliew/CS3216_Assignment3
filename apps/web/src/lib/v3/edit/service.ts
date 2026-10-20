import { z } from "zod";
import {
  validateSpec,
  type AdventureSpec,
  type CheckIssue,
} from "@adventure/spec-v3";
import { canStaffAdventure } from "@/lib/play/v3/access";
import type { V3PlayStore } from "@/lib/play/v3/store";
import { stancePortraitRequests } from "@/lib/v3/portraits/generate";
import { V3Edit, type CapturedSource } from "./commands";
import { applyTeacherEdits } from "./apply";
import { introducedErrors, validateEditedSpec } from "./validation";

export type SaveV3Result =
  | {
      ok: true;
      version: number;
      spec: AdventureSpec;
      errors: CheckIssue[];
      warnings: CheckIssue[];
    }
  | {
      ok: false;
      code: "conflict" | "access" | "invalid-edit";
      message: string;
    }
  | { ok: false; code: "check-errors"; message: string; errors: CheckIssue[] };
export interface V3EditDeps {
  store: V3PlayStore;
  sources(id: string): Promise<CapturedSource[]>;
  queueStageArt(adventureId: string, version: number): Promise<void>;
  validationContext?: (
    id: string,
  ) => Promise<
    | NonNullable<NonNullable<AdventureSpec["authoring"]>["validationContext"]>
    | undefined
  >;
  env?: NodeJS.ProcessEnv;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export { applyTeacherEdits, deriveAttribution } from "./apply";

export async function saveAdventureEdits(
  deps: V3EditDeps,
  userId: string,
  id: string,
  expectedVersion: number,
  rawEdits: unknown,
): Promise<SaveV3Result> {
  const adventure = await deps.store.loadAdventure(id);
  if (
    !adventure ||
    !(await canStaffAdventure(deps.store, adventure, userId, deps.env)) ||
    !["draft", "published", "archived"].includes(adventure.status)
  )
    return { ok: false, code: "access", message: "Not found." };
  if (adventure.specVersion !== expectedVersion)
    return {
      ok: false,
      code: "conflict",
      message:
        "This adventure changed. Your local edits are still here. Reload to use the saved version.",
    };
  const commands = z.array(V3Edit).max(2000).safeParse(rawEdits);
  const parsed = validateSpec(adventure.spec);
  if (!commands.success || !parsed.ok)
    return {
      ok: false,
      code: "invalid-edit",
      message: "Invalid editing commands or stored adventure.",
    };
  const sources = await deps.sources(id);
  let spec: AdventureSpec;
  try {
    spec = applyTeacherEdits(parsed.spec, commands.data, sources);
    if (!same(spec, parsed.spec)) {
      if (!spec.authoring?.validationContext && deps.validationContext) {
        const context = await deps.validationContext(id);
        if (context) (spec.authoring ??= {}).validationContext = context;
      }
      const oldPortraits = new Map(
        stancePortraitRequests(parsed.spec).map((p) => [
          p.portraitKey,
          p.prompt,
        ]),
      );
      const versions = Object.fromEntries(
        stancePortraitRequests(spec).map((p) => [
          p.portraitKey,
          oldPortraits.get(p.portraitKey) === p.prompt
            ? parsed.spec.authoring?.portraitVersions
              ? (parsed.spec.authoring.portraitVersions[p.portraitKey] ?? null)
              : adventure.specVersion
            : null,
        ]),
      );
      (spec.authoring ??= {}).portraitVersions = versions;
    }
  } catch (error) {
    return {
      ok: false,
      code: "invalid-edit",
      message:
        error instanceof z.ZodError
          ? "The edits must have a valid structure. Check the highlighted fields."
          : error instanceof Error
            ? error.message
            : "Invalid edit.",
    };
  }
  const generationErrors = await deps.store.loadCheckErrors(id);
  const added = introducedErrors(parsed.spec, spec, sources, generationErrors);
  if (added.length) return { ok: false, code: "check-errors", message: "These edits add errors, so they weren't saved. Fix them or use Resolve issues.", errors: added };
  const checks = validateEditedSpec(spec, sources, generationErrors);
  // An empty/no-op Save must not create metadata or a snapshot.
  if (!same(spec, parsed.spec))
    (spec.authoring ??= {}).retainedErrors = checks.errors;
  const saved = await deps.store.saveDraft(id, expectedVersion, spec);
  if (!saved.saved)
    return {
      ok: false,
      code: "conflict",
      message:
        "This adventure changed while saving. Your local edits are still here. Reload to use the saved version.",
    };
  const version = saved.version!;
  if (version !== expectedVersion) {
    try {
      await deps.queueStageArt(id, version);
    } catch (error) {
      console.error("Failed to queue v3 stage art", error);
    }
  }
  return { ok: true, spec, version, ...checks };
}
