/** Remove authoring guidance from the reader heading; provenance remains in the source details. */
export function documentDisplayTitle(title: string): string {
  const cleaned = title.replace(/^later source(?:-pack)?(?: reading)?\s*[:–—-]\s*/i, '').trim();
  return cleaned ? cleaned[0]!.toLocaleUpperCase() + cleaned.slice(1) : title;
}

/** Map captions have room for a short name; full descriptions belong in the reader. */
export function documentMapLabel(title: string): string {
  const clean = documentDisplayTitle(title)
    .replace(/^(?:school adaptation of|illustrative|practice)\s+/i, '')
    .split(/\s+(?:describing|about)\s+|[;:]\s*/i)[0]!.trim();
  const label = clean ? clean[0]!.toLocaleUpperCase() + clean.slice(1) : 'Document';
  if (label.length <= 28) return label;
  const clipped = label.slice(0, 27);
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace >= 12 ? clipped.slice(0, lastSpace) : clipped) + '…';
}
