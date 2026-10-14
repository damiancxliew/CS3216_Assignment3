const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (match, name: string) => {
    if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? match

    const hexadecimal = name[1]?.toLowerCase() === 'x'
    const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
    if (
      !Number.isInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return '�'
    }
    return String.fromCodePoint(codePoint)
  })
}

function textContent(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
}

export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  const rawTitle = titleMatch ? textContent(titleMatch[1] ?? '').replace(/\s+/g, ' ').trim() : ''

  const stripped = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|nav|header|footer|aside|form|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:address|article|blockquote|dd|div|dl|dt|figure|figcaption|h[1-6]|li|main|ol|p|pre|section|table|tbody|tfoot|td|th|thead|tr|ul)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')

  const text = decodeEntities(stripped)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { title: rawTitle || null, text }
}
