/**
 * Canned inputs so every other slice can exercise I4 without an LLM, a database or the I1 spec.
 * The shape mirrors what the server will assemble from an Adventure Spec v2 stage.
 */
import type { AgentPrivateContext, AgentPublicProfile, AgentTurnInput } from './agent/types'
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

/* ------------------------------------------------------------------ character agents (K2/K3) */

export const fixtureTemenggongProfile: AgentPublicProfile = {
  id: 'agent-temenggong',
  name: 'Temenggong Abdul Rahman',
  publicRole: 'chief of the settlement at the river mouth',
}

export const fixtureFarquharProfile: AgentPublicProfile = {
  id: 'agent-farquhar',
  name: 'William Farquhar',
  publicRole: 'Resident of Melaka, in the Company\u2019s service',
}

/** Distinctive strings: the isolation tests assert these never reach another agent's prompt. */
export const fixtureTemenggongPrivate: AgentPrivateContext = {
  agentId: 'agent-temenggong',
  motivations: ['Keep the Sultan\u2019s claim intact while the Company pays for the anchorage'],
  secrets: ['A Dutch sloop anchored off Karimun two nights ago carrying an envoy'],
  knowledgeHorizon: 'anything after February 1819, and anything said in rooms you were not in',
  notes: ['The Resident avoids naming a figure in front of witnesses'],
}

export const fixtureFarquharPrivate: AgentPrivateContext = {
  agentId: 'agent-farquhar',
  motivations: ['Secure a factory site before Batavia hears of the landing'],
  secrets: ['Raffles has authorised eight thousand Spanish dollars a year, no more'],
  knowledgeHorizon: 'anything after February 1819, and anything said in rooms you were not in',
  notes: ['The Temenggong keeps looking to the river mouth when ships are mentioned'],
}

export const fixtureAgentTurnInput: AgentTurnInput = {
  self: fixtureTemenggongProfile,
  privateContext: fixtureTemenggongPrivate,
  sharedContext:
    'Singapore, February 1819. A British landing party has come ashore at the mouth of the Singapore River to ask for permission to establish a trading post.',
  stageBrief: 'The terms of the anchorage are being discussed in the audience hall.',
  room: {
    id: 'room-audience-hall',
    name: 'Audience hall',
    description: 'A raised timber hall open to the river breeze, mats laid for visitors.',
    occupants: [fixtureTemenggongProfile, fixtureFarquharProfile],
    doorOpen: true,
  },
  transcript: [
    { speakerId: 'player', speakerName: 'You', body: 'What would the treaty cost your people?' },
    {
      speakerId: 'agent-farquhar',
      speakerName: 'William Farquhar',
      body: 'The Company asks only for ground to build upon.',
    },
  ],
  playerMessage: 'Would you sign, if the payment were yearly?',
  actionsRemaining: 4,
}
