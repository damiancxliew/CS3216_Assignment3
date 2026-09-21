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
import type { PublicOption } from '../stage/options'

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

/** One thing a human said to this character, awaiting an answer. */
export interface AddressedLine {
  speakerId: string
  speakerName: string
  body: string
}

export interface TranscriptLine {
  speakerId: string
  speakerName: string
  body: string
}

/** A line the agent heard in some other room, earlier. Carries the room so recall stays honest. */
export interface RecalledLine extends TranscriptLine {
  roomName: string
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
  /** Earlier lines from other rooms this agent was standing in at the time (K3). */
  recalled?: readonly RecalledLine[]
  /** What the player just said in this room, if anything. Untrusted text (FR-20). */
  playerMessage: string | null
  /**
   * Several humans spoke to this character before it could answer. They are put to it together so
   * one reply serves the room, rather than each speaker being answered in turn. Untrusted text.
   */
  addressedBy?: readonly AddressedLine[] | undefined
  /** Actions the agent has left this stage (FR-12b). Zero means it should yield. */
  actionsRemaining: number
  /**
   * The decision options live right now (K6). Agents decide under the player's rules, so they see
   * the same list and the same labels; the version is stamped on their commit by the runtime, not
   * by the model, so a stale commit is caught rather than invented.
   */
  options?: readonly PublicOption[] | undefined
  /** Every human has decided: the stage is waiting on this agent alone, so it must decide now. */
  mustDecide?: boolean
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
  // No `optionsVersion`: the runtime stamps the version of the list it actually showed this agent.
  z.object({ type: z.literal('commit_decision'), optionId: id }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('yield') }),
])

/**
 * The agent's structured reply. `say` is the in-room line, empty when the character stays silent;
 * `actions` are *proposals* that still go
 * through the allow-list before the world executes any of them (FR-20). The model is never asked
 * for rationale: unspoken reasoning is exactly the thing that must not exist in a payload (FR-21).
 */
export const agentReplySchema = z.object({
  say: z.string().max(600),
  actions: z.array(agentActionProposalSchema).max(3),
})
export type AgentReply = z.infer<typeof agentReplySchema>

export const AGENT_PROPOSABLE_ACTIONS = AGENT_ACTION_TYPES
