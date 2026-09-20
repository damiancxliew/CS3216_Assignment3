/**
 * What one character agent is allowed to see on a tick (K2, PRD FR-11/FR-12/FR-21).
 *
 * The split below is the whole point of the file: `AgentPublicProfile` is what everyone in the room
 * can see, `AgentPrivateContext` is what only this agent and the server may ever see, and the
 * runtime is handed exactly one private context — its own. There is no field here through which an
 * agent could receive another agent's motivations, so room-scoped visibility (K3) is a matter of
 * what the caller assembles, not of trusting the model to ignore what it was shown.
 */
import { z } from 'zod'

import { AGENT_ACTION_TYPES } from '../actions'

export interface AgentPublicProfile {
  id: string
  name: string
  /** One line the player can see: role, station, visible allegiance. */
  publicRole: string
}

export interface AgentPrivateContext {
  agentId: string
  /** Why this character acts, in their own terms. Never projected to a client (FR-21). */
  motivations: readonly string[]
  /** Facts this character knows that others may not. */
  secrets: readonly string[]
  /**
   * What the character cannot know: period limit, plus anything outside their experience (FR-8).
   * Stated to the model as a hard boundary, and checked by the caller's evaluators.
   */
  knowledgeHorizon: string
  /** Notes the agent wrote itself on earlier ticks via `record_private_note`. */
  notes: readonly string[]
}

export interface TranscriptLine {
  speakerId: string
  speakerName: string
  body: string
}

export interface RoomView {
  id: string
  name: string
  description: string
  /** Who else is in the room right now. Public profiles only. */
  occupants: readonly AgentPublicProfile[]
  doorOpen: boolean
}

/** Everything the agent is asked to respond to. Assembled server-side, per agent, per tick. */
export interface AgentTurnInput {
  self: AgentPublicProfile
  privateContext: AgentPrivateContext
  /** Setting, era and situation every character in the adventure shares (I1). */
  sharedContext: string
  /** Current stage brief, as the characters would understand it. */
  stageBrief: string
  room: RoomView
  /** This room's transcript only (FR-11). Lines from rooms the agent was not in never appear. */
  transcript: readonly TranscriptLine[]
  /** What the player just said in this room, if anything. Untrusted text (FR-20). */
  playerMessage: string | null
  /** Actions the agent has left this stage (FR-12b). Zero means it should yield. */
  actionsRemaining: number
}

/** The action shapes an agent may propose, as a structured-output schema. */
const id = z.string().min(1).max(64)

export const agentActionProposalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('speak'), roomId: id, body: z.string().min(1).max(600), addresseeId: id.nullable() }),
  z.object({ type: z.literal('move_room'), toRoomId: id }),
  z.object({ type: z.literal('open_door'), roomId: id }),
  z.object({ type: z.literal('close_door'), roomId: id }),
  z.object({ type: z.literal('share_evidence'), roomId: id, evidenceId: id }),
  z.object({ type: z.literal('record_private_note'), note: z.string().min(1).max(600) }),
  z.object({ type: z.literal('yield') }),
])

/**
 * The agent's structured reply. `say` is the in-room line; `actions` are *proposals* that still go
 * through the allow-list before the world executes any of them (FR-20). The model is never asked
 * for rationale: unspoken reasoning is exactly the thing that must not exist in a payload (FR-21).
 */
export const agentReplySchema = z.object({
  say: z.string().min(1).max(600),
  actions: z.array(agentActionProposalSchema).max(3),
})
export type AgentReply = z.infer<typeof agentReplySchema>

export const AGENT_PROPOSABLE_ACTIONS = AGENT_ACTION_TYPES
