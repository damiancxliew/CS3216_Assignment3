/**
 * Canned views for screen work: one `PlayerView` per screen, produced by playing `MOCK_WALKTHROUGH`
 * through the mock, so they are always consistent with what `step` returns.
 */
import type { Action, PlayerView } from '@adventure/play-contract'

import { advanceMock, createMockState, MOCK_STAGE_MS, projectMock, type MockState } from './engine'

export const MOCK_START = Date.UTC(2026, 9, 14, 1, 0, 0)

/** `at` is milliseconds after `MOCK_START`; `snapshot` names the view to keep after that action. */
export const MOCK_WALKTHROUGH: readonly { at: number; action: Action; snapshot?: MockScreen }[] = [
  { at: 0, action: { type: 'tick' }, snapshot: 'briefing' },
  { at: 60_000, action: { type: 'continue' }, snapshot: 'stageIntro' },
  { at: 70_000, action: { type: 'continue' } },
  { at: 80_000, action: { type: 'enterRoom', roomId: 'balai' } },
  { at: 90_000, action: { type: 'message', characterId: 'temenggong', text: 'What do you make of the British?' } },
  { at: 100_000, action: { type: 'message', characterId: 'temenggong', text: 'What would you ask of them?' }, snapshot: 'pendingCheck' },
  { at: 105_000, action: { type: 'tick' }, snapshot: 'stage' },
  { at: 110_000, action: { type: 'message', characterId: 'temenggong', text: 'Raffles told me he will pay double.' }, snapshot: 'challenged' },
  { at: 120_000, action: { type: 'openDocument', documentId: 'agreement' } },
  { at: 130_000, action: { type: 'selectPassage', documentId: 'agreement', start: 102, end: 164 }, snapshot: 'documentOpen' },
  { at: 140_000, action: { type: 'enterRoom', roomId: 'landing' } },
  { at: 150_000, action: { type: 'tick' } },
  { at: 160_000, action: { type: 'insertNote', characterId: 'raffles', noteId: 'n6' }, snapshot: 'stanceChanged' },
  { at: 170_000, action: { type: 'endStage' }, snapshot: 'definingMoment' },
  { at: 180_000, action: { type: 'act', actId: 'faithful' }, snapshot: 'predicting' },
  { at: 190_000, action: { type: 'predict', outcomeId: 'signs' }, snapshot: 'predictionRevealed' },
  { at: 200_000, action: { type: 'continue' } },
  { at: 200_000 + MOCK_STAGE_MS, action: { type: 'tick' }, snapshot: 'finalCall' },
  { at: 210_000 + MOCK_STAGE_MS, action: { type: 'act', actId: 'recognise' } },
  { at: 220_000 + MOCK_STAGE_MS, action: { type: 'predict', outcomeId: 'treaty' }, snapshot: 'epilogue' },
  { at: 230_000 + MOCK_STAGE_MS, action: { type: 'continue' }, snapshot: 'interview' },
  { at: 240_000 + MOCK_STAGE_MS, action: { type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: ['n6'] }, snapshot: 'pushBack' },
  { at: 250_000 + MOCK_STAGE_MS, action: { type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: ['n6'], text: 'Only the rulers were asked.' }, snapshot: 'interviewClosed' },
  { at: 260_000 + MOCK_STAGE_MS, action: { type: 'continue' }, snapshot: 'reveal' },
]

export type MockScreen =
  | 'briefing'
  | 'stageIntro'
  | 'pendingCheck'
  | 'stage'
  | 'challenged'
  | 'documentOpen'
  | 'stanceChanged'
  | 'definingMoment'
  | 'predicting'
  | 'predictionRevealed'
  | 'finalCall'
  | 'epilogue'
  | 'interview'
  | 'pushBack'
  | 'interviewClosed'
  | 'reveal'

function playWalkthrough(): { views: Record<MockScreen, PlayerView>; final: MockState } {
  let state = createMockState('mock')
  const views: Partial<Record<MockScreen, PlayerView>> = {}
  for (const { at, action, snapshot } of MOCK_WALKTHROUGH) {
    state = advanceMock(state, action, MOCK_START + at).state
    if (snapshot !== undefined) views[snapshot] = projectMock(state)
  }
  return { views: views as Record<MockScreen, PlayerView>, final: state }
}

/** One view per screen. */
export const mockViews: Record<MockScreen, PlayerView> = playWalkthrough().views
