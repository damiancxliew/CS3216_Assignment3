/**
 * Per-call checks for the reveal pass: cite grounding, the exact per-item counts the
 * engine expects (one correction per slanted document / deception act, one
 * couldHaveGone per non-secret non-historical outcome), citation-in-text, and the
 * secret-leak backstop. Errors go through the single call's repair loop.
 */
import type { AdventureSpec, CheckIssue } from '@adventure/spec-v3'

import { citationInText } from '../endings/checks'
import { quoteIssues } from '../grounding'
import type { RevealLlmOutput } from './schema'

const issue = (code: string, path: string, message: string): CheckIssue => ({ code, path, message })

export interface RevealContext {
  draft: AdventureSpec
  /** teacher source ids — must never appear in student-facing text */
  sourceIds: Set<string>
  /** documentId → full source text, for the quote-in-source check */
  sources: Map<string, string>
  /** document ids needing exactly one correction */
  correctionDocuments: Set<string>
  /** deception act ids needing exactly one correction */
  correctionActs: Set<string>
  /** outcome ids needing exactly one couldHaveGone entry (non-secret, non-historical) */
  expectedOutcomes: Set<string>
  /** every outcome id, to tell "unknown" from "secret" */
  allOutcomeIds: Set<string>
  /** lowercased secret-ending titles and secret-act texts — the leak backstop */
  secretStrings: string[]
}

export function buildRevealContext(
  draft: AdventureSpec,
  sources: Map<string, string>,
  sourceIds: Set<string>,
  slantedDocuments: { documentId: string }[],
): RevealContext {
  const correctionActs = new Set<string>()
  const expectedOutcomes = new Set<string>()
  const allOutcomeIds = new Set<string>()
  const secretOutcomeIds = new Set<string>()
  const secretStrings: string[] = []
  for (const ending of draft.endings) if (ending.type === 'secret') secretStrings.push(ending.title.toLowerCase())
  for (const moment of draft.definingMoments) {
    for (const outcome of moment.outcomes) {
      allOutcomeIds.add(outcome.id)
      if (outcome.secret === true) secretOutcomeIds.add(outcome.id)
      else if (outcome.historical !== true) expectedOutcomes.add(outcome.id)
    }
    for (const act of moment.acts) {
      if (isSecretAct(act, moment)) secretStrings.push(act.text.toLowerCase())
      else if (act.deception === true) correctionActs.add(act.id)
    }
  }
  return {
    draft,
    sourceIds,
    sources,
    correctionDocuments: new Set(slantedDocuments.map((s) => s.documentId)),
    correctionActs,
    expectedOutcomes,
    allOutcomeIds,
    // Short titles ("Wait", "The Deal") would flag innocent text, so only distinctive strings are matched.
    secretStrings: secretStrings.filter((s) => s.trim().length >= MIN_SECRET_STRING),
  }
}

/** the secret act = the act carrying `secret.unlock`; also any act whose fallback is a secret outcome. */
export function isSecretAct(act: { id: string; secret?: unknown }, moment: AdventureSpec['definingMoments'][number]): boolean {
  if (act.secret !== undefined) return true
  const secretOutcomes = new Set(moment.outcomes.filter((o) => o.secret === true).map((o) => o.id))
  return moment.rules.some((r) => r.actId === act.id && r.when === undefined && secretOutcomes.has(r.outcomeId))
}

const MIN_SECRET_STRING = 8
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** backstop: no student-facing text may name a secret ending or the secret act (whole words only). */
function secretLeaks(text: string, path: string, ctx: RevealContext): CheckIssue[] {
  const lower = text.toLowerCase()
  return ctx.secretStrings
    .filter((s) => new RegExp(`(^|\\W)${escapeRegExp(s.trim())}($|\\W)`).test(lower))
    .map(() => issue('secret-leak', path, 'student-facing text mentions the secret path'))
}

export function revealIssues(output: RevealLlmOutput, ctx: RevealContext): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const errors: CheckIssue[] = []
  const warnings: CheckIssue[] = []
  const texts: { text: string; path: string }[] = [
    { text: output.whatHappened.text, path: 'whatHappened.text' },
    ...output.interpretations.map((it, i) => ({ text: it.text, path: `interpretations.${i}.text` })),
    ...output.corrections.map((c, i) => ({ text: c.text, path: `corrections.${i}.text` })),
    ...output.couldHaveGone.map((c, i) => ({ text: c.text, path: `couldHaveGone.${i}.text` })),
    ...output.teacherQuestions.map((q, i) => ({ text: q, path: `teacherQuestions.${i}` })),
  ]
  for (const { text, path } of texts) {
    errors.push(...citationInText(text, path, ctx.sourceIds))
    errors.push(...secretLeaks(text, path, ctx))
  }
  // The interpretations warning goes to the teacher, who may need source names and pages; it only must not
  // name the secret path.
  if (output.interpretationsWarning !== null) {
    errors.push(...secretLeaks(output.interpretationsWarning.message, 'interpretationsWarning.message', ctx))
    output.interpretationsWarning.suggestedSources.forEach((source, i) =>
      errors.push(...secretLeaks(source, `interpretationsWarning.suggestedSources.${i}`, ctx)))
  }

  // cites: sourceId exists and the quote is word for word in that source ("…" rule applies)
  errors.push(
    ...quoteIssues(
      [
        ...output.whatHappened.cites.map((c, i) => ({ path: `whatHappened.cites.${i}.quote`, sourceId: c.sourceId, quote: c.quote })),
        ...output.interpretations.flatMap((it, i) => it.cites.map((c, j) => ({ path: `interpretations.${i}.cites.${j}.quote`, sourceId: c.sourceId, quote: c.quote }))),
      ],
      ctx.sources,
    ),
  )

  if (output.whatHappened.text.trim() === '') errors.push(issue('empty-field', 'whatHappened.text', 'whatHappened is empty'))

  // interpretations: 2–4, or fewer only with a warning that suggests ≥1 source
  if (output.interpretations.length < 2) {
    if (output.interpretationsWarning === null || output.interpretationsWarning.suggestedSources.length < 1)
      errors.push(issue('interpretations-few', 'interpretations', `only ${output.interpretations.length} interpretations and no interpretationsWarning with suggested sources`))
    else
      warnings.push(
        issue(
          'interpretations-warning',
          'interpretations',
          `${output.interpretationsWarning.message} Suggested sources: ${output.interpretationsWarning.suggestedSources.join('; ')}`,
        ),
      )
  }

  // corrections: exactly one per slanted document and per deception act; no unknown or duplicate ids
  const seenDocs = new Set<string>()
  const seenActs = new Set<string>()
  output.corrections.forEach((c, i) => {
    const at = `corrections.${i}`
    const refs = [c.documentId, c.actId].filter((x) => x !== null && x !== '')
    if (refs.length !== 1) {
      errors.push(issue('correction-ref', at, 'a correction names exactly one of documentId or actId'))
      return
    }
    if (c.documentId !== null && c.documentId !== '') {
      if (!ctx.correctionDocuments.has(c.documentId)) errors.push(issue('ref', `${at}.documentId`, `'${c.documentId}' is not a slanted document`))
      else if (seenDocs.has(c.documentId)) errors.push(issue('correction-duplicate', `${at}.documentId`, `a second correction for document '${c.documentId}'`))
      else seenDocs.add(c.documentId)
    }
    if (c.actId !== null && c.actId !== '') {
      if (!ctx.correctionActs.has(c.actId)) errors.push(issue('ref', `${at}.actId`, `'${c.actId}' is not a deception act`))
      else if (seenActs.has(c.actId)) errors.push(issue('correction-duplicate', `${at}.actId`, `a second correction for act '${c.actId}'`))
      else seenActs.add(c.actId)
    }
    if (c.text.trim() === '') errors.push(issue('empty-field', `${at}.text`, 'correction text is empty'))
  })
  for (const id of ctx.correctionDocuments) if (!seenDocs.has(id)) errors.push(issue('correction-missing', 'corrections', `no correction for slanted document '${id}'`))
  for (const id of ctx.correctionActs) if (!seenActs.has(id)) errors.push(issue('correction-missing', 'corrections', `no correction for deception act '${id}'`))

  // couldHaveGone: exactly one per non-secret, non-historical outcome
  const seenOutcomes = new Set<string>()
  output.couldHaveGone.forEach((c, i) => {
    const at = `couldHaveGone.${i}`
    if (!ctx.allOutcomeIds.has(c.outcomeId)) errors.push(issue('ref', `${at}.outcomeId`, `outcome '${c.outcomeId}' does not exist`))
    else if (!ctx.expectedOutcomes.has(c.outcomeId))
      errors.push(issue('ref', `${at}.outcomeId`, `outcome '${c.outcomeId}' is historical or secret — no couldHaveGone for it`))
    else if (seenOutcomes.has(c.outcomeId)) errors.push(issue('ref', `${at}.outcomeId`, `a second couldHaveGone for outcome '${c.outcomeId}'`))
    else seenOutcomes.add(c.outcomeId)
    if (c.text.trim() === '') errors.push(issue('empty-field', `${at}.text`, 'couldHaveGone text is empty'))
  })
  for (const id of ctx.expectedOutcomes) if (!seenOutcomes.has(id)) errors.push(issue('missing', 'couldHaveGone', `no couldHaveGone for outcome '${id}'`))

  // teacherQuestions: 2–3 and distinct
  if (output.teacherQuestions.length < 2 || output.teacherQuestions.length > 3)
    errors.push(issue('teacher-questions', 'teacherQuestions', `expected 2–3 teacher questions, got ${output.teacherQuestions.length}`))
  const seenQuestions = new Set<string>()
  output.teacherQuestions.forEach((q, i) => {
    const key = q.trim().toLowerCase()
    if (key === '') errors.push(issue('empty-field', `teacherQuestions.${i}`, 'teacher question is empty'))
    else if (seenQuestions.has(key)) errors.push(issue('teacher-questions', `teacherQuestions.${i}`, 'teacher questions must be distinct'))
    seenQuestions.add(key)
  })

  return { errors, warnings }
}
