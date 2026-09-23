/**
 * The narrow seam between this package and OpenAI (PRD D14).
 *
 * Nothing here imports the SDK: the runtime talks to an `LlmClient`, so every test in this package
 * runs with a deterministic fake and CI never needs a key. The real client is a thin adapter that
 * calls OpenAI structured outputs with the JSON schema `callStructured` hands it.
 */

/** Model tiers (D14). Mirrored from the Adventure Spec v2 catalogue. */
export const MODEL_TIERS = ['frontier', 'mid', 'cheap'] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

/** Which tier each call site uses. Tiering per call is where the cost control lives, not a router. */
export const TIER_BY_ROLE = {
  resolver: 'frontier',
  planner: 'frontier',
  characterAgent: 'mid',
  incidental: 'cheap',
} as const satisfies Record<string, ModelTier>

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'
export type TextVerbosity = 'low' | 'medium' | 'high'
export type ServiceTier = 'auto' | 'default' | 'fast' | 'priority'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  cachedPromptTokens?: number
  reasoningTokens?: number
}

export interface LlmRequest {
  modelTier: ModelTier
  /** Instructions. The only text in the call that is allowed to be an instruction (FR-20). */
  system: string
  /** Data. Everything derived from sources, players or agents arrives here, delimited. */
  user: string
  /** Name of the structured-output schema, for the provider and for telemetry. */
  schemaName: string
  /** JSON Schema of the expected response, for OpenAI structured outputs. */
  jsonSchema: unknown
  reasoningEffort?: ReasoningEffort
  verbosity?: TextVerbosity
  maxOutputTokens?: number
  serviceTier?: ServiceTier
}

export interface LlmResponse {
  /** Raw JSON text. Never trusted: `callStructured` validates it before anything reads it. */
  content: string
  usage: TokenUsage
  model?: string
  latencyMs?: number
  serviceTier?: string
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>
}
