export const CHANGES_MARKER = "\n\nChanges (before → after):\n";

export function withChangeLog(
  notes: string,
  entries: { label: string; before: string; after: string }[],
  maxLength = 4000,
): string {
  const limit = Math.max(0, maxLength);
  const shortenedNotes = notes.slice(0, limit);
  if (!entries.length || notes.length > limit) return shortenedNotes;

  const lines = entries.map(({ label, before, after }) => {
    const truncate = (value: string) =>
      value.length > 160 ? `${value.slice(0, 160)}…` : value;
    return `- ${label}: "${truncate(before)}" → "${truncate(after)}"`;
  });
  const prefix = `${notes}${CHANGES_MARKER}`;
  if (prefix.length > limit) return notes;

  const included: string[] = [];
  for (const line of lines) {
    const candidate = `${prefix}${included.length ? `${included.join("\n")}\n` : ""}${line}`;
    if (candidate.length > limit) break;
    included.push(line);
  }
  return included.length ? `${prefix}${included.join("\n")}` : notes;
}

export function visibleReviewText(message: {
  role: "assistant" | "user";
  text: string;
}): string {
  if (message.role === "user") {
    const targetIndex = message.text.lastIndexOf("\n\nTargets: ");
    return targetIndex < 0 ? message.text : message.text.slice(0, targetIndex);
  }
  const changesIndex = message.text.indexOf(CHANGES_MARKER);
  return changesIndex < 0 ? message.text : message.text.slice(0, changesIndex);
}
