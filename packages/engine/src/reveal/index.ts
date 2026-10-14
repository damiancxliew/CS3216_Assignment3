/**
 * The reveal [E3]. **Owner: Damian.** Assemble the historical comparison, corrections, missed discoveries,
 * source breakdown and optional run playback without exposing secret endings.
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

function visibleEndingTitle(spec: EngineSpec, endingId: string): string | null {
  const ending = spec.endings.find((candidate) => candidate.id === endingId)
  return ending?.type === 'secret' ? null : ending?.title ?? endingId
}

function slantCorrections(spec: EngineSpec, state: EngineState): string[] {
  return spec.characters.flatMap((character) => {
    if ((state.characters[character.id]?.replies ?? 0) <= 0) return []
    return character.slants
      .filter((slant) => !state.confrontedSlants.includes(slant.id))
      .map((slant) => {
        const contradictedBy = spec.discoveries.find((discovery) => discovery.id === slant.contradictedBy[0])?.text
        if (contradictedBy === undefined) return null
        return `${character.name} told you: "${slant.claim}" That was one-sided: ${contradictedBy}`
      })
      .filter((correction): correction is string => correction !== null)
  })
}

function predictionPlayback(spec: EngineSpec, state: EngineState): string[] {
  return spec.definingMoments.flatMap((moment) => {
    const prediction = moment.outcomes.find((outcome) => outcome.id === state.predictions[moment.id])
    const actual = moment.outcomes.find((outcome) => outcome.id === state.outcomes[moment.id])
    if (prediction === undefined || actual === undefined) return []
    return [
      prediction.id === actual.id
        ? `You predicted: ${prediction.predictionText} That is what happened.`
        : `You predicted: ${prediction.predictionText} What happened: ${actual.summary}`,
    ]
  })
}

function interviewPlayback(spec: EngineSpec, state: EngineState): string[] {
  const verdictText = (verdictId: string): string =>
    spec.endings.flatMap((ending) => ending.interview.verdicts).find((verdict) => verdict.id === verdictId)?.text ?? ''
  const answerText = (answer: NonNullable<EngineState['interview']['answer']>): string => {
    const text = verdictText(answer.verdictId)
    return answer.text ? `${text} — ${answer.text}` : text
  }
  return [
    ...(state.interview.answer === null ? [] : [`Your first answer: ${answerText(state.interview.answer)}`]),
    ...(state.interview.response === null ? [] : [`After the push-back: ${answerText(state.interview.response)}`]),
  ]
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
      closedEndings: (yours?.closesEndingIds ?? []).map((id) => visibleEndingTitle(spec, id)).filter((title): title is string => title !== null),
    }
  })
  const sources = { teacher: new Set<string>(), other: new Set<string>(), invented: new Set<string>() }
  for (const item of [...spec.discoveries, ...spec.documents]) sources[sourceGroup(item.sourceLabel)].add(item.sourceLabel)
  const moments = spec.definingMoments
  return {
    whatHappened: spec.reveal?.whatHappened ?? historical?.summary ?? '',
    pathVsHistory,
    corrections: [...slantCorrections(spec, state), ...(spec.reveal?.corrections ?? [])],
    missedCore: spec.discoveries.filter((discovery) => discovery.core && !state.discovered.includes(discovery.id)).map((discovery) => discovery.text),
    more: {
      interpretations: spec.reveal?.interpretations ?? [],
      sources: { teacher: [...sources.teacher], other: [...sources.other], invented: [...sources.invented] },
      couldHaveGone: spec.reveal?.couldHaveGone ?? [],
      secretPathExisted: spec.endings.some((ending) => ending.type === 'secret'),
      playback: {
        acts: moments.flatMap((moment) => moment.acts.filter((act) => state.acts[moment.id] === act.id).map((act) => act.text)),
        predictions: predictionPlayback(spec, state),
        interview: interviewPlayback(spec, state),
      },
    },
    teacherQuestions: spec.teacherQuestions,
  }
}
