export type PassageEndpoint = { paragraph: number; offset: number };

export function offsetsFromParagraphs(
  paragraphs: readonly string[],
  start: PassageEndpoint,
  end: PassageEndpoint,
): { start: number; end: number } | null {
  const offsetAt = ({ paragraph, offset }: PassageEndpoint) => {
    if (!Number.isInteger(paragraph) || paragraph < 0 || paragraph >= paragraphs.length) return null;
    if (!Number.isInteger(offset) || offset < 0 || offset > paragraphs[paragraph].length) return null;
    let total = offset;
    for (let index = 0; index < paragraph; index += 1) total += paragraphs[index].length + 1;
    return total;
  };
  const startOffset = offsetAt(start);
  const endOffset = offsetAt(end);
  if (startOffset === null || endOffset === null || endOffset <= startOffset) return null;
  return { start: startOffset, end: endOffset };
}
