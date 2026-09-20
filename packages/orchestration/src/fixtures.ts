/**
 * Canned inputs so every other slice can exercise I4 without an LLM, a database or the I1 spec.
 * The shape mirrors what the server will assemble from an Adventure Spec v2 stage.
 */
import type { ResolverInput } from './resolver/types'

export const fixtureResolverInput: ResolverInput = {
  attemptId: 'attempt-demo',
  stageId: 'stage-harbour-negotiation',
  seed: 'harbor-1',
  stageIndex: 0,
  resolvedAt: '2026-09-20T21:00:00.000Z',
  trigger: 'decision',
  decision: {
    optionId: 'option-sign-treaty',
    label: 'Sign the treaty with the Temenggong',
    stance: 'cooperative',
    branchTarget: { kind: 'stage', stageId: 'stage-settlement' },
  },
  fallbackNext: { kind: 'stage', stageId: 'stage-settlement' },
  agents: [
    { id: 'agent-temenggong', name: 'Temenggong Abdul Rahman', disposition: 1 },
    { id: 'agent-farquhar', name: 'William Farquhar', disposition: 0 },
    { id: 'agent-harbour-master', name: 'The harbour master', disposition: -1 },
  ],
  actions: [
    {
      actorKind: 'player',
      actorId: 'player',
      action: { type: 'speak', roomId: 'room-audience-hall', body: 'What would the treaty cost your people?', addresseeId: 'agent-temenggong' },
    },
    {
      actorKind: 'agent',
      actorId: 'agent-temenggong',
      action: { type: 'speak', roomId: 'room-audience-hall', body: 'More than your company intends to pay.', addresseeId: 'player' },
    },
    { actorKind: 'agent', actorId: 'agent-farquhar', action: { type: 'move_room', toRoomId: 'room-audience-hall' } },
    { actorKind: 'agent', actorId: 'agent-harbour-master', action: { type: 'yield' } },
  ],
  evidenceCollected: 2,
}

/** The same stage, but the timer ran out before the player committed (D12/FR-16). */
export const fixtureTimerExpiryInput: ResolverInput = {
  ...fixtureResolverInput,
  trigger: 'timer_expiry',
  decision: null,
}
