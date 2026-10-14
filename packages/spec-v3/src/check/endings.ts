/**
 * Rules 2–3: at least one `historical` ending must be reachable through the stage-by-stage
 * outcome graph, and every path must leave ≥2 non-secret endings open at the final decision.
 *
 * Codes: `historical-missing`, `historical-unreachable`, `paths-overflow`, `endings-open`,
 * `final-outcome-ending`.
 */
import type { AdventureSpec, CheckIssue } from '../index.js'

const PATH_CAP = 10_000

export function endingIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })

  // moments in stage order; stages whose definingMomentId doesn't resolve are skipped
  const moments = spec.stages
    .map((stage) => spec.definingMoments.find((m) => m.id === stage.definingMomentId))
    .filter((m) => m !== undefined)

  const producible = (moment: (typeof moments)[number]) => {
    const targeted = new Set(moment.rules.map((r) => r.outcomeId))
    return moment.outcomes.filter((o) => targeted.has(o.id))
  }

  const final = moments[moments.length - 1]
  if (final !== undefined) {
    const finalIndex = spec.definingMoments.indexOf(final)
    final.outcomes.forEach((outcome, j) => {
      if (outcome.endingId === undefined)
        add('final-outcome-ending', `definingMoments.${finalIndex}.outcomes.${j}.id`, `final-moment outcome '${outcome.id}' has no endingId`)
    })
  }

  const historical = spec.endings.filter((e) => e.type === 'historical')
  if (historical.length === 0) add('historical-missing', 'endings', 'the spec has no ending of type \'historical\'')

  // enumerate paths: one producible outcome per non-final moment
  const steps = moments.slice(0, -1).map(producible)
  const paths: string[][] = [[]]
  let overflow = false
  for (const options of steps) {
    const next: string[][] = []
    for (const path of paths)
      for (const option of options) {
        next.push([...path, option.id])
        if (next.length > PATH_CAP) {
          overflow = true
          break
        }
      }
    if (overflow) break
    paths.length = 0
    paths.push(...next)
  }
  if (overflow) {
    add('paths-overflow', 'stages', `more than ${PATH_CAP} outcome paths; reachability checks skipped`)
    return issues
  }

  const outcomeById = new Map(spec.definingMoments.flatMap((m) => m.outcomes.map((o) => [o.id, o])))
  const finalProducible = final === undefined ? [] : producible(final)
  const openOn = (path: string[]) => {
    const closed = new Set(path.flatMap((id) => outcomeById.get(id)?.closesEndingIds ?? []))
    const open = new Set<string>()
    for (const outcome of finalProducible)
      if (outcome.endingId !== undefined && !closed.has(outcome.endingId)) open.add(outcome.endingId)
    return open
  }

  if (historical.length > 0) {
    const reachable = paths.some((path) => historical.some((e) => openOn(path).has(e.id)))
    if (!reachable)
      add('historical-unreachable', 'endings', `no outcome path leaves a historical ending open (${historical.map((e) => e.id).join(', ')})`)
  }

  const nonSecret = new Set(spec.endings.filter((e) => e.type !== 'secret').map((e) => e.id))
  const failing = paths.find((path) => [...openOn(path)].filter((id) => nonSecret.has(id)).length < 2)
  if (failing !== undefined)
    add(
      'endings-open',
      'endings',
      `path [${failing.length === 0 ? '(no earlier outcomes)' : failing.join(' → ')}] leaves fewer than 2 non-secret endings open`,
    )

  return issues
}
