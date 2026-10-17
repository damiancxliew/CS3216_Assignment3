import { EngineSpec, checkSpec } from "@adventure/engine";

import { v3SchoolAllowed } from "@/lib/v3/flag";

import { canStaffAdventure } from "./access";
import type { ServiceResponse } from "./service";
import type { V3Adventure, V3PlayStore } from "./store";

export interface V3PublishDeps {
  store: V3PlayStore;
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

export async function publishAdventure(
  deps: V3PublishDeps,
  userId: string,
  adventureId: string,
): Promise<ServiceResponse> {
  const adventure = await staffAdventure(deps, userId, adventureId);
  if (!adventure) return error(404, "not_found", "Not found.");
  if (!PUBLISHABLE.has(adventure.status)) {
    return error(409, "not_ready", "Finish generating this adventure before publishing it.");
  }
  const parsed = adventure.spec === null ? null : EngineSpec.safeParse(adventure.spec);
  if (!parsed?.success || checkSpec(parsed.data).errors.length > 0) {
    return error(409, "not_ready", "This adventure's story has errors to fix before it can be published.");
  }
  if (adventure.status !== "published") await deps.store.setAdventureStatus(adventure.id, "published");
  return { status: 200, body: { status: "published" } };
}

export async function unpublishAdventure(
  deps: V3PublishDeps,
  userId: string,
  adventureId: string,
): Promise<ServiceResponse> {
  const adventure = await staffAdventure(deps, userId, adventureId);
  if (!adventure) return error(404, "not_found", "Not found.");
  if (adventure.status === "published") await deps.store.setAdventureStatus(adventure.id, "draft");
  return { status: 200, body: { status: adventure.status === "published" ? "draft" : adventure.status } };
}

export type V3PublishState =
  | { kind: "hidden" }
  | { kind: "unpublished"; status: string }
  | { kind: "published" };

/** What the teacher's publish control should show; staff of the adventure only. */
export async function loadPublishState(
  deps: V3PublishDeps,
  userId: string,
  adventureId: string,
): Promise<V3PublishState> {
  const adventure = await staffAdventure(deps, userId, adventureId);
  if (!adventure) return { kind: "hidden" };
  return adventure.status === "published" ? { kind: "published" } : { kind: "unpublished", status: adventure.status };
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
  adventureId: string,
): Promise<V3JoinView> {
  const adventure = await deps.store.loadAdventure(adventureId);
  if (
    !adventure ||
    adventure.status !== "published" ||
    adventure.spec === null ||
    !v3SchoolAllowed(adventure.schoolId, deps.env)
  ) {
    return { kind: "closed" };
  }
  const title = specTitle(adventure.spec);
  if (!userId) return { kind: "sign_in", title };
  if (!(await deps.store.isActiveMember(adventure.schoolId, userId))) return { kind: "not_member", title };
  return { kind: "ready", title };
}
