import type { AdventureSpec, CheckIssue, Condition } from '../index.js'

function hasNegation(condition: Condition): boolean {
  if ('not' in condition) return true
  if ('all' in condition) return condition.all.some(hasNegation)
  if ('any' in condition) return condition.any.some(hasNegation)
  return false
}

/** Gameplay invariants apply to generated drafts as well as edited adventures. */
export function gameplayIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  spec.definingMoments.forEach((moment, i) => moment.acts.forEach((act, j) => {
    act.secret?.unlock.forEach((condition, k) => {
      if (hasNegation(condition))
        issues.push({ code: 'secret-unlock', path: `definingMoments.${i}.acts.${j}.secret.unlock.${k}`, message: 'Secret unlocks must require positive achievements, never their absence.' })
    })
  }))
  return issues
}
