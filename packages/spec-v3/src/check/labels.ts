/**
 * Rule 5: provenance labels — every discovery, document, persona phrase and ending carries a
 * non-empty `sourceLabel`, and a core discovery may not be labelled `invented`.
 *
 * Codes: `source-label`, `core-invented`.
 */
import type { AdventureSpec, CheckIssue } from '../index.js'

export function labelIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const blank = (label: string) => label.trim().length === 0
  const check = (label: string, path: string, what: string) => {
    if (blank(label)) issues.push({ code: 'source-label', path, message: `${what} has an empty sourceLabel` })
  }

  spec.discoveries.forEach((discovery, i) => {
    check(discovery.sourceLabel, `discoveries.${i}.sourceLabel`, `discovery '${discovery.id}'`)
    if (discovery.core && discovery.sourceLabel.trim().toLowerCase() === 'invented')
      issues.push({ code: 'core-invented', path: `discoveries.${i}.sourceLabel`, message: `core discovery '${discovery.id}' is labelled 'invented'` })
  })
  spec.documents.forEach((document, i) => check(document.sourceLabel, `documents.${i}.sourceLabel`, `document '${document.id}'`))
  spec.characters.forEach((character, i) =>
    character.persona.phrases.forEach((phrase, j) =>
      check(phrase.sourceLabel, `characters.${i}.persona.phrases.${j}.sourceLabel`, `phrase of character '${character.id}'`),
    ),
  )
  spec.endings.forEach((ending, i) => check(ending.sourceLabel, `endings.${i}.sourceLabel`, `ending '${ending.id}'`))

  return issues
}
