/**
 * C0/C2 from the generation side: I1 fixture -> orchestration runtime (K1-K7) -> ending, with no
 * LLM. Uses the real functions from packages/orchestration; the only fakes are Kevin's own
 * FakeLlmClient (agents yield) and fakeResolver.
 */
import { describe, expect, it } from 'vitest'

import {
  FakeLlmClient,
  MAX_AGENT_DELTAS,
  StageDecisions,
  applyAction,
  buildAgentTurnInput,
  createWorld,
  deriveOptions,
  fakeResolver,
  runStage,
  type WorldState,
} from '../../../orchestration/src/index'
import { loadI1Spec } from '../../src/fixtures'
import { PLAYER_ID, toResolverInput, toStageRuntime } from '../../src/runtime/adapter'
import { MAX_AGENTS_PER_STAGE, type AdventureSpec } from '../../src/spec/v2'

const yieldingClient = () => new FakeLlmClient({ replies: [JSON.stringify({ say: '', actions: [{ type: 'yield' }] })] })

/** The player walks to each evidence item's room and learns it — what interacting with it does in the client. */
function collectEvidence(world: WorldState, spec: AdventureSpec, stageIndex: number): number {
  const stage = spec.stages[stageIndex]!
  for (const item of stage.evidence) {
    applyAction(world, { actorKind: 'player', actorId: PLAYER_ID, action: { type: 'move_room', toRoomId: item.roomId } })
    world.evidenceKnown[PLAYER_ID] = [...new Set([...(world.evidenceKnown[PLAYER_ID] ?? []), item.id])]
  }
  return stage.evidence.length
}

describe('spec -> runtime adapter', () => {
  it('never authors more agents per stage than the resolver can report deltas for (I4 cap)', () => {
    expect(MAX_AGENTS_PER_STAGE).toBeLessThanOrEqual(MAX_AGENT_DELTAS)
  })

  it('seeds a world from stage 0 of the fixture', async () => {
    const spec = await loadI1Spec()
    const bundle = toStageRuntime(spec, 0)
    const world = createWorld(bundle.world)
    expect(Object.keys(world.rooms).sort()).toEqual(['landing-beach', 'ship-cabin', 'temenggong-hall'])
    expect(world.rooms['ship-cabin']!.doorOpen).toBe(false)
    expect(world.rooms['temenggong-hall']!.description).toContain("The Temenggong's dais")
    expect(Object.values(world.actors).filter((a) => a.kind === 'agent')).toHaveLength(3)
    expect(world.actors[PLAYER_ID]).toMatchObject({ kind: 'player', name: 'Ahmad bin Yusof' })
    expect(world.location[PLAYER_ID]).toBe('landing-beach')
    expect(world.location['agent-raffles-s0']).toBe('ship-cabin')
    expect(world.actors['agent-temenggong-s0']!.publicRole).toBe('Administrator of Singapore on behalf of the Sultan of Johor')
  })

  it('maps evidence-based preconditions and reports the ones the runtime cannot express', async () => {
    const spec = await loadI1Spec()
    const bundle = toStageRuntime(spec, 0)
    const signOption = bundle.options.find((o) => o.id === 'opt-sign-preliminary')!
    // the decision.requires gate (read instructions) is expressible; "meet the Temenggong" is not
    expect(signOption.preconditions).toContainEqual({ kind: 'knows_evidence', actorId: PLAYER_ID, evidenceId: 'ev-instructions' })
    expect(bundle.warnings.some((w) => w.includes('obj-meet-temenggong') && w.includes('spoke_with'))).toBe(true)
    expect(bundle.fallbackNext).toEqual({ kind: 'stage', stageId: 'stage-sultan' }) // the evasive option
  })

  it("an agent's turn input carries its own private context and nobody else's (K2/FR-21)", async () => {
    const spec = await loadI1Spec()
    const bundle = toStageRuntime(spec, 0)
    const world = createWorld(bundle.world)
    const config = { ...bundle.stage }
    const input = buildAgentTurnInput(world, 'agent-farquhar-s0', config, 3)
    const json = JSON.stringify(input)
    expect(json).toContain('Privately thinks Raffles underestimates the Dutch') // own hiddenInterests
    expect(json).not.toContain('fears the Sultan in Riau will repudiate') // Temenggong's
    expect(json).not.toContain('stretching his instructions from Hastings') // Raffles'
    expect(input.sharedContext).toBe(spec.sharedContext.text)
  })
})

describe('I1 fixture -> K4 stage loop -> K6 options -> K1/K7 resolver -> ending (no LLM)', () => {
  it('plays every stage of the fixture through the real runtime to an ending', async () => {
    const spec = await loadI1Spec()
    const path: string[] = []
    let stageIndex: number | null = 0
    let endingId: string | null = null
    const dispositions: Record<string, number> = {}

    while (stageIndex !== null) {
      const bundle = toStageRuntime(spec, stageIndex)
      const world = createWorld(bundle.world)
      const ledger = new StageDecisions([{ actorId: PLAYER_ID, actorKind: 'player' }])

      // agents tick autonomously (they all yield here) — the loop must not consume the player's decision
      const run = await runStage(yieldingClient(), world, { ...bundle.stage, decision: { catalogue: bundle.options, ledger }, maxTicks: 2 })
      expect(run.telemetry.stoppedBy).toBe('all_yielded')
      expect(run.telemetry.decisions).toEqual([])

      // before evidence is collected the gated options are off the table (FR-14)
      const before = deriveOptions(world, bundle.options, PLAYER_ID)
      const gated = bundle.options.filter((o) => o.preconditions.length > 0).map((o) => o.id)
      for (const id of gated) expect(before.options.map((o) => o.id)).not.toContain(id)

      const evidenceCollected = collectEvidence(world, spec, stageIndex)
      const after = deriveOptions(world, bundle.options, PLAYER_ID)
      expect(after.options.map((o) => o.id).sort()).toEqual(bundle.options.map((o) => o.id).sort())
      expect(JSON.stringify(after)).not.toContain('preconditions') // public projection only

      // a stale option set is rejected, a fresh one commits (only meaningful where something was gated;
      // a stage whose gates are all "speak with X" has no expressible precondition yet — see bundle.warnings)
      if (gated.length > 0) {
        const stale = ledger.commit(world, bundle.options, { actorId: PLAYER_ID, actorKind: 'player', optionId: after.options[0]!.id, optionsVersion: before.version })
        expect(stale.ok).toBe(false)
      } else {
        expect(bundle.warnings.some((w) => w.includes('spoke_with'))).toBe(true)
      }
      const chosen = after.options[0]!.id
      const commit = ledger.commit(world, bundle.options, { actorId: PLAYER_ID, actorKind: 'player', optionId: chosen, optionsVersion: after.version })
      expect(commit.ok).toBe(true)
      path.push(chosen)

      const resolution = await fakeResolver.resolveStage(
        toResolverInput(spec, bundle, { attemptId: 'attempt-1', seed: 'seed-1', resolvedAt: '2026-09-21T00:00:00.000Z', optionId: chosen, actions: [], evidenceCollected, dispositions }),
      )
      const { outcome } = resolution.record
      expect(outcome.announcement.length).toBeGreaterThan(0)
      expect(JSON.stringify(outcome)).not.toContain('"roll"')
      for (const delta of outcome.agentDeltas) dispositions[delta.agentId] = (dispositions[delta.agentId] ?? 0) + (delta.dispositionDelta ?? 0)

      const target = spec.stages[stageIndex]!.decision.options.find((o) => o.id === chosen)!.branchTarget
      expect(outcome.next).toEqual(target)
      if (outcome.next.kind === 'ending') {
        endingId = outcome.next.endingId
        stageIndex = null
      } else if (outcome.next.kind === 'stage') {
        const nextStageId = outcome.next.stageId
        stageIndex = spec.stages.findIndex((s) => s.id === nextStageId)
        expect(stageIndex).toBeGreaterThan(0)
      } else {
        throw new Error('fake resolver asked to continue a stage')
      }
    }

    expect(path).toHaveLength(3)
    expect(spec.endings.map((e) => e.id)).toContain(endingId)
  })

  it('timer expiry resolves from the spec-authored fallback (D12/FR-16)', async () => {
    const spec = await loadI1Spec()
    const bundle = toStageRuntime(spec, 1)
    const resolution = await fakeResolver.resolveStage(
      toResolverInput(spec, bundle, { attemptId: 'attempt-2', seed: 'seed-2', resolvedAt: '2026-09-21T00:00:00.000Z', optionId: null, actions: [], evidenceCollected: 0 }),
    )
    expect(resolution.record.outcome.next).toEqual(bundle.fallbackNext)
    expect(bundle.fallbackNext).toEqual({ kind: 'ending', endingId: 'end-riau-refusal' })
  })
})
