/**
 * Frozen catalogues encoded in the Adventure Spec v2 (EXECUTION_SPEC §2).
 *
 * These lists are contracts, not configuration: the compiler, the renderer and
 * the Resolver all switch on them. Growing one is a group decision.
 */

/** Ambient overlays (PRD D19 / FR-15a). Owner of the id list: Yi Hao. */
export const AMBIENT_OVERLAYS = ['clear', 'clouds', 'rain', 'thunderstorm', 'haze', 'fog', 'night', 'dust', 'snow'] as const
export type AmbientOverlayId = (typeof AMBIENT_OVERLAYS)[number]

/** Curated 16px terrain sets. The original pack remains the default for older adventures. */
export const MAP_THEMES = ['classic', 'desert', 'winter', 'forest', 'coast'] as const
export type MapThemeId = (typeof MAP_THEMES)[number]

/** Narrative art direction, separate from climate. Auto supports previously saved adventures. */
export const MAP_STYLES = ['auto', 'civic', 'harbor', 'village', 'jungle', 'desert', 'industrial', 'winter', 'palace', 'ruins', 'battlefield'] as const
export type MapStyleId = (typeof MAP_STYLES)[number]

/** One-shot scene effects (PRD D19 / FR-15b). Emitted by the Resolver, never by the planner. */
export const SCENE_EFFECTS = [
  'explosion',
  'fire',
  'smoke',
  'confetti',
  'flash',
  'rubble',
  'crowd_cheer',
  'crowd_flee',
] as const
export type SceneEffectId = (typeof SCENE_EFFECTS)[number]

/** OpenAI model tiers (PRD D14). Matches the `model_tier` enum in the Supabase schema. */
export const MODEL_TIERS = ['frontier', 'mid', 'cheap'] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

/**
 * Room kinds the compiler knows how to lay out with curated tiles (PRD D4, FR-6).
 * The planner picks one per room; the compiler owns the geometry and the tileset.
 */
export const ROOM_KINDS = [
  'hall',
  'chamber',
  'office',
  'archive',
  'market',
  'street',
  'courtyard',
  'dock',
  'warehouse',
  'camp',
  'field',
  'chapel',
  'kitchen',
  'cell',
] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

export const ROOM_SIZES = ['small', 'medium', 'large'] as const
export type RoomSize = (typeof ROOM_SIZES)[number]

/**
 * The ONLY asset kinds that may be generated (PRD D4 / FR-6 / FR-6b).
 * Terrain, structural and UI art are curated and are deliberately absent from
 * this list, so a spec that asks for them fails schema validation.
 */
export const GENERATABLE_ASSET_KINDS = ['portrait', 'landmark', 'prop', 'sprite', 'cover', 'cutscene'] as const
export type GeneratableAssetKind = (typeof GENERATABLE_ASSET_KINDS)[number]

/** Curated placeholders every generated asset falls back to (FR-6a). */
export const CURATED_PLACEHOLDERS = {
  portrait: 'placeholder-portrait',
  landmark: 'placeholder-landmark',
  prop: 'placeholder-prop',
  sprite: 'placeholder-generic',
  cover: 'placeholder-generic',
  cutscene: 'placeholder-generic',
} as const satisfies Record<GeneratableAssetKind, string>

/** Fallback for anything that is not a generatable kind (defence in depth). */
export const GENERIC_PLACEHOLDER = 'placeholder-generic'

/** Which spec entity each generatable asset kind may attach to. `cover` is adventure-level card/key art, not gameplay art. */
export const ASSET_KIND_ENTITY = {
  portrait: 'stakeholder',
  landmark: 'room',
  prop: 'evidence',
  sprite: 'stakeholder',
  cover: 'adventure',
  cutscene: 'stage',
} as const satisfies Record<GeneratableAssetKind, 'stakeholder' | 'room' | 'evidence' | 'adventure' | 'stage'>

/** Decision stances, used by the eval harness to prove branching (PRD §9.3). */
export const DECISION_STANCES = ['cooperative', 'antagonistic', 'neutral', 'evasive'] as const
export type DecisionStance = (typeof DECISION_STANCES)[number]

/** Reading-level bands (FR-1a). The teacher supplies one; the planner writes to it. */
export const READING_BANDS = ['primary', 'lower-secondary', 'upper-secondary', 'pre-university'] as const
export type ReadingBand = (typeof READING_BANDS)[number]

export const SOURCE_KINDS = ['pdf', 'text'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
