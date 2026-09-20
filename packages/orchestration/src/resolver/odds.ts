/**
 * K7's explainable odds breakdown. Every modifier must trace to something the player could have
 * observed in play: the course's stance, the room's standing, evidence they found, or a character's
 * commitment in front of them. There are no hidden modifiers in this module.
 */
import type { DecisionStance, ResolverAgentView, ResolverInput } from './types'

export type ModifierSource = 'stance' | 'disposition' | 'evidence' | 'agent_stance'

export interface OddsModifier {
  source: ModifierSource
  detail: string
  delta: number
}

export interface Odds {
  base: number
  modifiers: OddsModifier[]
  probability: number
}

/** Starting odds per stance. Deliberately close to even so no course is certain. */
export const STANCE_BASE_PROBABILITY: Record<DecisionStance, number> = {
  cooperative: 0.6,
  neutral: 0.55,
  evasive: 0.5,
  antagonistic: 0.45,
}

/** Odds when the timer expired and nobody committed. Passing is rarely rewarded. */
export const PASS_PROBABILITY = 0.3

/** How a stance moves a stakeholder's standing, before jitter. */
export const STANCE_DISPOSITION: Record<DecisionStance, { success: number; failure: number }> = {
  cooperative: { success: 2, failure: -1 },
  neutral: { success: 1, failure: -1 },
  evasive: { success: 0, failure: -1 },
  antagonistic: { success: -1, failure: -2 },
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const round = (value: number): number => Number(value.toFixed(4))

export function commitmentAlignment(input: ResolverInput, agent: ResolverAgentView): -1 | 0 | 1 {
  if (input.decision === null || agent.commitment === undefined || agent.commitment.how !== 'committed') return 0
  return agent.commitment.optionId === input.decision.optionId ? 1 : -1
}

function stanceModifiers(input: ResolverInput): OddsModifier[] {
  if (input.decision === null) return []

  const raw = [...input.agents]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((agent) => ({ agent, alignment: commitmentAlignment(input, agent) }))
    .filter(({ alignment }) => alignment !== 0)
  if (raw.length === 0) return []

  const total = raw.reduce((sum, entry) => sum + 0.04 * entry.alignment, 0)
  const scale = Math.abs(total) > 0.15 ? 0.15 / Math.abs(total) : 1
  return raw.map(({ agent, alignment }) => ({
    source: 'agent_stance',
    detail: `${agent.name} ${alignment > 0 ? 'backed' : 'opposed'} the course`,
    delta: 0.04 * alignment * scale,
  }))
}

export function playerOdds(input: ResolverInput): Odds {
  const base = input.decision === null ? PASS_PROBABILITY : STANCE_BASE_PROBABILITY[input.decision.stance]
  const meanDisposition =
    input.agents.length === 0 ? 0 : input.agents.reduce((sum, agent) => sum + agent.disposition, 0) / input.agents.length
  const modifiers: OddsModifier[] = [
    {
      source: 'disposition',
      detail: `mean room standing ${meanDisposition}`,
      delta: 0.03 * meanDisposition,
    },
    {
      source: 'evidence',
      detail: `${Math.min(input.evidenceCollected, 4)} evidence found`,
      delta: 0.04 * Math.min(input.evidenceCollected, 4),
    },
    ...stanceModifiers(input),
  ]
  const probability = round(clamp(base + modifiers.reduce((sum, modifier) => sum + modifier.delta, 0), 0.05, 0.95))
  return { base, modifiers, probability }
}
