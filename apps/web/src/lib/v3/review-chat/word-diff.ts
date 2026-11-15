export type DiffPart = { type: "same" | "removed" | "added"; text: string };

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 250_000) {
    return [
      ...(before ? [{ type: "removed" as const, text: before }] : []),
      ...(after ? [{ type: "added" as const, text: after }] : []),
    ];
  }

  const lengths = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i] === b[j]
          ? 1 + lengths[i + 1]![j + 1]!
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const parts: DiffPart[] = [];
  const append = (type: DiffPart["type"], text: string) => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.type === type) previous.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      append("same", a[i]!);
      i++;
      j++;
    } else if (
      i < a.length &&
      (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)
    ) {
      append("removed", a[i]!);
      i++;
    } else {
      append("added", b[j]!);
      j++;
    }
  }
  return parts;
}
