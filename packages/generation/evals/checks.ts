/**
 * D7 — automated checks over a generated spec. Pure functions so they are unit
 * tested against the I1 fixture and re-run over every eval result.
 *
 * Playability at the *map* level needs the compiler (I2, Yi Hao); until it is
 * wired in through `compile`, the spec-level reachability rules enforced by
 * `validateAdventureSpec` stand in and the check reports `spec-level`.
 */
import { verifyGrounding } from '../src/ingest/spans'
import type { ExtractedDocument } from '../src/ingest/types'
import { GENERATABLE_ASSET_KINDS, MAX_GENERATED_ASSETS } from '../src/spec/catalogue'
import { type AdventureSpec, type ReadingLevel, publicProjection } from '../src/spec/v2'

export const WORD_BUDGET: Record<ReadingLevel['band'], number> = {
  primary: 60,
  'lower-secondary': 120,
  'upper-secondary': 180,
  'pre-university': 220,
}

const FORBIDDEN_PUBLIC_KEYS = ['privateContext', 'knowledgeHorizon', 'hiddenInterests', 'motivations']

export interface SpecChecks {
  grounding: { total: number; resolved: number; ratio: number }
  /** Share of grounded objects that cite at least one document span (vs assumption-only). */
  documentedShare: number
  assumptions: number
  branching: { stages: number; distinctTargetsPerStage: number[]; endings: number; reachableEndings: number; ok: boolean }
  stances: { distinct: string[]; ok: boolean }
  readingLevel: { band: ReadingLevel['band']; budgetWords: number; maxWords: number; overBudget: string[]; ok: boolean }
  assets: { count: number; kinds: Record<string, number>; ok: boolean }
  privateContextLeak: string[]
  playability: { level: 'spec-level' | 'compiled'; ok: boolean; errors: string[] }
  pass: boolean
}

export type Compile = (spec: AdventureSpec) => Promise<{ ok: boolean; errors: string[] }>

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

export async function checkSpec(spec: AdventureSpec, documents: ReadonlyMap<string, ExtractedDocument>, compile?: Compile): Promise<SpecChecks> {
  const grounding = verifyGrounding(spec, documents)

  const groundedObjects = [
    spec.sharedContext,
    ...spec.stakeholders.map((s) => s.summary),
    ...spec.endings.map((e) => e.historicalOutcome),
    ...spec.stages.flatMap((st) => [st.sharedContext, ...st.agents.flatMap((a) => [a.publicPosition, a.privateContext]), ...st.evidence.map((e) => e.content)]),
  ]
  const documentedShare = groundedObjects.filter((g) => g.spans.length > 0).length / groundedObjects.length

  const distinctTargetsPerStage = spec.stages.map((st) => new Set(st.decision.options.map((o) => JSON.stringify(o.branchTarget))).size)
  const reachableEndings = new Set(spec.stages.flatMap((st) => st.decision.options.flatMap((o) => (o.branchTarget.kind === 'ending' ? [o.branchTarget.endingId] : [])))).size
  const branching = {
    stages: spec.stages.length,
    distinctTargetsPerStage,
    endings: spec.endings.length,
    reachableEndings,
    // "provably different endings" (PRD §9.3): ≥2 endings and the final stage really forks
    ok: reachableEndings >= 2 && (distinctTargetsPerStage.at(-1) ?? 0) >= 2,
  }

  const stanceSet = new Set(spec.stages.flatMap((st) => st.decision.options.map((o) => o.stance)))
  const stances = { distinct: [...stanceSet].sort(), ok: stanceSet.size >= 3 }

  const budgetWords = WORD_BUDGET[spec.readingLevel.band]
  const playerFacing: Array<[string, string]> = [
    ...spec.stages.flatMap((st, si) => [
      ...st.agents.map((a, i): [string, string] => [`stages.${si}.agents.${i}.publicPosition`, a.publicPosition.text]),
      ...st.evidence.map((e, i): [string, string] => [`stages.${si}.evidence.${i}.content`, e.content.text]),
      [`stages.${si}.decision.prompt`, st.decision.prompt] as [string, string],
    ]),
    ...spec.endings.map((e, i): [string, string] => [`endings.${i}.summary`, e.summary]),
  ]
  const overBudget = playerFacing.filter(([, text]) => words(text) > budgetWords).map(([path]) => path)
  const readingLevel = {
    band: spec.readingLevel.band,
    budgetWords,
    maxWords: Math.max(...playerFacing.map(([, t]) => words(t))),
    overBudget,
    ok: overBudget.length === 0,
  }

  const kinds: Record<string, number> = {}
  for (const a of spec.assetEligibility) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1
  const assets = {
    count: spec.assetEligibility.length,
    kinds,
    ok: spec.assetEligibility.length <= MAX_GENERATED_ASSETS && Object.keys(kinds).every((k) => (GENERATABLE_ASSET_KINDS as readonly string[]).includes(k)),
  }

  const publicJson = JSON.stringify(publicProjection(spec))
  const privateContextLeak = FORBIDDEN_PUBLIC_KEYS.filter((k) => publicJson.includes(`"${k}"`))

  const playability = compile
    ? { level: 'compiled' as const, ...(await compile(spec)) }
    : { level: 'spec-level' as const, ok: true, errors: [] }

  const pass = grounding.failures.length === 0 && branching.ok && readingLevel.ok && assets.ok && privateContextLeak.length === 0 && playability.ok
  return {
    grounding: { total: grounding.total, resolved: grounding.resolved, ratio: grounding.total ? grounding.resolved / grounding.total : 1 },
    documentedShare,
    assumptions: spec.assumptions.length,
    branching,
    stances,
    readingLevel,
    assets,
    privateContextLeak,
    playability,
    pass,
  }
}

/** PRD §9.1 — two uploads must not produce a reskin. Jaccard over structural features. */
export function structuralSimilarity(a: AdventureSpec, b: AdventureSpec): number {
  const features = (s: AdventureSpec) =>
    new Set([
      ...s.stages.flatMap((st) => st.rooms.map((r) => `room:${r.kind}:${r.name.toLowerCase()}`)),
      ...s.stakeholders.map((st) => `stakeholder:${st.name.toLowerCase()}`),
      ...s.stages.flatMap((st) => st.decision.options.map((o) => `option:${o.label.toLowerCase()}`)),
      ...s.endings.map((e) => `ending:${e.title.toLowerCase()}`),
    ])
  const fa = features(a)
  const fb = features(b)
  const intersection = [...fa].filter((f) => fb.has(f)).length
  return intersection / (fa.size + fb.size - intersection)
}
