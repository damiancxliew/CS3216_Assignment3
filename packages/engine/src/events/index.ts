/**
 * Story events [G11, P12, P14]. **Owner: Damian.** This is the seam only: the engine calls
 * `evaluateStoryEvents` in its rule loop on every step. Fire each event once (record it in
 * `ctx.state.firedStoryEvents`), emit `{ type: 'storyEvent', eventId }`, and call `ctx.touch()` when anything
 * changes so the loop re-runs. Effects stay within the fixed list (P14.1). Use `evaluate` from
 * `../conditions` for conditions, `openMoment` from `../rules/moment` for "the defining moment begins", and
 * move characters by setting `ctx.state.characters[id].roomId`. The final call on timer expiry is already
 * handled by the engine (`rules/stages.ts`).
 */
import type { StepContext } from '../context'

export function evaluateStoryEvents(_ctx: StepContext): void {}
