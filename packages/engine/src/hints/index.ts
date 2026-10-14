/**
 * Hints when stuck [P5]. **Owner: Damian.** This is the seam only: the engine calls `evaluateHints` in its
 * rule loop on every step, after the action and the timer. Show a hint with
 * `ctx.say('thought', text)` and `ctx.emit({ type: 'hint', level, targetDiscoveryId })`, and keep
 * `ctx.state.hints.level` current. The engine resets `lastProgressAt` and `level` on every new note or
 * stance change. Never grant a discovery or fire a trigger from here (P5.3).
 */
import type { StepContext } from '../context'

export function evaluateHints(_ctx: StepContext): void {}
