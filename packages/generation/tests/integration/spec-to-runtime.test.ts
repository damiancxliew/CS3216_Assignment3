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

/** The player visits every character and hears them say something — what "talk to X" objectives need (K6 heard_from). */
function hearEveryone(world: WorldState, spec: AdventureSpec, stageIndex: number): void {
  const stage = spec.stages[stageIndex]!
  for (const agent of stage.agents) {
    const roomId = world.location[agent.id]!
    if (!world.rooms[roomId]!.doorOpen) applyAction(world, { actorKind: 'agent', actorId: agent.id, action: { type: 'open_door', roomId } })
    applyAction(world, { actorKind: 'player', actorId: PLAYER_ID, action: { type: 'move_room', toRoomId: roomId } })
    applyAction(world, { actorKind: 'agent', actorId: agent.id, action: { type: 'speak', roomId, body: 'You have my attention.', addresseeId: PLAYER_ID } })
  }
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

  it('opens a closed room nobody starts in, rather than seeding a world the runtime rejects', async () => {
    const spec = structuredClone(await loadI1Spec()) as AdventureSpec
    const stage = spec.stages[0]!
    for (const agent of stage.agents) if (agent.startRoomId === 'ship-cabin') agent.startRoomId = stage.spawnRoomId
    const bundle = toStageRuntime(spec, 0)
    const world = createWorld(bundle.world)
    expect(world.rooms['ship-cabin']!.doorOpen).toBe(true)
    expect(bundle.warnings.some((w) => w.includes('ship-cabin'))).toBe(true)
  })

  it('maps evidence-based preconditions and reports the ones the runtime cannot express', async () => {
    const spec = await loadI1Spec()
    const bundle = toStageRuntime(spec, 0)
    const signOption = bundle.options.find((o) => o.id === 'opt-sign-preliminary')!
    // the decision.requires gate (read instructions) and "meet the Temenggong" are both expressible (K6)
    expect(signOption.preconditions).toContainEqual({ kind: 'knows_evidence', actorId: PLAYER_ID, evidenceId: 'ev-instructions' })
    expect(signOption.preconditions).toContainEqual({ kind: 'heard_from', actorId: PLAYER_ID, speakerId: 'agent-temenggong-s0' })
    expect(bundle.warnings.some((w) => w.includes('dropped'))).toBe(false)
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

  it("carries each agent's K6 ledger entry into the resolver as its commitment (K7)", async () => {
    const spec = await loadI1Spec()
    const bundle = toStageRuntime(spec, 0)
    const ledger = new StageDecisions([
      { actorId: PLAYER_ID, actorKind: 'player' },
      ...bundle.resolverAgents.map((a) => ({ actorId: a.id, actorKind: 'agent' as const })),
    ])
    expect(ledger.pass('agent-farquhar-s0').ok).toBe(true)
    const timedOut = ledger.expire().map((d) => d.actorId)
    expect(timedOut).toEqual(expect.arrayContaining([PLAYER_ID, 'agent-temenggong-s0', 'agent-raffles-s0']))

    const decisions = ledger.all().map((d) => (d.actorId === 'agent-raffles-s0' ? { ...d, optionId: 'opt-land-troops', how: 'committed' as const } : d))
    const parts = { attemptId: 'attempt-1', seed: 'seed-1', resolvedAt: '2026-09-21T00:00:00.000Z', optionId: 'opt-land-troops', actions: [], evidenceCollected: 0 }
    const input = toResolverInput(spec, bundle, { ...parts, decisions })
    const byId = Object.fromEntries(input.agents.map((a) => [a.id, a.commitment]))
    expect(byId).toEqual({
      'agent-farquhar-s0': { optionId: null, how: 'passed' },
      'agent-temenggong-s0': { optionId: null, how: 'timed_out' },
      'agent-raffles-s0': { optionId: 'opt-land-troops', how: 'committed' },
    })
    expect(input.agents.map((a) => a.id)).not.toContain(PLAYER_ID) // the player's own entry is the decision, not a commitment

    // without a ledger nothing is invented, and the resolver still accepts the input either way
    expect(toResolverInput(spec, bundle, parts).agents.every((a) => a.commitment === undefined)).toBe(true)
    const { record } = await fakeResolver.resolveStage(input)
    expect(record.rationale).toContain('agent_stance')
    expect(JSON.stringify(record.outcome)).not.toContain('agent_stance')
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
      hearEveryone(world, spec, stageIndex)
      const after = deriveOptions(world, bundle.options, PLAYER_ID)
      expect(after.options.map((o) => o.id).sort()).toEqual(bundle.options.map((o) => o.id).sort())
      expect(JSON.stringify(after)).not.toContain('preconditions') // public projection only

      // a stale option set is rejected, a fresh one commits
      expect(gated.length).toBeGreaterThan(0)
      const stale = ledger.commit(world, bundle.options, { actorId: PLAYER_ID, actorKind: 'player', optionId: after.options[0]!.id, optionsVersion: before.version })
      expect(stale.ok).toBe(false)
      const chosen = after.options[0]!.id
      const commit = ledger.commit(world, bundle.options, { actorId: PLAYER_ID, actorKind: 'player', optionId: chosen, optionsVersion: after.version })
      expect(commit.ok).toBe(true)
      path.push(chosen)

      const resolution = await fakeResolver.resolveStage(
        toResolverInput(spec, bundle, { attemptId: 'attempt-1', seed: 'seed-1', resolvedAt: '2026-09-21T00:00:00.000Z', optionId: chosen, actions: [], evidenceCollected, dispositions, decisions: ledger.all() }),
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
