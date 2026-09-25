import { storyFauna } from '../src/fauna.js'
import { detailZoom } from '../src/camera.js'
import { SCENERY_KINDS } from '@adventure/game-core'
import { environmentSchema, ENVIRONMENT_MATERIALS, ENVIRONMENT_PROPS } from '../../generation/src/spec/environment.js'
import { describe, expect, it } from 'vitest'
import { applyEnvironment, MATERIAL_NAMES, roomMaterial, storyArt, STORY_ART, STORY_STYLES } from '../src/story-art.js'
import { MAP_STYLES } from '../../generation/src/spec/catalogue.js'

describe('story art direction', () => {
  it('keeps detail readable on compact and desktop screens', () => {
    expect(detailZoom(390, 780, 512, 640)).toBe(3)
    expect(detailZoom(1440, 960, 512, 640)).toBe(4)
    expect(Number.isInteger(detailZoom(900, 600, 720, 480))).toBe(true)
  })
  it('uses stage fauna and preserves a deliberate choice of no animals', () => {
    expect(storyFauna(undefined, STORY_ART.desert, 'A caravan oasis')).toEqual(['camel', 'goat'])
    expect(storyFauna(undefined, STORY_ART.civic, 'Press offices')).toEqual(['cat'])
    const plan = environmentSchema.parse({ description: 'A quiet oasis', ground: 'sand', accent: 'earth', path: 'sandstone', roof: 'canvas', pathStyle: 'worn', waterfront: 'oasis', vegetation: 0, propDensity: 'sparse', props: ['palm', 'pottery', 'sacks'], fauna: [] })
    expect(storyFauna(plan, STORY_ART.desert, 'A caravan oasis')).toEqual([])
    expect(storyFauna({ ...plan, fauna: ['goat'] }, STORY_ART.desert, 'A caravan oasis')).toEqual(['goat'])
  })
  it('keeps generation and renderer styles aligned', () => expect(STORY_STYLES).toEqual(MAP_STYLES))
  it('renders a validated production environment plan over the fallback palette', () => {
    expect(MATERIAL_NAMES).toEqual(ENVIRONMENT_MATERIALS)
    expect(SCENERY_KINDS).toEqual(ENVIRONMENT_PROPS)
    const plan = environmentSchema.parse({ description: 'A tropical working quay', ground: 'sand', accent: 'gravel', path: 'decking', roof: 'timber', pathStyle: 'worn', waterfront: 'harbor', vegetation: .15, propDensity: 'busy', props: ['fishing-net', 'anchor', 'crate', 'canopy'] })
    const art = applyEnvironment(STORY_ART.civic, plan)
    expect(art.ground).toBe(MATERIAL_NAMES.indexOf('sand'))
    expect(art.path).toBe(MATERIAL_NAMES.indexOf('decking'))
    expect(art.decorations).toEqual(plan.props)
    expect(art.vegetation).toBe(.15)
    expect(STORY_ART.civic.ground).toBe(11)
    expect(environmentSchema.safeParse({ ...plan, props: ['arbitrary-script'] }).success).toBe(false)
  })
  it('gives different physical settings distinct material and prop combinations', () => {
    const settings = ['Newspaper city desk and records office', 'Trading ships at the harbor quay', 'Desert caravan market', 'Jungle rainforest camp', 'Factory and foundry', 'Snowbound frozen settlement']
    const profiles = settings.map((context) => storyArt('auto', 'classic', context))
    expect(profiles.map((p) => p.id)).toEqual(['civic', 'harbor', 'desert', 'jungle', 'industrial', 'winter'])
    expect(new Set(profiles.map((p) => `${p.ground}:${p.path}:${p.wall}`)).size).toBe(settings.length)
    expect(STORY_ART.civic.vines).toBeLessThan(STORY_ART.jungle.vines)
    expect(STORY_ART.desert.vegetation).toBe(0)
  })
  it('respects authored art direction and climate overrides for older stories', () => {
    expect(storyArt('palace', 'classic', 'An archive near a harbor').id).toBe('palace')
    expect(storyArt('auto', 'winter', 'A village').id).toBe('winter')
    expect(storyArt('auto', 'coast', 'A trading settlement').id).toBe('harbor')
    expect(storyArt('auto', 'coast', 'A city founded around a harbor', 'Parliament and records office').id).toBe('civic')
    expect(storyArt('auto', 'classic', 'A rural village')).toEqual(storyArt('auto', 'classic', 'A rural village'))
  })
  it('selects room materials by function within a shared setting', () => {
    expect(roomMaterial('Records archive', STORY_ART.civic)).toBe(3)
    expect(roomMaterial('Council hall', STORY_ART.civic)).toBe(4)
    expect(roomMaterial('Warehouse', STORY_ART.harbor)).toBe(14)
    expect(roomMaterial('Caravan tent', STORY_ART.desert)).toBe(8)
  })
})
