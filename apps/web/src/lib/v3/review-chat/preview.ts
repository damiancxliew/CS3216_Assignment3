import { atPath, type V3Edit } from "../edit/commands";
const names: Record<string, string> = {
  definingMoments: "Decision",
  teacherQuestions: "Discussion question",
  whatHappened: "What happened",
  openingNarration: "Opening narration",
};
const label = (key: string | number) =>
  typeof key === "number"
    ? String(key + 1)
    : (names[key] ??
      key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (char) => char.toUpperCase()));
export function changePreview(
  current: unknown,
  change: Extract<V3Edit, { type: "set" }>,
) {
  const { path } = change;
  const entity =
    typeof path[1] === "number"
      ? (atPath(current, path.slice(0, 2)) as { title?: string; name?: string })
      : null;
  const title = entity?.title ?? entity?.name;
  const source = path[0] === "sources" && path[2] === "included";
  const format = (value: unknown) =>
    source ? (value ? "Included" : "Not included") : String(value);
  return {
    label: title
      ? `${title}${source ? "" : ` · ${path.slice(2).map(label).join(" · ")}`}`
      : path.map(label).join(" · "),
    before: format(atPath(current, path)),
    after: format(change.value),
  };
}
