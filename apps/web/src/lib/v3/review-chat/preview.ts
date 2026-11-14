import { atPath, type V3Edit } from "../edit/commands";
import { pathLabel, type Path } from "./outline";
export function changePreview(
  current: unknown,
  change: Extract<V3Edit, { type: "set" }>,
  changes: Extract<V3Edit, { type: "set" }>[] = [change],
) {
  const { path } = change;
  const supportPath = readingSupportPath(path);
  if (supportPath) {
    const document = atPath(current, ["documents", supportPath.documentIndex]) as {
      body: string;
      readingCheck?: { variants?: unknown[] };
    };
    const nextBody = changes.find(({ path: changedPath }) =>
      changedPath.length === 3 &&
      changedPath[0] === "documents" &&
      changedPath[1] === supportPath.documentIndex &&
      changedPath[2] === "body",
    );
    const body = typeof nextBody?.value === "string" ? nextBody.value : document.body;
    const before = passageText(document.body, atPath(current, path));
    const after = passageText(body, change.value);
    const questionNumber = supportPath.variantIndex === null
      ? (document.readingCheck?.variants?.length ?? 4) + 1
      : supportPath.variantIndex + 1;
    return {
      label: `Reading question ${questionNumber} · Supporting passage`,
      before,
      after,
    };
  }
  const entity =
    typeof path[1] === "number"
      ? (atPath(current, path.slice(0, 2)) as { title?: string; name?: string })
      : null;
  const title = entity?.name ?? entity?.title;
  const source = path[0] === "sources" && path[2] === "included";
  const format = (value: unknown) =>
    source ? (value ? "Included" : "Not included") : String(value);
  return {
    label: title
      ? `${title}${source ? "" : ` · ${pathLabel(path.slice(2))}`}`
      : pathLabel(path),
    before: format(atPath(current, path)),
    after: format(change.value),
  };
}

function readingSupportPath(path: Path): { documentIndex: number; variantIndex: number | null } | null {
  if (path[0] !== "documents" || typeof path[1] !== "number" || path[2] !== "readingCheck")
    return null;
  if (path[3] === "recovery" && path[4] === "support")
    return { documentIndex: path[1], variantIndex: null };
  if (path[3] === "variants" && typeof path[4] === "number" && path[5] === "support")
    return { documentIndex: path[1], variantIndex: path[4] };
  return null;
}

function passageText(body: string, value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  return value
    .filter((span): span is { start: number; end: number } =>
      Boolean(span && typeof span === "object" &&
        Number.isInteger((span as { start?: unknown }).start) &&
        Number.isInteger((span as { end?: unknown }).end)),
    )
    .map(({ start, end }) => `“${body.slice(start, end)}”`)
    .join(" … ");
}
