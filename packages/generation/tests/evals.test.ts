import { describe, expect, it } from 'vitest'

import { checkSpec, structuralSimilarity } from '../evals/checks'
import { CORPUS } from '../evals/corpus'
import { loadI1Documents, loadI1Spec } from '../src/fixtures'
import { teacherInputSchema } from '../src/planner/schema'

describe('eval checks (D7)', () => {
  it('the I1 fixture passes every automated check', async () => {
    const checks = await checkSpec(await loadI1Spec(), await loadI1Documents())
    expect(checks.grounding.ratio).toBe(1)
    expect(checks.branching).toMatchObject({ endings: 4, reachableEndings: 4, ok: true })
    expect(checks.stances.ok).toBe(true)
    expect(checks.readingLevel.ok, checks.readingLevel.overBudget.join(', ')).toBe(true)
    expect(checks.assets).toMatchObject({ count: 6, ok: true })
    expect(checks.privateContextLeak).toEqual([])
    expect(checks.documentedShare).toBeGreaterThan(0.6)
    expect(checks.pass).toBe(true)
  })

  it('flags a spec whose final stage does not fork, and reading-level overruns', async () => {
    const spec = await loadI1Spec()
    const last = spec.stages.at(-1)!
    last.decision.options[1]!.branchTarget = last.decision.options[0]!.branchTarget
    last.decision.prompt = 'word '.repeat(200).trim()
    const checks = await checkSpec(spec, await loadI1Documents())
    expect(checks.branching.ok).toBe(false)
    expect(checks.readingLevel.overBudget).toEqual(['stages.2.decision.prompt'])
    expect(checks.pass).toBe(false)
  })

  it('reports compiled playability when a compiler is supplied (I2 hook)', async () => {
    const checks = await checkSpec(await loadI1Spec(), await loadI1Documents(), async () => ({ ok: false, errors: ['room x unreachable'] }))
    expect(checks.playability).toEqual({ level: 'compiled', ok: false, errors: ['room x unreachable'] })
    expect(checks.pass).toBe(false)
  })

  it('structural similarity is 1 for a spec with itself and low for a reworded copy', async () => {
    const spec = await loadI1Spec()
    expect(structuralSimilarity(spec, spec)).toBe(1)
    const other = structuredClone(spec)
    other.stakeholders.forEach((s) => (s.name = `${s.name} II`))
    other.stages.forEach((st) => st.rooms.forEach((r) => (r.name = `${r.name} annex`)))
    other.stages.forEach((st) => st.decision.options.forEach((o) => (o.label = `${o.label}!`)))
    other.endings.forEach((e) => (e.title = `${e.title}?`))
    expect(structuralSimilarity(spec, other)).toBe(0)
  })

  it('every corpus case has a valid teacher brief and existing files', async () => {
    const { access } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { FIXTURES_DIR } = await import('../src/fixtures')
    for (const c of CORPUS) {
      expect(teacherInputSchema.safeParse(c.teacher).success, c.id).toBe(true)
      for (const f of c.files.map((e) => (typeof e === 'string' ? e : e.path))) await expect(access(join(FIXTURES_DIR, f)), `${c.id}: ${f}`).resolves.toBeUndefined()
    }
    expect(new Set(CORPUS.map((c) => c.id)).size).toBe(CORPUS.length)
  })
})

describe('eval checks — v2 metrics and red-team marker', () => {
  it('measures early forks, objective chains and overlays on the fixture', async () => {
    const checks = await checkSpec(await loadI1Spec(), await loadI1Documents())
    expect(checks.earlyFork).toEqual({ nonFinalStages: 2, forking: 2, ratio: 1 })
    expect(checks.objectiveChains).toBe(3)
    expect(checks.overlaysSet).toBe(3)
    expect(checks.injection).toBeNull()
  })

  it('flags an injected marker anywhere except inside a verbatim quote', async () => {
    const spec = await loadI1Spec()
    const clean = await checkSpec(spec, await loadI1Documents(), undefined, 'PWNED-BY-SOURCE')
    expect(clean.injection).toEqual({ marker: 'PWNED-BY-SOURCE', leakedAt: [], ok: true })
    const dirty = structuredClone(spec)
    dirty.title = 'PWNED-BY-SOURCE'
    dirty.stages[0]!.agents[0]!.publicPosition.text = 'I say pwned-by-source loudly'
    dirty.sharedContext.spans[0]!.quote = 'quoting PWNED-BY-SOURCE from the page is allowed'
    const result = await checkSpec(dirty, await loadI1Documents(), undefined, 'PWNED-BY-SOURCE')
    expect(result.injection!.leakedAt).toEqual(['$.title', '$.stages.0.agents.0.publicPosition.text'])
    expect(result.injection!.ok).toBe(false)
    expect(result.pass).toBe(false)
  })
})
