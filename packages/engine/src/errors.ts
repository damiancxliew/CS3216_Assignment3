/**
 * An action the rules refuse. The API maps it to a 4xx; the state is unchanged. Model failures are
 * never thrown as this: a broken reply degrades inside the step instead.
 */
export const ENGINE_ERROR_CODES = [
  'illegal_phase',
  'unknown_id',
  'not_present',
  'not_held',
  'act_unavailable',
  'pending',
  'invalid_action',
  'preparation_required',
] as const
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number]

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}
