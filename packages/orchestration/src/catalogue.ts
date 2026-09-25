/**
 * Frozen catalogues the orchestration slice validates against (PRD D19 / FR-15a / FR-15b).
 *
 * These ids are owned by the renderer slice (I2, Yi Hao). They are duplicated here as data so the
 * Resolver can enforce them without depending on a package that is not on `main` yet; a later
 * addition to the list is a one-line data change, not a refactor. The values are byte-identical to
 * the catalogue in the Adventure Spec v2 (I1) and the Turn API contract (I3).
 */

/** Ambient overlays, one per stage (FR-15a). */
export const AMBIENT_OVERLAYS = ['clear', 'clouds', 'rain', 'thunderstorm', 'haze', 'fog', 'night', 'dust', 'snow'] as const
export type AmbientOverlayId = (typeof AMBIENT_OVERLAYS)[number]

/** One-shot scene effects the Resolver may emit (FR-15b). Cosmetic only: they never change state. */
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

export function isSceneEffectId(value: unknown): value is SceneEffectId {
  return typeof value === 'string' && (SCENE_EFFECTS as readonly string[]).includes(value)
}

export function isAmbientOverlayId(value: unknown): value is AmbientOverlayId {
  return typeof value === 'string' && (AMBIENT_OVERLAYS as readonly string[]).includes(value)
}

/**
 * Text equivalent of every effect (FR-15c): the accessible path and the transcript must lose no
 * information when the animation is skipped or `prefers-reduced-motion` is set.
 */
export const EFFECT_TEXT: Record<SceneEffectId, string> = {
  explosion: 'A blast tears through the scene.',
  fire: 'Flames take hold and spread.',
  smoke: 'Thick smoke drifts across the scene.',
  confetti: 'Celebration erupts, paper streamers in the air.',
  flash: 'A sudden flash of light.',
  rubble: 'Masonry collapses into rubble.',
  crowd_cheer: 'The crowd cheers.',
  crowd_flee: 'The crowd scatters and flees.',
}
