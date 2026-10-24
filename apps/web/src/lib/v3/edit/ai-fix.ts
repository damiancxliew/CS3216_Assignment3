import type { MediaEditContext } from "../media/resolvers";
import { z } from "zod";
import { validateSkeleton, type AdventureSpec, type CheckIssue, type SkeletonShape } from "@adventure/spec-v3";
import { DETAILS_MODEL } from "@adventure/generation/v3";
import type { LlmClient } from "@adventure/generation/llm";
import { V3Edit, atPath, type CapturedSource } from "./commands";
import { applyTeacherEdits } from "./apply";
import { checkTeacherEdits } from "./validation";
import { applySkeletonEdits, skeletonChanges } from "./skeleton";
export { skeletonChanges } from "./skeleton";

export interface AiFixDeps { llm: LlmClient }
type Failure = { ok: false; code: "no-errors" | "no-fix"; message: string; errors: CheckIssue[] };
export type AiFixResult = { ok: true; edits: V3Edit[]; notes: string } | Failure;
const failure = (errors: CheckIssue[], noErrors = false): Failure => ({ ok: false, code: noErrors ? "no-errors" : "no-fix", message: noErrors ? "These edits add no errors." : "Couldn't fix these edits. Check the errors and try again.", errors });
const invalid = (error: unknown): CheckIssue[] => [{ code: "invalid-edit", path: "", message: error instanceof Error ? error.message : "Invalid editing commands." }];

const wireEdit = z.strictObject({
  type: z.enum(["set", "insert", "remove", "move", "convertDocument"]),
  path: z.array(z.string()), value_json: z.string().nullable(), index: z.number().int().nullable(),
  from: z.number().int().nullable(), to: z.number().int().nullable(), documentId: z.string().nullable(),
});
const proposalSchema = z.strictObject({ notes: z.string(), edits: z.array(wireEdit).max(2000) });
export function encodeEdit(edit: V3Edit) {
  return { type: edit.type, path: "path" in edit ? edit.path.map(String) : [],
    value_json: "value" in edit ? JSON.stringify(edit.value) : null,
    index: "index" in edit ? edit.index : null, from: "from" in edit ? edit.from : null,
    to: "to" in edit ? edit.to : null, documentId: "documentId" in edit ? edit.documentId : null,
    // Evidence operations are provided as data; the model schema cannot invent them.
    ...(edit.type === "replaceExcerpt" ? { sourceId: edit.sourceId, start: edit.start, end: edit.end } : {}) };
}
function decodeEdit(edit: z.infer<typeof wireEdit>): V3Edit {
  const { type, path, value_json, ...fields } = edit;
  return V3Edit.parse({ type,
    ...(type === "convertDocument" ? {} : { path: path.map(key => /^\d+$/.test(key) ? Number(key) : key) }),
    ...(type === "set" || type === "insert" ? { value: JSON.parse(value_json ?? "") } : {}),
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)),
  });
}
const SYSTEM = `You help a teacher fix their own edits to a generated history {subject} for secondary-school students.
The teacher changed it with editing commands, and some of the changes broke its checks. Return a revised list of commands that fixes every listed error while keeping what the teacher meant.

Rules:
- Start from the teacher's commands. Keep every command that has nothing to do with an error exactly as it is.
- Change as little as possible. Prefer adjusting the teacher's own command to adding new ones. Drop a command only when no version of it can pass the checks, and say so in notes.
- Never change ids, citations, sourceLabel, real, sources or authoring.
- Never make up quotations or facts about real people or events. Only invented documents and invented characters' own words may be new.
- Paths address the JSON: object keys, and list positions written as digit strings. Commands run in order, each on the result of the ones before it, exactly as the teacher's do.
- value_json is the new value as a JSON string for set and insert, and null otherwise. index is for insert; from and to are for move; documentId is for convertDocument. Unused fields are null.
- notes: one or two plain sentences for the teacher saying what you changed and why.

Return JSON only, matching the schema.`;

function entity(path: string[]): string { return path.slice(0, /^\d+$/.test(path[1] ?? "") ? 2 : 1).join("."); }
function editPath(edit: V3Edit, base: unknown): string[] {
  if ("path" in edit) return edit.path.map(String);
  if ("documentId" in edit) return ["documents", String((base as AdventureSpec).documents?.findIndex(d => d.id === edit.documentId) ?? -1)];
  return ["authoring", "sourcePolicy"];
}
function safeAt(base: unknown, path: string[]) { try { return atPath(base, path) ?? null; } catch { return null; } }
function userMessage(base: unknown, after: unknown, edits: V3Edit[], errors: CheckIssue[]): string {
  const prefixes = [...new Set([...edits.map(edit => entity(editPath(edit, base))), ...errors.map(error => entity(error.path.split(".")))])];
  const slices = prefixes.map(path => ({ path, before: safeAt(base, path.split(".")), after: safeAt(after, path.split(".")) }));
  const render = (parts: unknown) => `<errors>\n${JSON.stringify(errors, null, 2)}\n</errors>\n\n<teacher_commands>\n${JSON.stringify(edits.map(encodeEdit), null, 2)}\n</teacher_commands>\n\n<affected_parts>\n${JSON.stringify(parts, null, 2)}\n</affected_parts>`;
  const message = render(slices);
  return message.length > 60_000 ? render(slices.map(({ path, after }) => ({ path, after }))) : message;
}

async function fix(deps: AiFixDeps, subject: string, user: string, initial: CheckIssue[], validate: (edits: V3Edit[]) => Promise<CheckIssue[]>): Promise<AiFixResult> {
  let remaining = initial;
  let retry = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let encoded: unknown = null;
    try {
      const response = await deps.llm.completeJson({ model: DETAILS_MODEL, system: SYSTEM.replace("{subject}", subject), user: user + retry, schemaName: "edit_fix", jsonSchema: z.toJSONSchema(proposalSchema, { target: "draft-2020-12" }), reasoningEffort: "low", maxOutputTokens: 8000 });
      if (response.refusal) throw Error("The model could not propose a fix.");
      const proposal = proposalSchema.parse(response.json);
      encoded = proposal.edits;
      const edits = proposal.edits.map(decodeEdit);
      remaining = await validate(edits);
      if (!remaining.length) return { ok: true, edits, notes: proposal.notes };
    } catch (error) { remaining = invalid(error); }
    retry = `\n\n<previous_attempt>\n${JSON.stringify(encoded, null, 2)}\n</previous_attempt>\n\n<still_failing>\n${JSON.stringify(remaining, null, 2)}\n</still_failing>`;
  }
  return failure(remaining);
}

export async function proposeEditFix(deps: AiFixDeps, input: { base: AdventureSpec; edits: V3Edit[]; sources: CapturedSource[]; savedErrors?: CheckIssue[]; media?: MediaEditContext }): Promise<AiFixResult> {
  const parsed = z.array(V3Edit).max(2000).safeParse(input.edits);
  if (!parsed.success) return failure(invalid(parsed.error));
  input = { ...input, edits: parsed.data };
  const check = checkTeacherEdits(input.base, input.edits, input.sources, input.savedErrors, input.media);
  if (check.ok) return failure([], true);
  let after: unknown = null;
  try { after = applyTeacherEdits(input.base, input.edits, input.sources, input.media); } catch { /* malformed commands remain visible in the prompt */ }
  const preserveEvidence = (proposal: V3Edit[]) => {
    const edits = [...proposal];
    input.edits.forEach((edit, index) => {
      if (edit.type === "replaceExcerpt" || edit.type === "sourcePolicy" || edit.type === "stageImage" || edit.type === "portraitImage" || edit.type === "walkingSprite") edits.splice(Math.min(index, edits.length), 0, edit);
    });
    return edits;
  };
  const result = await fix(deps, "adventure", userMessage(input.base, after, input.edits.filter(edit => !["stageImage", "portraitImage", "walkingSprite"].includes(edit.type)), check.errors), check.errors, async edits => {
    const checked = checkTeacherEdits(input.base, preserveEvidence(edits), input.sources, input.savedErrors, input.media);
    return checked.ok ? [] : checked.errors;
  });
  // The strict model schema cannot author excerpt selections or source policies.
  // These teacher-selected operations survive unchanged and are revalidated too.
  return result.ok ? { ...result, edits: preserveEvidence(result.edits) } : result;
}

export async function proposeSkeletonFix(deps: AiFixDeps, input: { base: SkeletonShape; edited: unknown; issues(raw: unknown): Promise<CheckIssue[]> }): Promise<{ ok: true; skeleton: SkeletonShape; notes: string } | Failure> {
  const errors = await input.issues(input.edited);
  if (!errors.length) return failure([], true);
  let edits: V3Edit[];
  try { edits = skeletonChanges(input.base, input.edited); } catch (error) { return failure(invalid(error)); }
  const result = await fix(deps, "adventure plan (the skeleton)", userMessage(input.base, input.edited, edits, errors), errors, async proposal => {
    try { return await input.issues(applySkeletonEdits(input.base, proposal)); } catch (error) { return invalid(error); }
  });
  if (!result.ok) return result;
  const parsed = validateSkeleton(applySkeletonEdits(input.base, result.edits));
  return parsed.ok ? { ok: true, skeleton: parsed.spec, notes: result.notes } : failure(parsed.issues.map(issue => ({ ...issue, code: "schema" })));
}

/** Offline fixer: undo commands on entities with errors, keeping unrelated commands. */
export function fakeEditFixer(): LlmClient {
  return { async completeJson(request) {
    const block = (tag: string) => JSON.parse(request.user.split(`<${tag}>\n`)[1].split(`\n</${tag}>`)[0]);
    const errors = block("errors") as CheckIssue[];
    const commands = block("teacher_commands") as ReturnType<typeof encodeEdit>[];
    const slices = block("affected_parts") as { path: string; before?: { id?: string }; after?: { id?: string } }[];
    const bad = new Set(errors.map(error => entity(error.path.split("."))));
    const badDocuments = new Set(slices.filter(slice => slice.path.startsWith("documents.") && bad.has(slice.path)).flatMap(slice => [slice.before?.id, slice.after?.id]));
    const edits = commands.filter(command => command.type !== "replaceExcerpt" && command.type !== "sourcePolicy" && !bad.has(entity(command.path)) && !(command.documentId && badDocuments.has(command.documentId)));
    const json = { edits, notes: "I undid the changes that caused the errors." };
    return { json, text: JSON.stringify(json), refusal: null, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, model: request.model, latencyMs: 0 };
  } };
}
