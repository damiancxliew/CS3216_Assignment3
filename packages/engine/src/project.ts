/**
 * `project(spec, state) → PlayerView`. Built field by field from public data only, never by copying a spec
 * object and deleting the private parts, so a new private field can't leak by being forgotten.
 *
 * Never sent: undiscovered discoveries, personas, stance labels and demeanours, slants, key passages, outcome
 * rules, an outcome before it is resolved, a secret act before it unlocks, closed or secret outcomes as
 * predictions, endings other than the one reached.
 */
import type { DefiningMomentView, DocumentView, PlayerView } from '@adventure/play-contract'

import { buildReveal } from './reveal'
import { projectInterview } from './interview'
import { predictionOptions } from './rules/moment'
import { noteText } from './rules/knowledge'
import { stageDocumentPlacement, stageDurationMs } from './rules/stages'
import type { EngineSpec, SpecDocument } from './spec'
import type { EngineState } from './state'

export const EPILOGUE_LABEL = 'This is how your run ended: your simulation, not the historical record.'

function documentView(document: SpecDocument, open: boolean): DocumentView {
  return {
    id: document.id,
    kind: document.kind,
    title: document.title,
    provenance: {
      masthead: document.provenance.masthead ?? null,
      date: document.provenance.date ?? null,
      sender: document.provenance.sender ?? null,
      recipient: document.provenance.recipient ?? null,
      place: document.provenance.place ?? null,
    },
    body: document.body,
    real: document.real,
    sourceLabel: document.real ? document.sourceLabel : null,
    glossary: document.glossary.map(({ term, meaning }) => ({ term, meaning })),
    open,
  }
}

function momentView(spec: EngineSpec, state: EngineState): DefiningMomentView | null {
  const current = state.moment
  if (current === null) return null
  const moment = spec.definingMoments.find((candidate) => candidate.id === current.momentId)
  if (moment === undefined) return null
  const chosen = moment.acts.find((act) => act.id === current.actId)
  return {
    momentId: moment.id,
    scene: moment.scene,
    deciderId: moment.deciderId,
    deciderName: spec.characters.find((character) => character.id === moment.deciderId)?.name ?? moment.deciderId,
    status: current.status,
    acts:
      current.status === 'choosing'
        ? moment.acts.filter((act) => current.availableActIds.includes(act.id)).map(({ id, text }) => ({ id, text }))
        : chosen === undefined
          ? []
          : [{ id: chosen.id, text: chosen.text }],
    nudge: current.nudge,
    chosenActId: current.actId,
    reaction: chosen?.reaction ?? null,
    predictionOptions: current.status === 'predicting' ? predictionOptions(state, moment).map(({ id, predictionText }) => ({ outcomeId: id, text: predictionText })) : [],
  }
}

export function project(spec: EngineSpec, state: EngineState): PlayerView {
  const inStage = state.phase === 'stage'
  const stage = inStage ? spec.stages[state.stageIndex] : undefined
  const playing = stage !== undefined && !state.stageIntroPending
  const ending = spec.endings.find((candidate) => candidate.id === state.endingId)
  const duration = stage === undefined ? null : stageDurationMs({ spec, state })
  const afterStages = state.phase === 'epilogue' || state.phase === 'interview' || state.phase === 'reveal'
  return {
    phase: state.phase,
    briefing: {
      name: spec.role.name,
      position: spec.role.position,
      relationships: [...spec.role.relationships],
      reputation: spec.role.reputation,
      stakes: spec.role.stakes,
      privateBrief: {
        goals: [...spec.role.privateBrief.goals],
        fears: [...spec.role.privateBrief.fears],
        constraints: [...spec.role.privateBrief.constraints],
        knows: [...spec.role.privateBrief.knows],
      },
      situation: spec.role.situation,
    },
    stage:
      stage === undefined
        ? null
        : {
            index: state.stageIndex,
            count: spec.stages.length,
            title: stage.title,
            timePlace: stage.timePlace,
            centralQuestion: stage.centralQuestion,
            intro: state.stageIntroPending ? { narration: state.stageOpening ?? stage.openingNarration, predictionReveal: state.lastPrediction === null ? null : { ...state.lastPrediction } } : null,
          },
    rooms: stage?.rooms.map(({ id, name }) => ({ id, name })) ?? [],
    currentRoomId: inStage ? state.playerRoomId : null,
    characters: playing
      ? spec.characters
          .filter((character) => state.characters[character.id]?.roomId === state.playerRoomId)
          .map((character) => {
            const stanceId = state.characters[character.id]?.stanceId ?? null
            return { id: character.id, name: character.name, title: character.title, stanceId, portraitKey: stanceId === null ? character.id : `${character.id}:${stanceId}` }
          })
      : [],
    messages: state.transcript.map((message) => ({ ...message })),
    notes: state.notes.map((note) => ({ id: note.id, text: noteText(spec, note.discoveryId), source: note.source, stageIndex: note.stageIndex, at: note.at })),
    documents: state.heldDocuments
      .map((id) => spec.documents.find((document) => document.id === id))
      .filter((document): document is SpecDocument => document !== undefined)
      .map((document) => documentView(document, state.openDocumentId === document.id)),
    documentsHere: playing && stage !== undefined
      ? Object.entries(stageDocumentPlacement(state, stage)).flatMap(([id, room]) => {
          if (room === 'held' || room !== state.playerRoomId) return []
          const read =
            state.documentRooms[id] === state.playerRoomId
              ? false
              : state.heldDocuments.includes(id) && state.documentRooms[id] === undefined
                ? true
                : null
          if (read === null) return []
          const document = spec.documents.find((candidate) => candidate.id === id)
          return document === undefined ? [] : [{ id: document.id, kind: document.kind, title: document.title, read }]
        })
      : [],
    definingMoment: inStage ? momentView(spec, state) : null,
    timer: playing && state.stageEndsAt !== null && duration !== null ? { endsAt: state.stageEndsAt, durationMs: duration } : null,
    pendingCheck: state.pendingChecks.length > 0,
    epilogue: afterStages && ending !== undefined ? { title: ending.title, text: ending.epilogue, label: EPILOGUE_LABEL } : null,
    interview: projectInterview(spec, state),
    reveal: state.phase === 'reveal' ? buildReveal(spec, state) : null,
    ended: state.ended,
  }
}
