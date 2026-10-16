/**
 * Pure, client-safe helpers for the skeleton editor: id generation, item add
 * and remove (with owned children), the dependents a removal leaves dangling,
 * and prefix matching against `checkSkeleton`'s dot-paths. No React, no Next.
 */
import type { CheckIssue, SkeletonShape } from "@adventure/spec-v3";

/** Refs identify an editable item: "kind:id" (or "kind:parentId/id" for nested items). */
export type Ref =
  | `character:${string}`
  | `document:${string}`
  | `discovery:${string}`
  | `ending:${string}`
  | `source:${string}`
  | `stage:${string}`
  | `room:${string}/${string}`
  | `moment:${string}`
  | `act:${string}/${string}`
  | `outcome:${string}/${string}`
  | `rule:${string}/${string}`;

export type AddKind = "character" | "stage" | "room" | "discovery" | "document" | "act" | "outcome" | "rule" | "ending";

const random = () => Math.random().toString(16).slice(2, 6);

/** A short readable id unique within the skeleton, e.g. "char-4f2a". */
export function newId(prefix: string, existingIds: Set<string>): string {
  for (let tries = 0; tries < 100; tries += 1) {
    const id = `${prefix}-${random()}`;
    if (!existingIds.has(id)) return id;
  }
  return `${prefix}-${random()}${random()}`;
}

/** Every id the skeleton defines (rooms are per-stage, so they are not included). */
export function allIds(skeleton: SkeletonShape): Set<string> {
  const ids = new Set<string>();
  for (const source of skeleton.sources) ids.add(source.id);
  for (const stage of skeleton.stages) {
    ids.add(stage.id);
    for (const room of stage.rooms) ids.add(`${stage.id}/${room.id}`);
  }
  for (const character of skeleton.characters) ids.add(character.id);
  for (const discovery of skeleton.discoveries) ids.add(discovery.id);
  for (const document of skeleton.documents) ids.add(document.id);
  for (const moment of skeleton.definingMoments) {
    ids.add(moment.id);
    for (const act of moment.acts) ids.add(act.id);
    for (const outcome of moment.outcomes) ids.add(outcome.id);
  }
  for (const ending of skeleton.endings) ids.add(ending.id);
  return ids;
}

/** Adds a structurally valid default item; returns a new skeleton. */
export function addItem(skeleton: SkeletonShape, kind: AddKind, parentRef?: Ref): SkeletonShape {
  const next: SkeletonShape = structuredClone(skeleton);
  const ids = allIds(next);
  switch (kind) {
    case "character":
      next.characters.push({ id: newId("char", ids), name: "", title: "", real: true, tier: "major", persona: { publicPosition: "", privateAgenda: "" } });
      return next;
    case "document":
      next.documents.push({ id: newId("doc", ids), kind: "other", title: "", real: true });
      return next;
    case "ending":
      next.endings.push({ id: newId("ending", ids), type: "alternative", title: "", summary: "", sourceLabel: "" });
      return next;
    case "stage": {
      const room = { id: newId("room", ids), name: "", description: "" };
      const act = { id: newId("act", ids), text: "" };
      const outcome = { id: newId("outcome", ids), summary: "", closesEndingIds: [] as string[] };
      const stageId = newId("stage", ids);
      const moment = { id: newId("moment", ids), stageId, deciderId: next.characters[0]?.id ?? "unassigned", scene: "", acts: [act], outcomes: [outcome], rules: [{ actId: act.id, outcomeId: outcome.id }] };
      next.stages.push({ id: stageId, title: "", timePlace: "", centralQuestion: "", rooms: [room], startRoomId: room.id, placement: {}, definingMomentId: moment.id });
      next.definingMoments.push(moment);
      return next;
    }
    case "room": {
      const stage = stageOf(next, parentRef);
      stage?.rooms.push({ id: newId("room", ids), name: "", description: "" });
      return next;
    }
    case "discovery": {
      const stageId = parentRef?.startsWith("stage:") ? parentRef.slice(6) : (next.stages[0]?.id ?? "");
      next.discoveries.push({
        id: newId("discovery", ids),
        stageId,
        holder: { characterId: next.characters[0]?.id ?? "" },
        text: "",
        note: "",
        core: true,
        sourceLabel: "",
      });
      return next;
    }
    case "act": {
      const moment = momentOf(next, parentRef);
      moment?.acts.push({ id: newId("act", ids), text: "" });
      return next;
    }
    case "outcome": {
      const moment = momentOf(next, parentRef);
      moment?.outcomes.push({ id: newId("outcome", ids), summary: "", closesEndingIds: [] });
      return next;
    }
    case "rule": {
      const moment = momentOf(next, parentRef);
      moment?.rules.push({ actId: moment.acts[0]?.id ?? "", outcomeId: moment.outcomes[0]?.id ?? "" });
      return next;
    }
  }
}

export type Dependent = { ref: Ref; label: string };

const holderLabel = (d: SkeletonShape["discoveries"][number]) => `Discovery "${d.id}"`;

/**
 * The items that reference `ref` — surfaced in the remove popup so the teacher
 * knows what will dangle. `ref` is the thing being removed.
 */
export function dependentsOf(skeleton: SkeletonShape, ref: Ref): Dependent[] {
  const dependents: Dependent[] = [];
  const [kind, rest] = ref.split(/:(.*)/s) as [string, string];

  if (kind === "character") {
    for (const discovery of skeleton.discoveries)
      if ("characterId" in discovery.holder && discovery.holder.characterId === rest)
        dependents.push({ ref: `discovery:${discovery.id}`, label: `${holderLabel(discovery)} (held by this character)` });
    for (const stage of skeleton.stages) {
      if (stage.placement[rest] !== undefined) dependents.push({ ref: `stage:${stage.id}`, label: `Stage "${stage.id}" (placed in it)` });
    }
    for (const moment of skeleton.definingMoments)
      if (moment.deciderId === rest) dependents.push({ ref: `moment:${moment.id}`, label: `Defining moment "${moment.id}" (decider)` });
  } else if (kind === "document") {
    for (const discovery of skeleton.discoveries)
      if ("documentId" in discovery.holder && discovery.holder.documentId === rest)
        dependents.push({ ref: `discovery:${discovery.id}`, label: `${holderLabel(discovery)} (held by this document)` });
  } else if (kind === "stage") {
    for (const discovery of skeleton.discoveries)
      if (discovery.stageId === rest) dependents.push({ ref: `discovery:${discovery.id}`, label: `${holderLabel(discovery)} (its stage)` });
  } else if (kind === "room") {
    const [stageId, roomId] = rest.split("/") as [string, string];
    const stage = skeleton.stages.find((s) => s.id === stageId);
    if (stage) {
      if (stage.startRoomId === roomId) dependents.push({ ref: `stage:${stage.id}`, label: `Stage "${stage.id}" (start room)` });
      for (const [characterId, placed] of Object.entries(stage.placement))
        if (placed === roomId) dependents.push({ ref: `stage:${stage.id}`, label: `Stage "${stage.id}" (placement of "${characterId}")` });
    }
  } else if (kind === "moment") {
    for (const stage of skeleton.stages)
      if (stage.definingMomentId === rest) dependents.push({ ref: `stage:${stage.id}`, label: `Stage "${stage.id}" (its defining moment)` });
  } else if (kind === "ending") {
    for (const moment of skeleton.definingMoments)
      for (const outcome of moment.outcomes) {
        if (outcome.endingId === rest) dependents.push({ ref: `outcome:${moment.id}/${outcome.id}`, label: `Outcome "${outcome.id}" (its ending)` });
        if (outcome.closesEndingIds.includes(rest)) dependents.push({ ref: `outcome:${moment.id}/${outcome.id}`, label: `Outcome "${outcome.id}" (closes this ending)` });
      }
  } else if (kind === "discovery") {
    // nothing references a discovery
  } else if (kind === "act" || kind === "outcome" || kind === "rule") {
    // acts/outcomes are owned by their moment — removal deletes the rules too,
    // so there is nothing dangling to list.
  }
  return dependents;
}

/** Removes an item plus the children it owns; other references stay dangling for the checks to flag. */
export function removeItem(skeleton: SkeletonShape, ref: Ref): SkeletonShape {
  const next: SkeletonShape = structuredClone(skeleton);
  const [kind, rest] = ref.split(/:(.*)/s) as [string, string];
  switch (kind) {
    case "character":
      next.characters = next.characters.filter((c) => c.id !== rest);
      return next;
    case "document":
      next.documents = next.documents.filter((d) => d.id !== rest);
      return next;
    case "discovery":
      next.discoveries = next.discoveries.filter((d) => d.id !== rest);
      return next;
    case "ending":
      next.endings = next.endings.filter((e) => e.id !== rest);
      return next;
    case "stage": {
      const stage = next.stages.find((s) => s.id === rest);
      next.stages = next.stages.filter((s) => s.id !== rest);
      if (stage) next.definingMoments = next.definingMoments.filter((m) => m.id !== stage.definingMomentId);
      return next;
    }
    case "room": {
      const [stageId, roomId] = rest.split("/") as [string, string];
      const stage = next.stages.find((s) => s.id === stageId);
      if (stage) stage.rooms = stage.rooms.filter((r) => r.id !== roomId);
      return next;
    }
    case "moment":
      next.definingMoments = next.definingMoments.filter((m) => m.id !== rest);
      return next;
    case "act": {
      const [momentId, actId] = rest.split("/") as [string, string];
      const moment = next.definingMoments.find((m) => m.id === momentId);
      if (moment) {
        moment.acts = moment.acts.filter((a) => a.id !== actId);
        moment.rules = moment.rules.filter((r) => r.actId !== actId);
      }
      return next;
    }
    case "outcome": {
      const [momentId, outcomeId] = rest.split("/") as [string, string];
      const moment = next.definingMoments.find((m) => m.id === momentId);
      if (moment) {
        moment.outcomes = moment.outcomes.filter((o) => o.id !== outcomeId);
        moment.rules = moment.rules.filter((r) => r.outcomeId !== outcomeId);
      }
      return next;
    }
    case "rule": {
      const [momentId, restIds] = rest.split("/") as [string, string];
      const [actId, outcomeId] = restIds.split("/") as [string, string];
      const moment = next.definingMoments.find((m) => m.id === momentId);
      if (moment) moment.rules = moment.rules.filter((r) => !(r.actId === actId && r.outcomeId === outcomeId));
      return next;
    }
    default:
      return next;
  }
}

/** Issues whose path is `prefix` or lives under it (`stages.1` must not match `stages.10`). */
export function issuesAt(issues: CheckIssue[], pathPrefix: string): CheckIssue[] {
  return issues.filter((issue) => issue.path === pathPrefix || issue.path.startsWith(`${pathPrefix}.`));
}

function stageOf(skeleton: SkeletonShape, ref?: Ref) {
  if (ref?.startsWith("stage:")) return skeleton.stages.find((s) => s.id === ref.slice(6));
  return undefined;
}

function momentOf(skeleton: SkeletonShape, ref?: Ref) {
  if (ref?.startsWith("moment:")) return skeleton.definingMoments.find((m) => m.id === ref.slice(7));
  if (ref?.startsWith("stage:")) {
    const stage = skeleton.stages.find((s) => s.id === ref.slice(6));
    return skeleton.definingMoments.find((m) => m.id === stage?.definingMomentId);
  }
  return undefined;
}
