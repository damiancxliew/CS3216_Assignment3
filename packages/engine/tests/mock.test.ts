import { FakeLlmClient, createRng } from '@adventure/orchestration'
import { GameEvent, PlayerView } from '@adventure/play-contract'
import { describe, expect, it } from 'vitest'

import { EngineError } from '../src'
import { MOCK_START, MOCK_WALKTHROUGH, createMockEngine, mockViews } from '../src/mock'
import { documents } from '../src/mock/script'

const deps = (at: number) => ({ llm: new FakeLlmClient({ replies: ['{}'] }), rng: createRng('mock'), now: MOCK_START + at })

describe('@adventure/engine/mock', () => {
  it('plays the whole walkthrough, and every view and event matches the contract', async () => {
    const engine = createMockEngine()
    let state = engine.createState(null, 'seed')
    const phases = new Set<string>()
    for (const { at, action } of MOCK_WALKTHROUGH) {
      const result = await engine.step({ spec: null, state, action }, deps(at))
      PlayerView.parse(result.view)
      for (const event of result.events) GameEvent.parse(event)
      expect(result.view).toEqual(engine.project(null, result.state))
      phases.add(result.view.phase)
      state = result.state
    }
    expect([...phases]).toEqual(['briefing', 'stage', 'epilogue', 'interview', 'reveal'])
    expect(engine.project(null, state).ended).toBe(true)
  })

  it('never mutates the state it is given', async () => {
    const engine = createMockEngine()
    const state = engine.createState(null, 'seed')
    const before = structuredClone(state)
    await engine.step({ spec: null, state, action: { type: 'continue' } }, deps(0))
    expect(state).toEqual(before)
  })

  it('has a canned view for every screen, each with what that screen needs', () => {
    expect(mockViews.briefing.phase).toBe('briefing')
    expect(mockViews.stageIntro.stage?.intro).not.toBeNull()
    expect(mockViews.pendingCheck.pendingCheck).toBe(true)
    expect(mockViews.stage.notes).toHaveLength(1)
    expect(mockViews.stage.messages.some((message) => message.kind === 'notice')).toBe(true)
    expect(mockViews.challenged.messages.at(-1)?.text).toMatch(/why do I hear it from you/)
    expect(mockViews.documentOpen.documents[0]?.open).toBe(true)
    expect(mockViews.documentOpen.notes.map((note) => note.source)).toContain('document')
    expect(mockViews.stanceChanged.characters.find((character) => character.id === 'raffles')?.stanceId).toBe('s2')
    expect(mockViews.definingMoment.definingMoment?.status).toBe('choosing')
    expect(mockViews.predicting.definingMoment?.predictionOptions.length).toBeGreaterThan(0)
    expect(mockViews.predictionRevealed.stage?.intro?.predictionReveal).not.toBeNull()
    expect(mockViews.finalCall.definingMoment?.status).toBe('choosing')
    expect(mockViews.epilogue.epilogue).not.toBeNull()
    expect(mockViews.pushBack.interview?.pushBack).not.toBeNull()
    expect(mockViews.interviewClosed.interview?.closed).toBe(true)
    expect(mockViews.reveal.reveal).not.toBeNull()
  })

  it('never sends key passages to the client', () => {
    expect(JSON.stringify(mockViews.documentOpen)).not.toContain('keyPassage')
    expect(Object.keys(mockViews.documentOpen.documents[0] ?? {})).not.toContain('note')
    expect(JSON.stringify(mockViews.stage)).not.toContain(documents.agreement?.note ?? 'x')
  })

  it('refuses illegal actions with an EngineError', async () => {
    const engine = createMockEngine()
    const state = engine.createState(null, 'seed')
    await expect(engine.step({ spec: null, state, action: { type: 'act', actId: 'faithful' } }, deps(0))).rejects.toBeInstanceOf(EngineError)
    await expect(engine.step({ spec: null, state, action: { type: 'message', characterId: 'raffles', text: 'hi' } }, deps(0))).rejects.toMatchObject({
      code: 'illegal_phase',
    })
  })
})
