import { z } from 'zod'

/** Every id in the contract is an adventure-scoped string from the spec or the engine. */
export const Id = z.string().min(1).max(120)

/** Epoch milliseconds, as passed to `engine.step` in `now`. */
export const Timestamp = z.number().int().nonnegative()

export const StageIndex = z.number().int().nonnegative()
