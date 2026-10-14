/**
 * The reveal [E3]. **Owner: Damian.** A minimal assembly from the spec and the run so the game plays end to
 * end; the full version (wording, source breakdown, defaults vs on request) is Damian's.
 */
import type { RevealView } from '@adventure/play-contract'

import type { EngineSpec } from '../spec'
import type { EngineState } from '../state'

function sourceGroup(label: string): 'teacher' | 'other' | 'invented' {
  const lower = label.toLowerCase()
  if (lower === 'invented') return 'invented'
  if (lower.includes('from the teacher')) return 'teacher'
  return 'other'
}

export function buildReveal(spec: EngineSpec, state: EngineState): RevealView {
  const historical = spec.endings.find((ending) => ending.type === 'historical')
  const pathVsHistory = spec.stages.map((stage, stageIndex) => {
    const moment = spec.definingMoments.find((candidate) => candidate.id === stage.definingMomentId)
    const yours = moment?.outcomes.find((outcome) => outcome.id === state.outcomes[moment.id])
    const history = moment?.outcomes.find((outcome) => outcome.historical === true)
    return {
      stageIndex,
      yours: yours?.summary ?? 'You did not reach this moment.',
      history: history?.summary ?? '',
      matched: yours !== undefined && yours.id === history?.id,
      closedEndings: (yours?.closesEndingIds ?? []).map((id) => spec.endings.find((ending) => ending.id === id)?.title ?? id),
    }
  })
  const sources = { teacher: new Set<string>(), other: new Set<string>(), invented: new Set<string>() }
  for (const item of [...spec.discoveries, ...spec.documents]) sources[sourceGroup(item.sourceLabel)].add(item.sourceLabel)
  const moments = spec.definingMoments
  return {
    whatHappened: spec.reveal?.whatHappened ?? historical?.summary ?? '',
    pathVsHistory,
    corrections: spec.reveal?.corrections ?? [],
    missedCore: spec.discoveries.filter((discovery) => discovery.core && !state.discovered.includes(discovery.id)).map((discovery) => discovery.text),
    more: {
      interpretations: spec.reveal?.interpretations ?? [],
      sources: { teacher: [...sources.teacher], other: [...sources.other], invented: [...sources.invented] },
      couldHaveGone: spec.reveal?.couldHaveGone ?? [],
      secretPathExisted: spec.endings.some((ending) => ending.type === 'secret'),
      playback: {
        acts: moments.flatMap((moment) => moment.acts.filter((act) => state.acts[moment.id] === act.id).map((act) => act.text)),
        predictions: moments.flatMap((moment) => moment.outcomes.filter((outcome) => state.predictions[moment.id] === outcome.id).map((outcome) => outcome.predictionText)),
        interview: [state.interview.answer, state.interview.response]
          .filter((answer) => answer !== null)
          .map((answer) => answer.text ?? spec.endings.flatMap((ending) => ending.interview.verdicts).find((verdict) => verdict.id === answer.verdictId)?.text ?? ''),
      },
    },
    teacherQuestions: spec.teacherQuestions,
  }
}
