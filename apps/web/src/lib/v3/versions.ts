import { checkSpec, validateSpec } from "@adventure/spec-v3";
import type { V3PublishDeps } from "@/lib/play/v3/publish";
import { canStaffAdventure } from "@/lib/play/v3/access";
import { validateEditedSpec } from "./edit/validation";

export async function publishSelectedVersion(
  deps: V3PublishDeps, userId: string, id: string, selected: number,
  expected: { version: number; publishedVersion: number | null },
) {
  const fail = (status: number, message: string) => ({ status, body: { error: { message } } });
  const adventure = await deps.store.loadAdventure(id);
  if (!adventure || !(await canStaffAdventure(deps.store, adventure, userId, deps.env))) return fail(404, "Not found.");
  if (!Number.isSafeInteger(selected) || selected < 1) return fail(404, "Version not found.");
  if (adventure.specVersion !== expected.version || (adventure.publishedVersion ?? null) !== expected.publishedVersion)
    return fail(409, "This adventure changed. Reload before publishing.");
  if (!["draft", "published", "archived"].includes(adventure.status)) return fail(409, "Finish generating this adventure before publishing.");
  const raw = await deps.store.loadVersionSpec(id, selected);
  if (!raw) return fail(404, "Version not found.");
  const parsed = validateSpec(raw);
  if (!parsed.ok) return fail(409, "This version has errors to fix before publishing.");
  const context = await deps.store.loadVersionContext?.(id, selected);
  const sources = context ? context.sources.map((s) => ({ id: s.id, title: s.title, text: s.pages.map((p) => p.text).join("\n") })) : await deps.sources?.(id) ?? [];
  const errors = await deps.store.loadCheckErrors(id, selected);
  const checks = parsed.spec.authoring ? validateEditedSpec(parsed.spec, sources, errors) : { ...checkSpec(parsed.spec), errors: [...checkSpec(parsed.spec).errors, ...errors] };
  if (checks.errors.length) return fail(409, "This version has errors to fix before publishing. Open the latest draft to make changes.");
  if (!(await deps.store.publishVersion(id, expected.version, expected.publishedVersion, true, selected, userId))) return fail(409, "Publication changed. Reload before publishing.");
  return { status: 200, body: { status: "published", version: selected } };
}
