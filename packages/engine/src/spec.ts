/**
 * The engine runs `AdventureSpec` from `@adventure/spec-v3` (owner: Yi Hao). `EngineSpec` stays as an alias so
 * callers that parse with it keep working; it is the same strict schema.
 */
import { AdventureSpec } from '@adventure/spec-v3'

export { Condition, DOCUMENT_KINDS, checkSpec, validateSpec } from '@adventure/spec-v3'
export type {
  CheckIssue,
  CheckResult,
  SpecAct,
  SpecCharacter,
  SpecDiscovery,
  SpecDocument,
  SpecEnding,
  SpecMoment,
  SpecOutcome,
  SpecStage,
  SpecStoryEvent,
  SpecTrigger,
} from '@adventure/spec-v3'

export const EngineSpec = AdventureSpec
export type EngineSpec = AdventureSpec
