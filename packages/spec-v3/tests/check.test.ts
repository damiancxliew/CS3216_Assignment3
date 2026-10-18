import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AdventureSpec } from '../src/index.js'
import { checkSpec, validateSpec } from '../src/index.js'
import { sampleSpec } from './sample.js'

const clone = () => JSON.parse(JSON.stringify(sampleSpec))

/** Mutate the sample, re-validate (mutations must stay schema-valid), return the typed spec. */
const checked = (mutate: (spec: any) => void = () => {}) => {
  const spec = clone()
  mutate(spec)
  const result = validateSpec(spec)
  if (!result.ok) throw new Error(`mutated spec no longer validates: ${JSON.stringify(result.issues)}`)
  return checkSpec(result.spec)
}

const codes = (mutate: (spec: any) => void) => checked(mutate).errors.map((e) => e.code)

describe('checkSpec', () => {
  it('reports no issues on the sample spec', () => {
    expect(checked()).toEqual({ errors: [], warnings: [] })
  })

  describe('references resolve', () => {
    it('ref: unknown startRoomId', () => {
      const result = checked((s) => (s.stages[0].startRoomId = 'room-nope'))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'stages.0.startRoomId' }))
    })

    it('ref: storyEvent move to a room of another stage', () => {
      const result = checked((s) => (s.storyEvents[1].toRoomId = 'room-nope'))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'storyEvents.1.toRoomId' }))
    })

    it('ref: openQuestion discovery from another stage', () => {
      const result = checked((s) => {
        s.openQuestions = [{ id: 'q-1', stageId: 'stage-1', text: 'q', discoveryIds: ['nope'] }]
      })
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'openQuestions.0.discoveryIds.0' }))
    })

    it('ref: hintAngle discoveryId', () => {
      const result = checked((s) => {
        s.hintAngles = [{ id: 'h-1', discoveryId: 'nope', kind: 'ask', text: 'h' }]
      })
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'hintAngles.0.discoveryId' }))
    })

    it('ref issues name the ids involved, the unresolved one first', () => {
      const room = checked((s) => (s.stages[0].startRoomId = 'room-nope'))
      expect(room.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'stages.0.startRoomId', ids: ['room-nope', 'stage-1'] }))
      const hint = checked((s) => {
        s.hintAngles = [{ id: 'h-1', discoveryId: 'nope', kind: 'ask', text: 'h' }]
      })
      expect(hint.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'hintAngles.0.discoveryId', ids: ['nope'] }))
    })

    it('ref: citation sourceId', () => {
      const result = checked((s) => (s.discoveries[0].citations = [{ sourceId: 'nope' }]))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'discoveries.0.citations' }))
    })

    it('ref: conflict sourceId and itemId', () => {
      const result = checked((s) => {
        s.conflicts = [{ id: 'c-1', itemIds: ['nope'], teacherSays: 'a', sourceSays: 'b', sourceId: 'nope' }]
      })
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'conflicts.0.sourceId' }))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ref', path: 'conflicts.0.itemIds.0' }))
    })

    it('duplicate-id', () => {
      const result = checked((s) => (s.discoveries[1].id = 'disc-1'))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'duplicate-id', path: 'discoveries.1.id' }))
    })

    it('duplicate-id for a room repeated within one stage', () => {
      const result = checked((s) => (s.stages[0].rooms[1].id = 'room-dock'))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'duplicate-id', path: 'stages.0.rooms.1.id' }))
    })

    it('no duplicate-id for the same room id in two stages', () => {
      const result = checked((s) => {
        s.stages.push({
          id: 'stage-2',
          title: 'Epilogue',
          timePlace: 'Singapore, 1820',
          centralQuestion: '?',
          openingNarration: '.',
          rooms: [
            { id: 'room-dock', name: 'Dock', description: 'Same place, a year on.' },
            { id: 'room-hill', name: 'Hill', description: 'h' },
          ],
          startRoomId: 'room-dock',
          placement: { 'char-farquhar': 'room-dock' },
          documentPlacement: {},
          situations: [],
          definingMomentId: 'moment-1',
        })
        s.timer.stageMinutes = [20, 15]
      })
      expect(result.errors.filter((e) => e.code === 'duplicate-id')).toEqual([])
    })

    it('timer-stages', () => {
      expect(codes((s) => (s.timer.stageMinutes = [20, 20]))).toContain('timer-stages')
    })

    it('stance-count', () => {
      expect(codes((s) => (s.characters[0].stances = s.characters[0].stances.slice(0, 2)))).toContain('stance-count')
    })

    it('initial-stance', () => {
      expect(codes((s) => (s.characters[0].initialStanceId = null))).toContain('initial-stance')
    })

    it('hidden-stance', () => {
      expect(codes((s) => (s.characters[0].stances[0].hidden = true))).toContain('hidden-stance')
    })

    it('minor-stances', () => {
      expect(codes((s) => (s.characters[1].stances = [{ id: 'st-m1', label: 'l', demeanour: 'd' }]))).toContain('minor-stances')
    })

    it('fallback-rule', () => {
      expect(codes((s) => (s.definingMoments[0].rules[0].when = { discovered: 'disc-1' }))).toContain('fallback-rule')
    })

    it('passage-offsets', () => {
      expect(codes((s) => (s.documents[0].keyPassages[0].end = 10_000))).toContain('passage-offsets')
    })

    it('passage-unlinked', () => {
      expect(codes((s) => s.documents[0].keyPassages.push({ id: 'kp-2', start: 0, end: 10 }))).toContain('passage-unlinked')
    })
  })

  describe('endings reachable', () => {
    /** Adds a stage-0 before the sample's stage: moment-0 has 2 producible outcomes. */
    const twoStage = (closes: string[][]) => (s: any) => {
      s.stages.unshift({
        id: 'stage-0',
        title: 'Prologue',
        timePlace: 'Penang, 1818',
        centralQuestion: '?',
        openingNarration: '.',
        rooms: [
          { id: 'room-0a', name: 'A', description: 'a' },
          { id: 'room-0b', name: 'B', description: 'b' },
        ],
        startRoomId: 'room-0a',
        placement: { 'char-farquhar': 'room-0a' },
        documentPlacement: {},
        situations: [],
        definingMomentId: 'moment-0',
      })
      s.timer.stageMinutes = [15, 20]
      s.discoveries.push({
        id: 'disc-0',
        stageId: 'stage-0',
        holder: { characterId: 'char-farquhar' },
        text: 't',
        note: 'n',
        core: true,
        sourceLabel: 's',
      })
      s.definingMoments.unshift({
        id: 'moment-0',
        stageId: 'stage-0',
        deciderId: 'char-farquhar',
        scene: 's',
        nudge: 'n',
        finalCallNarration: 'f',
        acts: [
          { id: 'act-0-1', text: 'a', reaction: 'r' },
          { id: 'act-0-2', text: 'b', reaction: 'r' },
        ],
        outcomes: [
          { id: 'out-0-1', summary: 's', predictionText: 'p', because: 'b', closesEndingIds: closes[0] },
          { id: 'out-0-2', summary: 's', predictionText: 'p', because: 'b', closesEndingIds: closes[1] },
        ],
        rules: [
          { actId: 'act-0-1', outcomeId: 'out-0-1' },
          { actId: 'act-0-2', outcomeId: 'out-0-2' },
        ],
      })
    }

    it('historical-missing', () => {
      expect(codes((s) => (s.endings[0].type = 'alternative'))).toContain('historical-missing')
    })

    it('historical-unreachable when every path closes the historical ending', () => {
      expect(codes(twoStage([['end-1'], ['end-1']]))).toContain('historical-unreachable')
    })

    it('endings-open when a path leaves only one non-secret ending', () => {
      const result = checked(twoStage([['end-1', 'end-3'], ['end-1', 'end-2']]))
      const issue = result.errors.find((e) => e.code === 'endings-open')
      expect(issue).toBeDefined()
      expect(issue!.message).toContain('out-0-1')
    })

    it('final-outcome-ending', () => {
      expect(codes((s) => delete s.definingMoments[0].outcomes[1].endingId)).toContain('final-outcome-ending')
    })

    it('paths-overflow when paths exceed the cap', () => {
      const result = checked((s) => {
        const extraStages = []
        for (let i = 0; i < 5; i++) {
          extraStages.push({
            id: `stage-x${i}`,
            title: 'x',
            timePlace: 'x',
            centralQuestion: 'x',
            openingNarration: 'x',
            rooms: [{ id: `room-x${i}`, name: 'x', description: 'x' }],
            startRoomId: `room-x${i}`,
            placement: { 'char-farquhar': `room-x${i}` },
            documentPlacement: {},
            situations: [],
            definingMomentId: `moment-x${i}`,
          })
          s.discoveries.push({
            id: `disc-x${i}`,
            stageId: `stage-x${i}`,
            holder: { characterId: 'char-farquhar' },
            text: 't',
            note: 'n',
            core: true,
            sourceLabel: 's',
          })
          s.definingMoments.unshift({
            id: `moment-x${i}`,
            stageId: `stage-x${i}`,
            deciderId: 'char-farquhar',
            scene: 's',
            nudge: 'n',
            finalCallNarration: 'f',
            acts: [
              { id: `act-x${i}-1`, text: 'a', reaction: 'r' },
              { id: `act-x${i}-2`, text: 'b', reaction: 'r' },
            ],
            outcomes: Array.from({ length: 10 }, (_, j) => ({
              id: `out-x${i}-${j}`,
              summary: 's',
              predictionText: 'p',
              because: 'b',
            })),
            rules: Array.from({ length: 10 }, (_, j) => ({ actId: `act-x${i}-1`, outcomeId: `out-x${i}-${j}` })),
          })
        }
        s.stages.unshift(...extraStages)
        s.timer.stageMinutes = extraStages.map(() => 10).concat(20)
      })
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'paths-overflow' }))
    })
  })

  describe('core discoveries reachable', () => {
    it('core-unreachable via a hidden stance', () => {
      // st-3 is the hidden top stance; nothing can reach it (G15)
      const result = checked((s) => {
        s.discoveries[0].condition = { stanceIs: { characterId: 'char-farquhar', stanceId: 'st-3' } }
      })
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'core-unreachable', path: 'discoveries.0.id' }))
    })

    it('core-unreachable gated on a discovery held by an absent character', () => {
      const result = checked((s) => {
        s.characters.push({
          id: 'char-absent',
          name: 'Ghost',
          title: 'Absent',
          real: false,
          tier: 'minor',
          persona: {
            voice: 'v',
            phrases: [{ text: 'p', sourceLabel: 's' }],
            knewThen: 'k',
            wantsFromStudent: 'w',
            withholds: [],
            publicPosition: 'p',
            privateAgenda: 'a',
          },
          stances: [],
          initialStanceId: null,
          slants: [],
        })
        s.discoveries.push({
          id: 'disc-absent',
          stageId: 'stage-1',
          holder: { characterId: 'char-absent' },
          text: 't',
          note: 'n',
          core: false,
          sourceLabel: 's',
        })
        s.discoveries[0].condition = { discovered: 'disc-absent' }
      })
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'core-unreachable', path: 'discoveries.0.id' }))
    })

    it('core-holder rejects a minor-held core discovery', () => {
      const result = checked((s) => (s.discoveries[0].holder = { characterId: 'char-nakhoda' }))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'core-holder', path: 'discoveries.0.holder' }))
    })

    it('core-missing when a stage has no core discovery', () => {
      expect(codes((s) => s.discoveries.forEach((d: any) => (d.core = false)))).toContain('core-missing')
    })
  })

  describe('source labels', () => {
    it('source-label on a blank label', () => {
      const result = checked((s) => (s.discoveries[0].sourceLabel = '   '))
      expect(result.errors).toContainEqual(expect.objectContaining({ code: 'source-label', path: 'discoveries.0.sourceLabel' }))
    })

    it('core-invented on a core discovery labelled invented', () => {
      expect(codes((s) => (s.discoveries[0].sourceLabel = ' Invented '))).toContain('core-invented')
    })
  })
})

describe('golden fixture', () => {
  const fixturePath = fileURLToPath(new URL('../../../fixtures/golden-1819.json', import.meta.url))
  it.skipIf(!existsSync(fixturePath))('checkSpec reports no errors on fixtures/golden-1819.json', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown
    const result = validateSpec(fixture)
    if (!result.ok) throw new Error(`fixture does not validate: ${JSON.stringify(result.issues)}`)
    expect(checkSpec(result.spec).errors).toEqual([])
  })
})
