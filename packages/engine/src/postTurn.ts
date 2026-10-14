/**
 * The post-turn check, off the chat path (D-3 in the build plan):
 *
 * 1. The API returns the reply from `step(message | insertNote)` straight away.
 * 2. In `after()`, it calls `runPostTurnCheck(spec, state, messageId, { llm })`: one cheap model call over the
 *    snapshot taken with the reply. It reads the state but changes nothing.
 * 3. It applies the result with `step({ action: { type: 'postTurn', messageId, result } })`, reloading and
 *    retrying on a revision conflict. Applying is pure and idempotent: a check whose message is no longer
 *    pending (applied already, or the stage moved on) does nothing.
 *
 * The rules still decide: `conveyed` is intersected with the snapshot, and each discovery's condition is
 * checked again at apply time.
 */
import type { LlmClient } from '@adventure/orchestration'
import { checkExchange, EMPTY_POST_TURN_RESULT, type PostTurnResult } from '@adventure/orchestration/v3'
import { z } from 'zod'

import { evaluate } from './conditions'
import { lookup, type StepContext } from './context'
import type { EngineSpec } from './spec'
import type { EngineState, PostTurnAction } from './state'
import { grantDiscovery } from './rules/knowledge'
import { onChallenged } from './rules/triggers'

export const PostTurnActionSchema = z.strictObject({
  type: z.literal('postTurn'),
  messageId: z.string().min(1),
  result: z.object({
    conveyed: z.array(z.string()),
    assertedUndiscovered: z.boolean(),
    assertion: z.string().nullable(),
    moderation: z.object({
      flagged: z.boolean(),
      category: z.enum(['none', 'abusive', 'hateful', 'provocative', 'sexual', 'self_harm']),
      reason: z.string().nullable(),
    }),
  }),
})

export function pendingCheckIds(state: EngineState): string[] {
  return state.pendingChecks.map((check) => check.messageId)
}

/** Run the model check for one pending reply. No state change; returns the empty result if nothing is pending. */
export async function runPostTurnCheck(spec: EngineSpec, state: EngineState, messageId: string, deps: { llm: LlmClient }): Promise<PostTurnResult> {
  const pending = state.pendingChecks.find((check) => check.messageId === messageId)
  if (pending === undefined) return EMPTY_POST_TURN_RESULT
  const character = spec.characters.find((candidate) => candidate.id === pending.characterId)
  const outcome = await checkExchange(deps.llm, {
    characterName: character?.name ?? pending.characterId,
    roleName: spec.role.name,
    revealable: pending.revealable,
    studentNotes: pending.studentNotes,
    turn: pending.turn,
    reply: pending.reply,
  })
  return outcome.result
}

export function applyPostTurn(ctx: StepContext, action: PostTurnAction): void {
  const { state, spec } = ctx
  const index = state.pendingChecks.findIndex((check) => check.messageId === action.messageId)
  if (index < 0) return
  const [pending] = state.pendingChecks.splice(index, 1)
  if (pending === undefined) return
  ctx.touch()
  const offered = new Set(pending.revealable.map((fact) => fact.id))
  const stageId = spec.stages[state.stageIndex]?.id
  for (const id of action.result.conveyed) {
    if (!offered.has(id)) continue
    const discovery = lookup.discovery(spec, id)
    if (discovery.stageId !== stageId || !evaluate(discovery.condition, { spec, state, now: ctx.now })) continue
    grantDiscovery(ctx, discovery, 'conversation')
  }
  if (action.result.assertedUndiscovered && pending.turn.kind === 'message') onChallenged(ctx, pending.characterId)
  const { moderation } = action.result
  if (moderation.flagged && moderation.category !== 'none') {
    ctx.emit({ type: 'flag', messageId: pending.messageId, category: moderation.category, reason: moderation.reason })
  }
}
