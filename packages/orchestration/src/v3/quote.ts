/**
 * Data is not instruction (C10). Everything a student typed or a source supplied reaches a v3 prompt inside a
 * labelled block, and the delimiters inside it are neutralised so it cannot close the block. Same rail as the
 * v2 agent prompt, kept separate so v2 stays untouched.
 */
export const BLOCK_OPEN = '<<<'
export const BLOCK_CLOSE = '>>>'

export function neutralise(text: string): string {
  return text.replaceAll(BLOCK_OPEN, '<<').replaceAll(BLOCK_CLOSE, '>>')
}

export function block(label: string, body: string): string {
  return `${BLOCK_OPEN}${label}\n${neutralise(body)}\n${BLOCK_CLOSE}`
}

export function bullets(items: readonly string[], empty = 'None.'): string {
  return items.length === 0 ? empty : items.map((item) => `- ${item}`).join('\n')
}

/** FNV-1a, for picking a deterministic fallback line without an rng. */
export function stableIndex(key: string, length: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % Math.max(1, length)
}
