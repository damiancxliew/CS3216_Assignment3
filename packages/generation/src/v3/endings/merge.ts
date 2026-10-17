/**
 * Merge the endings-pass outputs into the details draft. Conditional rules are prepended
 * to the existing fallback rules (unchanged); verdict ids are generated. Nothing the
 * skeleton or details passes own is touched.
 */
import type { AdventureSpec, SpecMoment } from '@adventure/spec-v3'

import { atomConditions, toWhenCondition } from './schema'
import type { EndingLlmOutput, MomentLlmOutput } from './schema'
import { secretActIds } from './checks'

export interface EndingsParts {
  moments: Map<string, MomentLlmOutput>
  endings: Map<string, EndingLlmOutput>
}

export function mergeEndings(draft: AdventureSpec, parts: EndingsParts): AdventureSpec {
  const definingMoments: SpecMoment[] = draft.definingMoments.map((moment) => {
    const output = parts.moments.get(moment.id)
    if (output === undefined) return moment

    const acts = moment.acts.map((act) => {
      const written = output.acts.find((a) => a.id === act.id)
      if (written === undefined) return act
      return { ...act, reaction: written.reaction, deception: written.deception }
    })
    const outcomes = moment.outcomes.map((outcome) => {
      const written = output.outcomes.find((o) => o.id === outcome.id)
      if (written === undefined) return outcome
      return { ...outcome, predictionText: written.predictionText, because: written.because }
    })

    const conditionalRules = output.conditionalRules.map((rule) => ({
      actId: rule.actId,
      ...(toWhenCondition(rule.when) !== undefined ? { when: toWhenCondition(rule.when)! } : {}),
      outcomeId: rule.outcomeId,
    }))

    // attach the unlock to the secret act
    const secret = secretActIds(moment)
    const actsFinal =
      output.secretUnlock !== null && secret.has(output.secretUnlock.actId)
        ? acts.map((act) =>
            act.id === output.secretUnlock!.actId
              ? { ...act, secret: { unlock: atomConditions(output.secretUnlock!.conditions), minMet: output.secretUnlock!.minMet } }
              : act,
          )
        : acts

    return {
      ...moment,
      nudge: output.nudge,
      finalCallNarration: output.finalCallNarration,
      acts: actsFinal,
      outcomes,
      rules: [...conditionalRules, ...moment.rules],
    }
  })

  const endings = draft.endings.map((ending) => {
    const output = parts.endings.get(ending.id)
    if (output === undefined) return ending
    return {
      ...ending,
      epilogue: output.epilogue,
      interview: {
        interviewer: output.interviewer,
        question: output.question,
        verdicts: output.verdicts.map((verdict, i) => ({ id: `${ending.id}-v${i + 1}`, text: verdict.text, counterPoints: verdict.counterPoints })),
        generalCounter: output.generalCounter,
      },
    }
  })

  return { ...draft, definingMoments, endings }
}
