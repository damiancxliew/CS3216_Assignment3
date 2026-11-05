/**
 * Detail-only label rules: documents and persona phrases. Discovery and ending labels are
 * skeleton rules and live in `skeleton.ts`.
 *
 * Codes: `source-label`.
 */
import type { AdventureSpec, CheckIssue } from '../index.js'

export function labelIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const check = (label: string, path: string, what: string) => {
    if (label.trim().length === 0) issues.push({ code: 'source-label', path, message: `${what} has an empty sourceLabel` })
  }

  spec.documents.forEach((document, i) => check(document.sourceLabel, `documents.${i}.sourceLabel`, `document '${document.id}'`))
  spec.characters.forEach((character, i) =>
    character.persona.phrases.forEach((phrase, j) =>
      check(phrase.sourceLabel, `characters.${i}.persona.phrases.${j}.sourceLabel`, `phrase of character '${character.id}'`),
    ),
  )

  return issues
}
