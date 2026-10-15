/**
 * `checkSpec`: `checkSkeleton` (refs, endings, core presence/holder, labels, counts) plus the
 * detail-only rules below. Pure and synchronous; never throws on a schema-valid spec (run
 * `validateSpec` first on unknown input).
 */
import type { AdventureSpec, CheckIssue, CheckResult } from '../index.js'
import { coreIssues } from './core.js'
import { labelIssues } from './labels.js'
import { referenceIssues } from './refs.js'
import { checkSkeleton } from './skeleton.js'

export function checkSpec(spec: AdventureSpec): CheckResult {
  const skeleton = checkSkeleton(spec)
  const errors: CheckIssue[] = [
    ...skeleton.errors,
    ...referenceIssues(spec),
    ...coreIssues(spec),
    ...labelIssues(spec),
  ]
  return { errors, warnings: skeleton.warnings }
}
