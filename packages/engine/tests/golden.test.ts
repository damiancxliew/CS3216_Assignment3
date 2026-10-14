import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PlayerView } from '@adventure/play-contract'
import { describe, expect, it } from 'vitest'

import { EngineSpec } from '../src'
import { explore, leakIssues, minOpenAtFinal } from './fixtures/explorer'
import { Harness } from './fixtures/harness'
import { mini } from './fixtures/mini'
import { referenceIssues } from './fixtures/refs'

const ROOT = resolve(import.meta.dirname, '../../..')
const golden = EngineSpec.parse(JSON.parse(readFileSync(resolve(ROOT, 'fixtures/golden-1819.json'), 'utf8')))

/** Same tolerance as ingest's quote check: whitespace, quotes and dashes normalised, still a substring match. */
function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const SOURCES: Record<string, string> = {
  'Treaty of Friendship and Alliance, Singapore, 6 February 1819': 'fixtures/sources/treaty-1819-wikisource.txt',
}

describe('golden-1819: content', () => {
  it('is a valid spec whose every reference resolves', () => {
    expect(referenceIssues(golden)).toEqual([])
  })

  it('has the shape the PRD asks for', () => {
    expect(golden.stages).toHaveLength(2)
    for (const stage of golden.stages) {
      const discoveries = golden.discoveries.filter((discovery) => discovery.stageId === stage.id)
      const core = discoveries.filter((discovery) => discovery.core)
      expect(discoveries.length, stage.id).toBeGreaterThanOrEqual(5)
      expect(discoveries.length, stage.id).toBeLessThanOrEqual(8)
      expect(core.length, stage.id).toBeGreaterThanOrEqual(2)
      expect(core.length, stage.id).toBeLessThanOrEqual(3)
      // Core discoveries come only from major characters or documents (G5.3), and are never invented (G13).
      for (const discovery of core) {
        if ('characterId' in discovery.holder) {
          const holderId = discovery.holder.characterId
          expect(golden.characters.find((character) => character.id === holderId)?.tier, discovery.id).toBe('major')
        }
        expect(discovery.sourceLabel, discovery.id).not.toBe('invented')
      }
    }
    const types = golden.endings.map((ending) => ending.type)
    expect(types.filter((type) => type === 'historical')).toHaveLength(1)
    expect(types.filter((type) => type === 'alternative').length).toBeGreaterThanOrEqual(2)
    expect(types.filter((type) => type === 'secret').length).toBeLessThanOrEqual(1)
    expect(golden.timer.stageMinutes.reduce((sum, minutes) => sum + minutes, 0)).toBe(30)
  })

  it('quotes every real document word for word from its saved source (G13.2, G13.5)', () => {
    const real = golden.documents.filter((document) => document.real)
    expect(real.length).toBeGreaterThan(0)
    for (const document of real) {
      const path = SOURCES[document.sourceLabel]
      expect(path, `no saved source for "${document.sourceLabel}"`).toBeDefined()
      const source = normalise(readFileSync(resolve(ROOT, path as string), 'utf8'))
      const segments = document.body
        .split(/…|\n\n/)
        .map((segment) => segment.replace(/^\s*Article \w+\.\s*/, '').trim())
        .filter((segment) => segment.length > 0)
      for (const segment of segments) expect(source.includes(normalise(segment)), `${document.id}: "${segment.slice(0, 50)}…"`).toBe(true)
    }
  })

  it('is up to date with its build script', async () => {
    const { execFileSync } = await import('node:child_process')
    expect(() => execFileSync('npx', ['vite-node', 'packages/engine/scripts/golden-1819.ts', '--check'], { cwd: ROOT, stdio: 'pipe' })).not.toThrow()
  }, 60_000)
})

describe('golden-1819: the historical path plays from briefing to reveal', () => {
  it('reaches the historical ending through the rules a student would use', async () => {
    const game = new Harness(golden)
    expect(PlayerView.parse(await game.start()).stage?.centralQuestion).toBe('Will the Temenggong let the Company stay, and on whose authority?')

    // Stage 1: read the Riau letter, confront the Temenggong's slant, learn the throne is disputed.
    await game.act({ type: 'enterRoom', roomId: 'balai' })
    await game.say('temenggong', 'Who rules this island?', { conveyed: ['d1-not-sovereign'] })
    await game.act({ type: 'openDocument', documentId: 'doc-riau-letter' })
    const letter = golden.documents.find((document) => document.id === 'doc-riau-letter')
    const passage = letter?.keyPassages[0]
    await game.act({ type: 'selectPassage', documentId: 'doc-riau-letter', start: passage?.start ?? 0, end: passage?.end ?? 1 })
    await game.act({ type: 'closeDocument', documentId: 'doc-riau-letter' })
    await game.act({ type: 'insertNote', characterId: 'temenggong', noteId: game.noteFor('d1-riau-claim') })
    expect(game.state.characters.temenggong?.stanceId).toBe('t2')
    await game.check({ conveyed: ['d1-throne'] })
    expect(game.state.discovered).toContain('d1-throne')
    await game.act({ type: 'openDocument', documentId: 'doc-prelim' })
    const prelim = golden.documents.find((document) => document.id === 'doc-prelim')?.keyPassages[0]
    await game.act({ type: 'selectPassage', documentId: 'doc-prelim', start: prelim?.start ?? 0, end: prelim?.end ?? 1 })

    const moment = await game.act({ type: 'endStage' })
    expect(moment.definingMoment?.nudge).toBeNull()
    expect(moment.definingMoment?.acts.map((act) => act.id)).toEqual(['a1-faithful', 'a1-protection', 'a1-warn', 'a1-deceive'])
    await game.act({ type: 'act', actId: 'a1-faithful' })
    const stage2 = await game.act({ type: 'predict', outcomeId: 'o1-sends' })
    expect(stage2.stage?.intro?.predictionReveal).toMatchObject({ actual: 'The Temenggong signed the preliminary articles and sent for Tengku Hussein.' })
    await game.act({ type: 'continue' })

    // Stage 2: hear Hussein's claim, pass it to Raffles, learn his plan.
    await game.act({ type: 'enterRoom', roomId: 'lodging' })
    await game.say('hussein', 'What do you want from the British?', { conveyed: ['d2-hussein-claim'] })
    await game.act({ type: 'enterRoom', roomId: 'landing' })
    await game.act({ type: 'insertNote', characterId: 'raffles', noteId: game.noteFor('d2-hussein-claim') })
    expect(game.state.characters.raffles?.stanceId).toBe('r2')
    await game.check({ conveyed: ['d2-raffles-plan'] })
    await game.act({ type: 'openDocument', documentId: 'doc-treaty' })
    const force = golden.documents.find((document) => document.id === 'doc-treaty')?.keyPassages[0]
    await game.act({ type: 'selectPassage', documentId: 'doc-treaty', start: force?.start ?? 0, end: force?.end ?? 1 })
    expect(game.state.discovered).toEqual(expect.arrayContaining(['d2-hussein-claim', 'd2-raffles-plan', 'd2-no-force']))

    const final = await game.act({ type: 'endStage' })
    expect(final.definingMoment?.acts.map((act) => act.id)).toEqual(['a2-recognise', 'a2-calcutta', 'a2-alone'])
    await game.act({ type: 'act', actId: 'a2-recognise' })
    const epilogue = await game.act({ type: 'predict', outcomeId: 'o2-treaty' })
    expect(epilogue.epilogue?.title).toBe('The treaty of 6 February')

    await game.act({ type: 'continue' })
    await game.act({ type: 'interviewAnswer', verdictId: 'v-fair', evidenceNoteIds: [game.noteFor('d2-raffles-plan')] })
    expect(game.view?.interview?.pushBack).toContain('The treaty protects the Sultan')
    await game.act({ type: 'interviewAnswer', verdictId: 'v-partly', evidenceNoteIds: [] })
    const reveal = PlayerView.parse(await game.act({ type: 'continue' }))
    expect(reveal.reveal?.pathVsHistory.map((row) => row.matched)).toEqual([true, true])
    expect(reveal.reveal?.more.secretPathExisted).toBe(true)
    expect(reveal.ended).toBe(true)
  })
})

describe('reachability and leaks', () => {
  it('the leak check catches hidden content when it does reach a view', async () => {
    const game = new Harness(golden)
    const view = await game.start()
    expect(leakIssues(golden, view, game.state)).toEqual([])
    const demeanour = golden.characters[0]?.stances[0]?.demeanour ?? ''
    const undiscovered = golden.discoveries[1]?.text ?? ''
    const leaked = { ...view, messages: [...view.messages, { ...view.messages[0], text: `${demeanour} ${undiscovered}` }] } as PlayerView
    expect(leakIssues(golden, leaked, game.state)).toEqual([expect.stringContaining('stance demeanour'), expect.stringContaining('undiscovered text')])
  })

  it.each([
    ['mini', mini],
    ['golden-1819', golden],
  ])('%s: every ending is reachable, two stay open at the end, and no view leaks', async (_name, spec) => {
    const result = await explore(spec, leakIssues)
    expect([...result.endings.keys()].sort(), `explored ${result.states} states`).toEqual(spec.endings.map((ending) => ending.id).sort())
    expect(result.leaks).toEqual([])
    expect(Math.min(...result.openAtFinal)).toBeGreaterThanOrEqual(2)
    expect(minOpenAtFinal(spec)).toBeGreaterThanOrEqual(2)
  }, 120_000)
})
