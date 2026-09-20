/**
 * Server-authority checks (PRD FR-21, K11).
 *
 * The rule is asserted, not assumed: no private agent context, unresolved roll, hidden event or
 * Resolver rationale may appear in a client payload. The key list mirrors the Turn API contract
 * (I3) so a payload that passes there passes here.
 */

export const FORBIDDEN_RESPONSE_KEYS = [
  'privateContext',
  'private_context',
  'privateNotes',
  'private_notes',
  'rolls',
  'roll',
  'rationale',
  'resolverRationale',
  'knowledgeHorizon',
  'knowledge_horizon',
  'hiddenState',
  'seed',
] as const

/** Every forbidden key in the payload, at any depth, as JSON paths. */
export function findForbiddenKeys(payload: unknown, path = '$'): string[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item, i) => findForbiddenKeys(item, `${path}[${i}]`))
  }
  if (payload !== null && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).flatMap(([key, value]) => {
      const here = `${path}.${key}`
      const hit = (FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(key) ? [here] : []
      return [...hit, ...findForbiddenKeys(value, here)]
    })
  }
  return []
}

/**
 * Paths whose string value contains one of `secrets`. Catches the leak a key-name check cannot: a
 * private motivation copied verbatim into an announcement.
 */
export function findLeakedText(payload: unknown, secrets: readonly string[], path = '$'): string[] {
  const needles = secrets.map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 8)
  const walk = (value: unknown, at: string): string[] => {
    if (typeof value === 'string') {
      const haystack = value.toLowerCase()
      return needles.some((needle) => haystack.includes(needle)) ? [at] : []
    }
    if (Array.isArray(value)) return value.flatMap((item, i) => walk(item, `${at}[${i}]`))
    if (value !== null && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => walk(inner, `${at}.${key}`))
    }
    return []
  }
  return walk(payload, path)
}

export interface LeakReport {
  ok: boolean
  forbiddenKeys: string[]
  leakedText: string[]
}

export function auditClientPayload(payload: unknown, secrets: readonly string[] = []): LeakReport {
  const forbiddenKeys = findForbiddenKeys(payload)
  const leakedText = findLeakedText(payload, secrets)
  return { ok: forbiddenKeys.length === 0 && leakedText.length === 0, forbiddenKeys, leakedText }
}
