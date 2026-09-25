import type { MapThemeId } from './model.js'

export const STORY_STYLES = ['auto', 'civic', 'harbor', 'village', 'jungle', 'desert', 'industrial', 'winter', 'palace', 'ruins', 'battlefield'] as const
export type StoryStyle = typeof STORY_STYLES[number]
export type Decoration = 'planter' | 'bench' | 'lamp' | 'crate' | 'barrel' | 'rope' | 'pottery' | 'awning' | 'palm' | 'boulder' | 'log' | 'fern' | 'pipe' | 'sacks' | 'brazier' | 'column' | 'rubble' | 'sandbags' | 'bicycle' | 'noticeboard' | 'flowerbed' | 'cart' | 'fishing-net' | 'bollard' | 'canopy' | 'laundry' | 'urn' | 'cypress' | 'buoy' | 'anchor'
export const MATERIAL_NAMES = ['cobble', 'limestone', 'checker', 'timber', 'flagstone', 'slate', 'grass', 'earth', 'sand', 'sandstone', 'brick', 'gravel', 'snow', 'ice', 'decking', 'terracotta', 'mosaic', 'basalt', 'mud', 'leaves'] as const
/** Default floor materials for authored open locations. */
export const OPEN_FLOOR_DEFAULTS = {
  cobble: 'cobble',
  brick: 'brick',
  boardwalk: 'decking',
  earth: 'earth',
} as const satisfies Record<string, typeof MATERIAL_NAMES[number]>

export function openFloorForKind(kind?: string): typeof MATERIAL_NAMES[number] {
  switch (kind) {
    case 'dock': return OPEN_FLOOR_DEFAULTS.boardwalk
    case 'street':
    case 'market': return OPEN_FLOOR_DEFAULTS.brick
    case 'field':
    case 'camp': return OPEN_FLOOR_DEFAULTS.earth
    default: return OPEN_FLOOR_DEFAULTS.cobble
  }
}
export interface EnvironmentPlan {
  description: string
  ground: typeof MATERIAL_NAMES[number]; accent: typeof MATERIAL_NAMES[number]; path: typeof MATERIAL_NAMES[number]
  pathStyle: 'formal' | 'winding' | 'worn'
  roof: 'terracotta' | 'slate' | 'thatch' | 'canvas' | 'timber'
  waterfront: 'none' | 'harbor' | 'river' | 'pond' | 'oasis'
  layout?: 'courtyard' | 'garden-loop' | 'quayside' | 'meandering'
  population?: 'quiet' | 'residents' | 'workers' | 'traders'
  wind?: 'calm' | 'breeze' | 'gusts'
  fauna?: Array<'camel' | 'goat' | 'chicken' | 'cat'>
  vegetation: number; propDensity: 'sparse' | 'lived-in' | 'busy'; props: Decoration[]
}
export function applyEnvironment(base: StoryArt, plan?: EnvironmentPlan | null): StoryArt {
  return plan ? { ...base, ground: MATERIAL_NAMES.indexOf(plan.ground), secondary: MATERIAL_NAMES.indexOf(plan.accent), path: MATERIAL_NAMES.indexOf(plan.path), vegetation: Math.min(plan.vegetation, base.id === 'desert' ? .06 : Math.max(base.vegetation, .2)), decorations: [...new Set(plan.props)] } : base
}
export interface StoryArt {
  id: Exclude<StoryStyle, 'auto'>
  ground: number; secondary: number; path: number; floor: number
  wall: 'plaster' | 'brick' | 'timber' | 'bamboo' | 'sandstone' | 'stone'
  wallColor: string; wallShade: string; wallLight: string; background: string
  vegetation: number; vines: number; decorations: readonly Decoration[]
}
export const STORY_ART: Record<StoryArt['id'], StoryArt> = {
  civic: { id: 'civic', ground: 11, secondary: 0, path: 1, floor: 2, wall: 'plaster', wallColor: '#bcb79c', wallShade: '#777d72', wallLight: '#e1d7b7', background: '#69766c', vegetation: .08, vines: .02, decorations: ['planter', 'bench', 'lamp', 'bicycle', 'noticeboard', 'flowerbed', 'cart'] },
  harbor: { id: 'harbor', ground: 8, secondary: 11, path: 14, floor: 14, wall: 'timber', wallColor: '#8d7855', wallShade: '#4d594e', wallLight: '#bba078', background: '#3b717d', vegetation: .1, vines: .03, decorations: ['crate', 'barrel', 'rope', 'palm', 'fishing-net', 'bollard', 'canopy', 'anchor'] },
  village: { id: 'village', ground: 6, secondary: 7, path: 7, floor: 3, wall: 'timber', wallColor: '#9c805b', wallShade: '#625c41', wallLight: '#c3a770', background: '#536946', vegetation: .6, vines: .2, decorations: ['log', 'pottery', 'sacks', 'planter'] },
  jungle: { id: 'jungle', ground: 19, secondary: 6, path: 18, floor: 3, wall: 'bamboo', wallColor: '#81905a', wallShade: '#3c5840', wallLight: '#adad70', background: '#243f35', vegetation: .95, vines: .8, decorations: ['fern', 'palm', 'log', 'boulder'] },
  desert: { id: 'desert', ground: 8, secondary: 9, path: 9, floor: 15, wall: 'sandstone', wallColor: '#b99a6d', wallShade: '#8a7157', wallLight: '#e7c99a', background: '#aa8862', vegetation: 0, vines: 0, decorations: ['pottery', 'awning', 'sacks', 'palm'] },
  industrial: { id: 'industrial', ground: 17, secondary: 11, path: 10, floor: 5, wall: 'brick', wallColor: '#96715d', wallShade: '#544e48', wallLight: '#b18f70', background: '#424e50', vegetation: .01, vines: 0, decorations: ['pipe', 'barrel', 'crate', 'lamp'] },
  winter: { id: 'winter', ground: 12, secondary: 13, path: 11, floor: 3, wall: 'stone', wallColor: '#9bafb3', wallShade: '#607784', wallLight: '#e1e9db', background: '#819caa', vegetation: 0, vines: 0, decorations: ['log', 'boulder', 'brazier', 'crate'] },
  palace: { id: 'palace', ground: 15, secondary: 16, path: 4, floor: 16, wall: 'sandstone', wallColor: '#c7b391', wallShade: '#897b67', wallLight: '#eadcba', background: '#797e64', vegetation: .12, vines: .04, decorations: ['column', 'planter', 'brazier', 'pottery'] },
  ruins: { id: 'ruins', ground: 0, secondary: 19, path: 11, floor: 17, wall: 'stone', wallColor: '#838c78', wallShade: '#485c4e', wallLight: '#b3b394', background: '#44564a', vegetation: .75, vines: .7, decorations: ['rubble', 'column', 'fern', 'boulder'] },
  battlefield: { id: 'battlefield', ground: 18, secondary: 7, path: 11, floor: 7, wall: 'timber', wallColor: '#7b7157', wallShade: '#484d3e', wallLight: '#a59a76', background: '#555b47', vegetation: .15, vines: 0, decorations: ['sandbags', 'crate', 'barrel', 'log'] },
}

/** Authored direction wins. Older adventures use only public stage/room context. */
export function storyArt(style: StoryStyle = 'auto', theme: MapThemeId = 'classic', context = '', rooms = ''): StoryArt {
  if (style !== 'auto') return STORY_ART[style]
  if (theme === 'winter' || theme === 'desert') return STORY_ART[theme]
  const rules: Array<[StoryArt['id'], RegExp]> = [
    ['harbor', /\b(harbo[u]?r|dock|quay|shipyard|jetty|seaport|wharf|maritime)\b/i],
    ['industrial', /\b(factory|industrial|steelworks|foundry|coal mine|railway yard|mill)\b/i],
    ['palace', /\b(palace|royal court|imperial court|throne|sultan.*court)\b/i],
    ['battlefield', /\b(battlefield|trench|military camp|siege|front line|barracks)\b/i],
    ['ruins', /\b(ruins|abandoned temple|overgrown|archaeolog)\b/i],
    ['jungle', /\b(jungle|rainforest|forest camp|woodland)\b/i],
    ['civic', /\b(newsroom|press room|city desk|parliament|assembly|council|records office|city hall|courthouse|newspaper|embassy)\b/i],
    ['desert', /\b(desert|oasis|caravan|sahara|arid)\b/i],
    ['winter', /\b(snow|frozen|blizzard|arctic)\b/i],
  ]
  const matched = rules.find(([, pattern]) => pattern.test(rooms)) ?? rules.find(([, pattern]) => pattern.test(context))
  return STORY_ART[matched?.[0] ?? (theme === 'coast' ? 'harbor' : theme === 'forest' ? 'jungle' : 'village')]
}

export function roomMaterial(description: string, profile: StoryArt): number {
  if (/\b(dock|pier|jetty|warehouse)\b/i.test(description)) return 14
  if (/\b(archive|library|records)\b/i.test(description)) return 3
  if (/\b(throne|chapel|temple|palace)\b/i.test(description)) return 16
  if (/\b(factory|forge|workshop)\b/i.test(description)) return 5
  if (/\b(assembly|council|court|hall)\b/i.test(description)) return 4
  if (/\b(kitchen|market|bazaar)\b/i.test(description)) return 15
  if (/\b(camp|field|tent)\b/i.test(description)) return profile.id === 'desert' ? 8 : 7
  return profile.floor
}

/** Rounded, transparent wall silhouettes; masonry and timber use different construction marks. */
export function paintStoryWalls(ctx: CanvasRenderingContext2D, art: StoryArt): void {
  const stamps = [{ col: 0, row: 6, kind: 'corner', flipX: false, flipY: false },
    { col: 4, row: 6, kind: 'corner', flipX: true, flipY: false },
    { col: 0, row: 10, kind: 'corner', flipX: false, flipY: true },
    { col: 4, row: 10, kind: 'corner', flipX: true, flipY: true },
    { col: 1, row: 6, kind: 'horizontal', flipX: false, flipY: false },
    { col: 1, row: 10, kind: 'horizontal', flipX: false, flipY: true },
    { col: 0, row: 7, kind: 'vertical', flipX: false, flipY: false },
    { col: 4, row: 7, kind: 'vertical', flipX: true, flipY: false }]
  for (const stamp of stamps) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const xx = stamp.flipX ? 15 - x : x, yy = stamp.flipY ? 15 - y : y
      const corner = stamp.kind === 'corner'
      const horizontal = stamp.kind === 'horizontal'
      if (corner ? (xx < 3 || yy < 3 || (xx < 12 && yy < 12 && (xx - 12) ** 2 + (yy - 12) ** 2 > 90) || (xx > 12 && yy > 12)) : horizontal ? yy < 3 || yy > 12 : xx < 3 || xx > 12) continue
      const edge = horizontal ? yy : stamp.kind === 'vertical' ? xx : Math.min(xx, yy)
      const timber = art.wall === 'timber' || art.wall === 'bamboo'
      const joint = timber ? (horizontal ? x % 5 === 0 : y % 5 === 0) : y % 5 === 0 || (x + (Math.floor(y / 5) % 2) * 6) % 12 === 0
      ctx.fillStyle = edge <= 4 ? art.wallLight : edge >= 11 || joint ? art.wallShade : art.wallColor
      ctx.fillRect(stamp.col * 16 + x, stamp.row * 16 + y, 1, 1)
    }
  }
}
