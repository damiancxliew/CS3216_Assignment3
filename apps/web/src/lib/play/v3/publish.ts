import { validateEditedSpec } from "@/lib/v3/edit/validation";
import type { CapturedSource } from "@/lib/v3/edit/commands";
import { EngineSpec, checkSpec } from "@adventure/engine";

import { v3SchoolAllowed } from "@/lib/v3/flag";

import { canStaffAdventure } from "./access";
import type { ServiceResponse } from "./service";
import type { V3Adventure, V3PlayStore } from "./store";

export interface V3PublishDeps {
  store: V3PlayStore;
  sources?: (id: string) => Promise<CapturedSource[]>;
  env?: NodeJS.ProcessEnv;
}

const PUBLISHABLE = new Set(["draft", "published", "archived"]);

function error(status: number, code: string, message: string): ServiceResponse {
  return { status, body: { error: { code, message } } };
}

function specTitle(spec: unknown): string | null {
  return spec && typeof spec === "object" && "title" in spec && typeof spec.title === "string" ? spec.title : null;
}

async function staffAdventure(deps: V3PublishDeps, userId: string, adventureId: string): Promise<V3Adventure | null> {
  const adventure = await deps.store.loadAdventure(adventureId);
  if (!adventure || !(await canStaffAdventure(deps.store, adventure, userId, deps.env))) return null;
  return adventure;
}

export async function publishBlockReason(deps: V3PublishDeps, adventure: V3Adventure): Promise<string | undefined> {
  if (!PUBLISHABLE.has(adventure.status)) return "Finish generating this adventure before publishing it.";
  const parsed = adventure.spec === null ? null : EngineSpec.safeParse(adventure.spec);
  const saved = await deps.store.loadCheckErrors(adventure.id);
  const issues = parsed?.success && parsed.data.authoring
    ? validateEditedSpec(parsed.data, await deps.sources?.(adventure.id) ?? [], saved).errors
    : [...(parsed?.success ? checkSpec(parsed.data).errors : [{ code: "schema" }]), ...saved];
  if (!parsed?.success || issues.length > 0) {
    return "This adventure's story has errors to fix before it can be published.";
  }
}

export async function publishAdventure(
  deps: V3PublishDeps,
  userId: string,
  adventureId: string,
  expected?: { version: number; publishedVersion: number | null },
): Promise<ServiceResponse> {
  const adventure = await staffAdventure(deps, userId, adventureId);
  if (!adventure) return error(404, "not_found", "Not found.");
  const reason = await publishBlockReason(deps, adventure);
  if (reason) return error(409, "not_ready", reason);
  if (!(await deps.store.publishVersion(adventure.id, expected?.version ?? adventure.specVersion, expected ? expected.publishedVersion : adventure.publishedVersion ?? null, true, undefined, userId))) return error(409, "conflict", "This adventure changed. Reload before publishing.");
  return { status: 200, body: { status: "published" } };
}

export async function unpublishAdventure(
  deps: V3PublishDeps,
  userId: string,
  adventureId: string,
  expected?: { version: number; publishedVersion: number | null },
): Promise<ServiceResponse> {
  const adventure = await staffAdventure(deps, userId, adventureId);
  if (!adventure) return error(404, "not_found", "Not found.");
  if (!(await deps.store.publishVersion(adventure.id, expected?.version ?? adventure.specVersion, expected ? expected.publishedVersion : adventure.publishedVersion ?? null, false))) return error(409, "conflict", "Publication changed. Reload before unpublishing.");
  return { status: 200, body: { status: adventure.status === "published" ? "draft" : adventure.status } };
}

export type V3PublishState =
  | { kind: "hidden" }
  | { kind: "unpublished"; status: string; blockedReason?: string; version?: number; publishedVersion?: number | null }
  | { kind: "published"; version?: number; publishedVersion?: number | null; unpublishedChanges?: boolean; blockedReason?: string };

/** What the teacher's publish control should show; staff of the adventure only. */
export async function loadPublishState(
  deps: V3PublishDeps,
  userId: string,
  adventureId: string,
): Promise<V3PublishState> {
  const adventure = await staffAdventure(deps, userId, adventureId);
  if (!adventure) return { kind: "hidden" };
  if (adventure.status === "published") return { kind: "published", version: adventure.specVersion, publishedVersion: adventure.publishedVersion ?? null, ...(adventure.publishedVersion !== adventure.specVersion ? { unpublishedChanges: true, blockedReason: await publishBlockReason(deps, adventure) } : {}) };
  const blockedReason = await publishBlockReason(deps, adventure);
  return { kind: "unpublished", version: adventure.specVersion, publishedVersion: adventure.publishedVersion ?? null, status: adventure.status, ...(blockedReason ? { blockedReason } : {}) };
}

export type V3JoinView =
  | { kind: "closed" }
  | { kind: "sign_in"; title: string | null }
  | { kind: "not_member"; title: string | null }
  | { kind: "ready"; title: string | null };

/**
 * The student link. Anything that isn't a published adventure in a v3 school looks the same from
 * outside: closed. The title only shows once the link is actually open.
 */
export async function loadJoinView(
  deps: V3PublishDeps,
  userId: string | null,
  versionId: string,
): Promise<V3JoinView> {
  const publication = await deps.store.loadPublication(versionId);
  if (!publication) return { kind: "closed" };
  const adventure = await deps.store.loadAdventure(publication.adventureId);
  if (
    !adventure ||
    adventure.status !== "published" ||
    adventure.spec === null ||
    !v3SchoolAllowed(adventure.schoolId, deps.env)
  ) {
    return { kind: "closed" };
  }
  const published = await deps.store.loadVersionSpec(adventure.id, publication.version);
  if (!published) return { kind: "closed" };
  const title = specTitle(published);
  if (!userId) return { kind: "sign_in", title };
  if (!(await deps.store.isActiveMember(adventure.schoolId, userId))) return { kind: "not_member", title };
  return { kind: "ready", title };
}
