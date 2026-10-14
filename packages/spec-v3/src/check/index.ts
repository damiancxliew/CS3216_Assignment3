/**
 * `checkSpec`: semantic checks on top of `validateSpec` — reference resolution, ending
 * reachability, core-discovery reachability and source labels. Pure and synchronous; never
 * throws on a schema-valid spec (run `validateSpec` first on unknown input).
 */
import type { AdventureSpec, CheckIssue, CheckResult } from '../index.js'
import { coreIssues } from './core.js'
import { endingIssues } from './endings.js'
import { labelIssues } from './labels.js'
import { referenceIssues } from './refs.js'

export function checkSpec(spec: AdventureSpec): CheckResult {
  const errors: CheckIssue[] = [
    ...referenceIssues(spec),
    ...endingIssues(spec),
    ...coreIssues(spec),
    ...labelIssues(spec),
  ]
  return { errors, warnings: [] }
}
