import type { SkeletonShape } from "@adventure/spec-v3";
import { atPath, type V3Edit } from "./commands";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Diff entity lists in execution order: remove backwards, then insert/reorder/update. */
export function skeletonChanges(base: SkeletonShape, edited: unknown): V3Edit[] {
  if (!edited || typeof edited !== "object" || Array.isArray(edited)) throw Error("Invalid skeleton");
  const before = base as unknown as Record<string, unknown>;
  const after = edited as Record<string, unknown>;
  const edits: V3Edit[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[key], next = after[key];
    if (same(old, next)) continue;
    if (Array.isArray(old) && Array.isArray(next)) {
      const list = [...old] as { id?: string }[];
      for (let i = list.length - 1; i >= 0; i--) {
        if (!next.some(item => item?.id === list[i]?.id)) {
          edits.push({ type: "remove", path: [key, i] });
          list.splice(i, 1);
        }
      }
      next.forEach((item, index) => {
        const at = list.findIndex(entity => entity?.id === item?.id);
        if (at < 0) {
          edits.push({ type: "insert", path: [key], index, value: item });
          list.splice(index, 0, item);
        } else {
          if (at !== index) {
            edits.push({ type: "move", path: [key], from: at, to: index });
            list.splice(index, 0, list.splice(at, 1)[0]);
          }
          if (!same(list[index], item)) edits.push({ type: "set", path: [key, index], value: item });
          list[index] = item;
        }
      });
    } else if (next === undefined) edits.push({ type: "remove", path: [key] });
    else edits.push({ type: "set", path: [key], value: next });
  }
  return edits;
}

/** Skeletons have no full-spec structure yet; only the generic path commands apply. */
export function applySkeletonEdits(base: SkeletonShape, edits: V3Edit[]): unknown {
  const result = structuredClone(base);
  for (const edit of edits) {
    if (!("path" in edit)) throw Error("Only path commands can edit the skeleton");
    if (edit.path.some(key => ["__proto__", "prototype", "constructor"].includes(String(key)))) throw Error("Protected field");
    if (edit.type === "insert" || edit.type === "move") {
      const list = atPath(result, edit.path);
      if (!Array.isArray(list)) throw Error("Expected list");
      if (edit.type === "insert") {
        if (edit.index > list.length) throw Error("Invalid insertion");
        list.splice(edit.index, 0, structuredClone(edit.value));
      } else {
        if (edit.from >= list.length || edit.to >= list.length) throw Error("Invalid order");
        list.splice(edit.to, 0, list.splice(edit.from, 1)[0]);
      }
    } else {
      const parent = atPath(result, edit.path.slice(0, -1));
      if (!parent || typeof parent !== "object") throw Error("Unknown field");
      const key = edit.path.at(-1)!;
      if (edit.type === "remove") {
        if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
        else delete (parent as Record<string | number, unknown>)[key];
      } else (parent as Record<string | number, unknown>)[key] = structuredClone(edit.value);
    }
  }
  return result;
}
