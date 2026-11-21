export type DiffPart = { type: "same" | "removed" | "added"; text: string };

export function condenseDiff(parts: DiffPart[], context = 8): DiffPart[] {
  const firstChange = parts.findIndex(({ type }) => type !== "same");
  if (firstChange === -1) return parts;
  let lastChange = parts.length - 1;
  while (parts[lastChange]?.type === "same") lastChange--;

  const wordsToKeep = Math.max(0, Math.floor(context));
  return parts.map((part, index) => {
    if (part.type !== "same") return part;
    const tokens = part.text.split(/(\s+)/).filter(Boolean);
    const wordIndexes = tokens.flatMap((token, tokenIndex) =>
      /\S/.test(token) ? [tokenIndex] : [],
    );
    if (index < firstChange && wordIndexes.length > wordsToKeep) {
      if (wordsToKeep === 0) return { ...part, text: "…" };
      let start = wordIndexes[wordIndexes.length - wordsToKeep]!;
      if (start > 0 && /^\s+$/.test(tokens[start - 1]!)) start--;
      const kept = tokens.slice(start).join("");
      return {
        ...part,
        text: `…${/^\s/.test(kept) ? "" : " "}${kept}`,
      };
    }
    if (index > lastChange && wordIndexes.length > wordsToKeep) {
      if (wordsToKeep === 0) return { ...part, text: "…" };
      const end = wordIndexes[wordsToKeep - 1]! + 1;
      return { ...part, text: `${tokens.slice(0, end).join("")}…` };
    }
    if (
      index > firstChange &&
      index < lastChange &&
      wordIndexes.length > wordsToKeep * 2
    ) {
      if (wordsToKeep === 0) return { ...part, text: " … " };
      const firstEnd = wordIndexes[wordsToKeep - 1]! + 1;
      const lastStart = wordIndexes[wordIndexes.length - wordsToKeep]!;
      const first = tokens.slice(0, firstEnd).join("").trimEnd();
      const last = tokens.slice(lastStart).join("").trimStart();
      return { ...part, text: `${first} … ${last}` };
    }
    return part;
  });
}

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
