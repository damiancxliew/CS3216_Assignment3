import type Phaser from 'phaser'
import type { EnvironmentPlan, StoryArt } from './story-art.js'

export const FAUNA = ['camel', 'goat', 'chicken', 'cat'] as const
export type Fauna = typeof FAUNA[number]

/** Explicit stage direction wins, including an empty list for places without animals. */
export function storyFauna(plan: EnvironmentPlan | null | undefined, art: StoryArt, context: string): Fauna[] {
  if (plan?.fauna) return [...new Set(plan.fauna)]
  if (art.id === 'desert' && /caravan|oasis|camel/i.test(context)) return ['camel', 'goat']
  if (art.id === 'village') return ['chicken', 'goat']
  if (art.id === 'harbor' || art.id === 'civic') return ['cat']
  return []
}

/** Native 24px, four-direction, four-frame sheets share the characters' pixel scale. */
export function makeFaunaSheet(scene: Phaser.Scene, species: Fauna): string {
  const key = `fauna-${species}`
  if (scene.textures.exists(key)) return key
  const atlas = scene.textures.createCanvas(key, 96, 96)!, c = atlas.context
  const directions = ['down', 'up', 'left', 'right'] as const
  for (let direction = 0; direction < 4; direction++) for (let frame = 0; frame < 4; frame++) {
    c.save(); c.translate(direction * 24 + 12, frame * 24 + 12)
    c.rotate([Math.PI, 0, -Math.PI / 2, Math.PI / 2][direction]!)
    const p = (color: string, x: number, y: number, w = 1, h = 1) => { c.fillStyle = color; c.fillRect(x - 12, y - 12, w, h) }
    const stride = [0, 2, 0, -2][frame]!
    if (species === 'camel') {
      p('#6e5137', 6, 10 + stride, 2, 5); p('#6e5137', 16, 10 - stride, 2, 5)
      p('#83603d', 6, 17 - stride, 2, 5); p('#83603d', 16, 17 + stride, 2, 5)
      p('#aa7c4d', 7, 9, 10, 11); p('#c79d66', 8, 9, 8, 12)
      p('#8b6240', 10, 20, 2, 3); p('#c79d66', 10, 4, 4, 9)
      p('#dcb57b', 10, 3, 6, 4); p('#94663e', 9, 2, 2, 2); p('#94663e', 15, 2, 2, 2)
      p('#453d2e', 14, 3); p('#86643d', 10, 6, 2, 1)
      p('#b28853', 9, 10, 6, 8); p('#e3bd82', 10, 10, 4, 5)
      p('#8c5740', 8, 15, 8, 3); p('#d6bd86', 6, 15, 3, 4); p('#d6bd86', 15, 15, 3, 4)
      p('#74543a', 7, 16, 1, 2); p('#74543a', 16, 16, 1, 2)
    } else if (species === 'chicken') {
      p('#bb8546', 9, 15 + stride / 2, 2, 3); p('#bb8546', 14, 15 - stride / 2, 2, 3)
      p('#9b8a65', 8, 9, 9, 8); p('#e4d9b5', 9, 8, 7, 8)
      p('#c4b591', 7, 11 + stride / 2, 2, 5); p('#c4b591', 16, 11 - stride / 2, 2, 5)
      p('#f1e4be', 10, 6, 5, 4); p('#b34e3d', 12, 4, 2, 3); p('#cf984a', 12, 3, 2, 1)
      p('#4d4938', 14, 7); p('#e6ddbc', 10, 16, 5, 3)
    } else {
      const goat = species === 'goat'
      const dark = goat ? '#7e7460' : '#765844', light = goat ? '#d3c6a5' : '#c58c59', highlight = goat ? '#ede2c3' : '#ddaa74'
      p(dark, 7, 9 + stride, 2, 4); p(dark, 15, 9 - stride, 2, 4)
      p(dark, 7, 16 - stride, 2, 4); p(dark, 15, 16 + stride, 2, 4)
      p(dark, 8, 9, 8, 10); p(light, 9, 8, 6, 11); p(highlight, 10, 9, 2, 8)
      p(light, 8, 5, 8, 5); p(dark, 7, 4, 2, 3); p(dark, 15, 4, 2, 3)
      p(highlight, 9, 5, 5, 3); p('#393b2d', 9, 6); p('#393b2d', 14, 6)
      if (goat) { p('#a3936d', 9, 2, 1, 3); p('#a3936d', 14, 2, 1, 3); p(highlight, 11, 3, 2, 2); p(light, 12, 19, 2, 2) }
      else { p(dark, 12, 18, 2, 4); p(light, 13, 21, 3, 1); p('#94683f', 10, 11, 4, 1); p('#94683f', 10, 14, 4, 1) }
    }
    c.restore(); atlas.add(frame * 4 + direction, 0, direction * 24, frame * 24, 24, 24)
  }
  atlas.refresh()
  directions.forEach((direction, column) => scene.anims.create({ key: `${key}-${direction}`, frames: [0, 1, 2, 3].map(row => ({ key, frame: row * 4 + column })), frameRate: species === 'camel' ? 5 : 7, repeat: -1 }))
  return key
}
