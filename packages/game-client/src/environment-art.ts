import Phaser from 'phaser'
import type { PlaygroundSnapshot } from './model.js'
import { roomFinish, surfaceNoise } from './materials.js'
import type { StoryArt, Decoration } from './story-art.js'
import { isExposed } from './weather.js'

const T = 16
type Context = CanvasRenderingContext2D
const pixel = (c: Context, color: string, x: number, y: number, w = 1, h = 1) => {
  c.fillStyle = color
  c.fillRect(Math.round(x), Math.round(y), w, h)
}

function field(x: number, y: number, scale: number, salt: number): number {
  const gx = Math.floor(x / scale), gy = Math.floor(y / scale)
  const sx = (x / scale - gx), sy = (y / scale - gy)
  const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy)
  const top = surfaceNoise(gx, gy, salt) * (1 - u) + surfaceNoise(gx + 1, gy, salt) * u
  const bottom = surfaceNoise(gx, gy + 1, salt) * (1 - u) + surfaceNoise(gx + 1, gy + 1, salt) * u
  return top * (1 - v) + bottom * v
}

function tuft(c: Context, x: number, y: number, seed: number): void {
  pixel(c, '#354b32', x - 3, y, 7, 2)
  for (let blade = 0; blade < 5; blade++) {
    const height = 3 + Math.floor(surfaceNoise(seed, blade, 91) * 5)
    const lean = blade - 2
    pixel(c, blade % 2 ? '#698743' : '#4c703b', x + lean, y - height + 1, 1, height)
    pixel(c, '#8f9e56', x + lean + Math.sign(lean), y - height, 1, 2)
  }
}

function fern(c: Context, x: number, y: number, seed: number): void {
  pixel(c, '#293f2d', x - 5, y, 11, 3)
  for (let frond = 0; frond < 5; frond++) {
    const direction = frond < 2 ? -1 : frond > 2 ? 1 : 0
    const height = 7 + Math.floor(surfaceNoise(seed, frond, 87) * 6)
    for (let step = 0; step < height; step++) {
      const xx = x + direction * Math.floor(step * (frond % 2 ? 0.5 : 0.8))
      const yy = y - step
      pixel(c, '#7b9450', xx, yy)
      if (step % 2 === 0 && step < height - 1) {
        pixel(c, '#3e683e', xx - 2, yy - 1, 2, 2)
        pixel(c, '#668948', xx + 1, yy - 1, 2, 1)
      }
    }
  }
}

function shrub(c: Context, x: number, y: number, seed: number): void {
  pixel(c, '#344632', x - 8, y, 18, 4)
  pixel(c, '#5c5139', x, y - 5, 2, 7)
  for (let cluster = 0; cluster < 14; cluster++) {
    const xx = x - 9 + Math.floor(surfaceNoise(seed, cluster, 82) * 17)
    const yy = y - 5 - Math.floor(surfaceNoise(seed, cluster, 83) * 13)
    pixel(c, '#2f5136', xx + 1, yy, 6, 7)
    pixel(c, '#40643c', xx, yy + 2, 8, 4)
    pixel(c, '#607e45', xx + 1, yy + 1, 5, 3)
    pixel(c, '#82994e', xx + 2, yy + 1, 2, 1)
  }
}

function vine(c: Context, x: number, y: number, seed: number): void {
  const length = 17 + Math.floor(surfaceNoise(seed, 7, 81) * 22)
  for (let step = 0; step < length; step++) {
    const xx = x + Math.round(Math.sin(step / 5 + seed) * 2)
    pixel(c, '#364d31', xx + 1, y + step, 2, 1)
    pixel(c, '#69814a', xx, y + step)
    if (step % 4 === 0) {
      const side = step % 8 ? 1 : -1
      pixel(c, '#304f32', xx + side * 2, y + step, 4, 3)
      pixel(c, '#507840', xx + side * 2, y + step, 3, 2)
      pixel(c, '#89a158', xx + side * 2, y + step, 2, 1)
    }
  }
}

/** Small, distinct period props, attached to blocked perimeter cells rather than walkways. */
function decoration(c: Context, kind: Decoration, x: number, y: number, seed: number): void {
  const p = (color: string, dx: number, dy: number, width = 1, height = 1) => pixel(c, color, x + dx, y + dy, width, height)
  p('#344b403b', -9, 1, 20, 4)
  switch (kind) {
    case 'bicycle':
      for (const dx of [-7, 7]) { c.strokeStyle = '#3e4d48'; c.lineWidth = 1; c.beginPath(); c.arc(x + dx, y - 2, 5, 0, Math.PI * 2); c.stroke() }
      c.strokeStyle = '#7a493c'; c.beginPath(); c.moveTo(x - 7, y - 2); c.lineTo(x - 1, y - 10); c.lineTo(x + 5, y - 2); c.closePath(); c.moveTo(x + 7, y - 2); c.lineTo(x + 4, y - 14); c.stroke()
      p('#d2bc8d', 3, -15, 5, 2); p('#364a42', -3, -12, 5, 2); break
    case 'noticeboard':
      p('#68533c', -9, -19, 2, 23); p('#68533c', 8, -19, 2, 23); p('#94794f', -10, -21, 21, 17)
      p('#d7cba4', -8, -19, 8, 12); p('#ede0b6', 2, -18, 6, 9)
      for (let i = 0; i < 4; i++) p('#817762', -7, -17 + i * 2, 5, 1)
      break
    case 'flowerbed':
      p('#7f7860', -12, -2, 25, 5); p('#a9a087', -11, -3, 23, 2)
      for (let i = 0; i < 9; i++) { p('#547044', -10 + i * 2, -9 + i % 3, 2, 7); p(i % 2 ? '#cc9a72' : '#ddb981', -11 + i * 2, -10 + i % 3, 3, 2) } break
    case 'cart':
      p('#403e32', -8, -2, 3, 6); p('#403e32', 6, -2, 3, 6); p('#866b46', -10, -10, 21, 10)
      for (let i = 0; i < 3; i++) p('#b39a66', -9, -9 + i * 3, 19, 2)
      p('#8f7850', 10, -3, 10, 2); p('#c4b189', -6, -16, 8, 6); p('#8b6c49', 2, -14, 7, 4); break
    case 'fishing-net':
      p('#726344', -10, -20, 2, 23); p('#726344', 10, -20, 2, 23)
      c.strokeStyle = '#b9b188'; c.lineWidth = 1
      for (let i = -20; i < 18; i += 4) { c.beginPath(); c.moveTo(x - 8, y + Math.max(-18, i)); c.lineTo(x + 10, y + Math.min(0, i + 15)); c.stroke() }
      for (let i = -8; i <= 10; i += 3) { c.beginPath(); c.moveTo(x + i, y - 18); c.lineTo(x + i + 1, y); c.stroke() } break
    case 'bollard':
      p('#475b56', -5, -9, 10, 12); p('#778880', -7, -10, 14, 4); p('#b5a276', -6, -5, 12, 2); break
    case 'anchor':
      p('#647975', -1, -19, 3, 18); p('#8b9b8e', -7, -14, 15, 2)
      for (let i = 0; i < 7; i++) { p('#576e68', -i, -1 - i / 2, 2, 2); p('#576e68', i, -1 - i / 2, 2, 2) }
      p('#bcc4a3', 0, -18, 1, 12); break
    case 'buoy':
      p('#72513e', -4, -10, 8, 10); p('#d9cba4', -4, -8, 8, 4); p('#815f48', -2, -15, 4, 5); break
    case 'laundry':
      p('#796947', -13, -20, 2, 24); p('#796947', 13, -20, 2, 24); p('#d1ba8a', -12, -20, 26, 1)
      p('#c7c5a6', -9, -19, 7, 12); p('#a27960', 1, -19, 8, 9); break
    case 'canopy':
      p('#6e5a40', -14, -22, 2, 27); p('#6e5a40', 13, -22, 2, 27)
      for (let i = 0; i < 10; i++) p(i % 2 ? '#d1b888' : '#738579', -14 + i * 3, -24 + Math.abs(i - 4) / 2, 3, 9)
      p('#8c754d', -13, -2, 27, 4); p('#c6ac78', -10, -8, 6, 6); p('#a67951', 2, -9, 6, 7); break
    case 'urn':
      p('#b19d77', -5, -13, 10, 3); p('#998763', -6, -10, 12, 7); p('#cbbc91', -3, -2, 6, 5); break
    case 'cypress':
      p('#6b6041', -1, -7, 3, 10)
      for (let i = 0; i < 24; i++) p(i % 3 ? '#4b6845' : '#718353', -Math.min(7, i / 3), -28 + i, Math.min(15, i / 1.5 + 2), 2)
      break
    case 'fern': fern(c, x, y, seed); break
    case 'palm':
      for (let i = 0; i < 18; i++) p(i % 3 ? '#927747' : '#b4985b', Math.floor(i / 8), -i, 3, 1)
      for (let branch = -2; branch <= 2; branch++) for (let step = 0; step < 10; step++) {
        p(step % 2 ? '#50794b' : '#739453', branch * step / 2, -18 - Math.min(step, 5) + Math.max(0, step - 5), 3, 2)
      }
      break
    case 'planter':
      p('#735642', -6, -5, 12, 8); p('#b48c62', -7, -7, 14, 3); p('#c6a275', -5, -3, 2, 5)
      shrub(c, x, y - 7, seed); break
    case 'crate':
      p('#514d3b', -7, -11, 15, 13); p('#a08355', -6, -11, 13, 11)
      for (let i = 0; i < 4; i++) p('#6c5c41', -6, -9 + i * 3, 13, 1)
      p('#c0a06b', -5, -11, 2, 11); p('#c0a06b', 4, -11, 2, 11); break
    case 'barrel':
      p('#65523c', -5, -13, 10, 15); p('#9a7951', -6, -10, 12, 10); p('#bc9a65', -4, -13, 8, 2)
      p('#555f58', -6, -9, 12, 2); p('#555f58', -6, -2, 12, 2); p('#b99b68', -3, -6, 1, 4); break
    case 'rope':
      for (let i = 0; i < 3; i++) {
        p('#5b5740', -7 + i, -5 + i, 14 - i * 2, 1); p('#cfb67c', -7 + i, -4 + i, 14 - i * 2, 1)
        p('#a28d62', -7 + i, -4 + i, 1, 5 - i); p('#a28d62', 6 - i, -4 + i, 1, 5 - i)
      } break
    case 'bench':
      p('#4f594b', -8, -2, 2, 6); p('#4f594b', 7, -2, 2, 6)
      for (let i = 0; i < 3; i++) p(i === 0 ? '#c0a173' : '#a1845d', -9, -10 + i * 4, 19, 3)
      break
    case 'lamp':
      p('#374c49', 0, -21, 2, 23); p('#566559', -2, 1, 6, 2)
      p('#344b47', -3, -21, 8, 10); p('#ebd7a0', -1, -19, 4, 5); p('#849480', -2, -23, 6, 2); break
    case 'pottery':
      p('#815641', -4, -12, 8, 2); p('#b58057', -3, -10, 6, 4); p('#b58057', -6, -6, 12, 7)
      p('#d5a775', -4, -6, 2, 6); p('#8c654a', -4, 1, 8, 1); break
    case 'awning':
      p('#80664b', -10, -17, 2, 20); p('#80664b', 9, -17, 2, 20)
      for (let i = 0; i < 7; i++) p(i % 2 ? '#d5bd83' : '#a3654d', -10 + i * 3, -19, 3, 7 + (i % 2))
      p('#b99762', -10, -2, 21, 3); break
    case 'pipe':
      p('#495c60', -6, -15, 5, 18); p('#80918a', -5, -15, 2, 18)
      p('#a19172', -8, -11, 9, 2); p('#a19172', -8, -2, 9, 2); p('#596b6b', -5, -17, 13, 4); break
    case 'brazier':
      p('#625543', -4, -8, 8, 7); p('#a27545', -3, -12, 6, 4); p('#e0b269', -1, -15, 3, 7)
      p('#ded39d', 0, -13, 1, 4); p('#49524b', -5, 0, 2, 3); p('#49524b', 4, 0, 2, 3); break
    case 'column':
      p('#8b8d79', -4, -19, 8, 20); p('#d1c7a2', -3, -18, 3, 18)
      p('#c1b795', -6, -21, 12, 3); p('#d3c8a6', -6, 0, 12, 3); break
    case 'sacks': case 'sandbags':
      for (let i = 0; i < (kind === 'sacks' ? 2 : 4); i++) {
        const dx = (i % 2) * 8 - 8, dy = -Math.floor(i / 2) * 5
        p('#8e8261', dx, dy - 7, 9, 7); p('#bfb18a', dx + 1, dy - 8, 7, 5); p('#d0c19a', dx + 2, dy - 7, 4, 1)
      } break
    case 'log':
      p('#68583f', -10, -5, 21, 7); p('#948057', -9, -5, 18, 2); p('#c1a471', 8, -4, 4, 5)
      p('#6c6447', 9, -3, 2, 2); break
    case 'boulder': case 'rubble':
      p('#67756b', -8, -6, 17, 7); p('#8e9881', -6, -10, 12, 8); p('#b0b39b', -4, -11, 7, 3)
      if (kind === 'rubble') { p('#596c61', -2, -7, 1, 8); p('#9ca38c', 10, -2, 3, 3) }
      break
  }
}

/** Authored pixel motifs placed using geometry: lush courtyards, clear roads, sheltered rooms.
 * Baked once into two native-resolution textures; no per-frame objects or collision changes. */
export class EnvironmentArt {
  private readonly images: Phaser.GameObjects.Image[] = []
  private elapsed = 0
  private boats: Array<{ image: Phaser.GameObjects.Image; y: number; phase: number }> = []
  private water: Array<{ x: number; y: number; width: number; height: number; marine: boolean }> = []
  private foliage: Array<{ image: Phaser.GameObjects.Image; phase: number; strength: number }> = []
  private wind = 1
  private glints?: Phaser.GameObjects.Graphics
  private readonly keys = ['environment-ground', 'environment-walls', 'environment-paths', 'environment-surrounds']

  constructor(private readonly scene: Phaser.Scene, snapshot: PlaygroundSnapshot, art: StoryArt) {
    this.wind = snapshot.environment?.wind === 'calm' ? 0 : snapshot.environment?.wind === 'gusts' ? 1.7 : 1
    const map = snapshot.map
    const width = map.width * T, height = map.height * T
    // Room membership is tile-based. Reuse it during rasterisation instead of
    // searching every room for each of the map's millions of pixels.
    const exposed = Array.from({ length: map.height }, (_, y) =>
      Array.from({ length: map.width }, (_, x) => isExposed(map, x, y) && map.tiles[y]?.[x] !== 'water'))
    const seed = roomFinish(`${art.id}:${snapshot.storyContext ?? snapshot.seed}`).seed
    const waterBodies = map.waterBodies ?? []
    if (waterBodies.length) {
      const sea = scene.textures.createCanvas(this.keys[3]!, width, height)!
      const s = sea.context
      for (const body of waterBodies) {
        const marine = body.kind === 'basin'
        const cx = (body.x + body.width / 2) * T, cy = (body.y + body.height / 2) * T
        for (let y = body.y * T; y < (body.y + body.height) * T; y++) for (let x = body.x * T; x < (body.x + body.width) * T; x++) {
          if (!['grass', 'water'].includes(map.tiles[Math.floor(y / T)]?.[Math.floor(x / T)] ?? '')) continue
          const nx = (x - cx) / (body.width * 8), ny = (y - cy) / (body.height * 8)
          const edge = marine ? Math.max(Math.abs(nx), Math.abs(ny), (Math.abs(nx) + Math.abs(ny)) / 1.7) : Math.hypot(nx, ny)
          if (edge > 1) continue
          const n = field(x, y, 19, seed)
          pixel(s, edge > .96 ? (marine ? '#a18e66' : '#a5a17b') : edge > .86 ? '#62958c' : n > .58 ? '#467e80' : '#396d76', x, y)
          if (y % 13 === 0 && surfaceNoise(Math.floor(x / 7), y, seed) > .76) pixel(s, '#91b5a4', x, y)
        }
        // Quay planking follows the water edge; ponds have small lily clusters.
        if (marine) {
          for (let x = body.x * T + 18; x < (body.x + body.width) * T - 18; x += 5) {
            pixel(s, '#6f6048', x, (body.y + body.height) * T - 6, 5, 9)
            pixel(s, '#b19b6c', x, (body.y + body.height) * T - 6, 4, 7)
          }
        } else {
          for (const [ox, oy] of [[-.24, -.12], [.2, .16], [-.1, .25]]) {
            const x = cx + ox! * body.width * T, y = cy + oy! * body.height * T
            pixel(s, '#264f48', x - 3, y, 8, 3); pixel(s, '#73945a', x - 3, y - 1, 6, 3)
            pixel(s, '#d9c395', x - 1, y - 2, 2, 2)
          }
        }
        this.water.push({ x: cx, y: cy, width: body.width * T, height: body.height * T, marine })
      }
      sea.refresh()
      this.images.push(scene.add.image(0, 0, this.keys[3]!).setOrigin(0).setDepth(.5).setName('environment-water'))
      const shipKey = 'harbor-sailboat'
      this.keys.push(shipKey)
      const ship = scene.textures.createCanvas(shipKey, 24, 40)!, b = ship.context
      // Overhead plan: pointed bow, deck planking, gunwales and a low diagonal
      // canvas footprint around the mast. No elevated side-on sail silhouette.
      for (let y = 3; y < 34; y++) {
        const half = y < 12 ? Math.floor((y - 2) * .85) : y > 28 ? 7 - Math.floor((y - 28) * .45) : 8
        pixel(b, '#283f424d', 13 - half, y + 2, half * 2 + 1)
        pixel(b, '#554331', 12 - half, y, half * 2 + 1)
        if (half > 1) pixel(b, y % 4 === 0 ? '#8b6c44' : '#b29460', 13 - half, y, half * 2 - 1)
        pixel(b, '#d0b17a', 12 - half, y, 1)
      }
      pixel(b, '#74573a', 11, 32, 3, 6) // rudder
      pixel(b, '#d1b27a', 6, 27, 12, 2) // stern bench
      pixel(b, '#665039', 12, 9, 1, 19) // mast shadow / centre line
      for (let y = 9; y <= 22; y++) {
        const span = Math.floor((y - 8) * .65)
        pixel(b, '#847b60', 12 - span, y + 1, span + 1)
        pixel(b, y % 4 ? '#ece0b7' : '#cbbb92', 11 - span, y, span + 1)
      }
      for (let y = 14; y < 25; y++) {
        const span = Math.max(1, Math.floor((25 - y) * .6))
        pixel(b, y % 4 ? '#dbcea6' : '#b9a985', 13, y, span)
      }
      pixel(b, '#70563b', 11, 21, 3, 3); pixel(b, '#f3e7be', 11, 21, 2, 1)
      ship.refresh()
      for (const body of this.water.filter(body => body.marine)) {
        const image = scene.add.image(body.x, body.y - 6, shipKey).setDepth(4).setName('harbor-boat')
        this.images.push(image); this.boats.push({ image, y: body.y - 6, phase: 0 })
      }
      this.glints = scene.add.graphics().setDepth(.6).setName('water-ripples')
    }
    const ground = scene.textures.createCanvas(this.keys[0]!, width, height)!
    const walls = scene.textures.createCanvas(this.keys[1]!, width, height)!
    const roads = scene.textures.createCanvas(this.keys[2]!, width, height)!
    const c = ground.context, w = walls.context
    c.imageSmoothingEnabled = w.imageSmoothingEnabled = false
    const materialPattern = (material: number, ctx: Context) => {
      const tile = document.createElement('canvas'); tile.width = tile.height = T
      tile.getContext('2d')!.drawImage(scene.textures.get('period-interiors').getSourceImage() as HTMLCanvasElement, material * T, 0, T, T, 0, 0, T, T)
      return ctx.createPattern(tile, 'repeat')!
    }
    // Rasterise a continuous, gently wandering ribbon. Blur + threshold rounds inward
    // junctions too; antialiasing is snapped back to native pixels before texturing.
    const r = roads.context
    const draft = document.createElement('canvas'); draft.width = width; draft.height = height
    const d = draft.getContext('2d')!
    d.strokeStyle = '#fff'; d.fillStyle = '#fff'; d.lineWidth = 13; d.lineCap = 'round'; d.lineJoin = 'round'
    const formal = snapshot.environment?.pathStyle === 'formal'
    const center = (x: number, y: number) => ({ x: x * T + 8 + (formal ? 0 : Math.sin(y * .61 + seed) * 3), y: y * T + 8 + (formal ? 0 : Math.sin(x * .53 + seed) * 3) })
    const isRoad = (x: number, y: number) => ['path', 'door'].includes(map.tiles[y]?.[x] ?? '')
    type RoadPoint = { x: number; y: number }
    const nodes = new Map<string, RoadPoint>()
    const id = (p: RoadPoint) => `${p.x},${p.y}`
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isRoad(x, y)) nodes.set(`${x},${y}`, { x, y })
    const neighbors = (p: RoadPoint) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => nodes.get(`${p.x + dx!},${p.y + dy!}`)).filter((p): p is RoadPoint => !!p)
    const visited = new Set<string>()
    const edge = (a: RoadPoint, b: RoadPoint) => [id(a), id(b)].sort().join(':')
    // Trace branches first, then closed loops. Corner cutting rounds the entire
    // approach to a bend instead of merely rounding each little tile's corners.
    const ordered = [...nodes.values()].sort((a, b) => Number(neighbors(a).length === 2) - Number(neighbors(b).length === 2))
    for (const start of ordered) for (const neighbor of neighbors(start)) {
      if (visited.has(edge(start, neighbor))) continue
      let previous = start, at = neighbor
      let points = [center(start.x, start.y), center(at.x, at.y)]
      visited.add(edge(start, at))
      while (neighbors(at).length === 2 && id(at) !== id(start)) {
        const next = neighbors(at).find(p => id(p) !== id(previous))!
        if (visited.has(edge(at, next))) break
        visited.add(edge(at, next)); points.push(center(next.x, next.y)); previous = at; at = next
      }
      for (let pass = 0; pass < 3; pass++) {
        const rounded = [points[0]!]
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!, b = points[i]!
          rounded.push({ x: a.x * .75 + b.x * .25, y: a.y * .75 + b.y * .25 }, { x: a.x * .25 + b.x * .75, y: a.y * .25 + b.y * .75 })
        }
        rounded.push(points[points.length - 1]!); points = rounded
      }
      d.beginPath(); points.forEach((p, i) => i ? d.lineTo(p.x, p.y) : d.moveTo(p.x, p.y)); d.stroke()
    }
    r.filter = 'blur(4px)'; r.drawImage(draft, 0, 0); r.filter = 'none'
    const mask = r.getImageData(0, 0, width, height)
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4
      if (!mask.data[i + 3] || !exposed[Math.floor(py / T)]?.[Math.floor(px / T)]) {
        mask.data[i + 3] = 0
        continue
      }
      const noise = formal ? 0 : (field(px, py, 13, seed + 54) - .5) * 40
      // Never paint a ribbon across a wall/interior or outside the quay boundary.
      mask.data[i + 3] = mask.data[i + 3]! > 100 + noise ? 255 : 0
    }
    r.putImageData(mask, 0, 0)
    r.globalCompositeOperation = 'source-in'; r.fillStyle = materialPattern(art.path, r); r.fillRect(0, 0, width, height)
    r.globalCompositeOperation = 'source-over'
    // Keep a generous clear apron around doors, evidence and inspectable furniture.
    const protectedPoints = [
      ...map.doors.map((door) => door.position),
      ...(snapshot.props ?? []).map((prop) => prop.position),
      ...(snapshot.landmarks ?? []).flatMap((item) => [item.position, { x: item.position.x + 1, y: item.position.y + 1 }]),
    ]
    const reserved = (x: number, y: number) => protectedPoints.some((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1)
    // Clip every ground detail to the outdoor footprint, including overhanging fern leaves.
    c.save(); c.beginPath()
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (exposed[y]?.[x] && !reserved(x, y)) c.rect(x * T, y * T, T, T)
    }
    c.clip()
    const secondary = materialPattern(art.secondary, c)
    const lush = art.vegetation > 0
    const civicGarden = art.secondary === 6 && art.id === 'civic'
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
      if (!exposed[y]?.[x] || reserved(x, y)) continue
      const nearWall = x > 2 && y > 2 && x < map.width - 3 && y < map.height - 3 && [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => map.tiles[y + dy!]?.[x + dx!] === 'wall')
      for (let py = y * T; py < (y + 1) * T; py++) for (let px = x * T; px < (x + 1) * T; px++) {
        const garden = civicGarden && this.water.some(body => Math.hypot((px - body.x) / (body.width * .9), (py - body.y) / (body.height * 1.15)) < 1)
        if ((civicGarden ? garden : art.secondary === 3 || art.secondary === 14 ? nearWall && field(px, py, 73, seed + 43) > .66 : field(px, py, 73, seed + 43) > (art.id === 'civic' ? .74 : .60))) { c.fillStyle = secondary; c.fillRect(px, py, 1, 1) }
        if (!lush) continue
        const growth = field(px, py, 37, seed + 74) * 0.7 + field(px, py, 9, seed + 75) * 0.3
        const threshold = 1 - art.vegetation * .55 - (nearWall ? .12 : 0)
        if (growth < threshold - 0.025) continue
        const n = surfaceNoise(Math.floor(px / 2), Math.floor(py / 2), 76)
        const colors = growth < threshold ? ['#716a49', '#80734f', '#656445'] : ['#657846', '#70834a', '#5c7041', '#7a8b50', '#50663d']
        pixel(c, colors[Math.floor(n * colors.length)]!, px, py)
      }
      const n = surfaceNoise(x, y, seed + 78)
      if (lush && n < art.vegetation && (nearWall || field(x * T + 8, y * T + 8, 37, seed + 74) > 0.5)) {
        if (n < 0.36) tuft(c, x * T + 5, y * T + 13, x + y * map.width)
        if (n > 0.70) fern(c, x * T + 9, y * T + 15, x + y * map.width)
        if (nearWall && n < 0.25 && art.vegetation > .25) shrub(c, x * T + 7, y * T + 13, x + y * map.width)
        // Roots and fallen ochre leaves interrupt the lawn as well as the paving.
        if (n > 0.36 && n < 0.5) {
          pixel(c, '#514e35', x * T + 4, y * T + 9, 5, 1)
          pixel(c, '#716144', x * T + 8, y * T + 10, 3, 1)
          pixel(c, '#b09b60', x * T + 5, y * T + 6, 2, 1)
        }
      }
    }
    c.restore()
    if (waterBodies.length) { c.globalCompositeOperation = 'destination-out'; c.drawImage(scene.textures.get(this.keys[3]!).getSourceImage() as HTMLCanvasElement, 0, 0); c.globalCompositeOperation = 'source-over' }
    c.globalCompositeOperation = 'destination-out'; c.drawImage(roads.getSourceImage() as HTMLCanvasElement, 0, 0); c.globalCompositeOperation = 'source-over'
    // Vines belong to masonry, not floors or doorways. The mask preserves entrances and signs.
    w.save(); w.beginPath()
    for (let y = 2; y < map.height - 2; y++) for (let x = 2; x < map.width - 2; x++) {
      if (map.tiles[y]?.[x] === 'wall' && !reserved(x, y)) w.rect(x * T, y * T, T, T)
    }
    w.clip()
    for (let y = 2; y < map.height - 2; y++) for (let x = 2; x < map.width - 2; x++) {
      if (map.tiles[y]?.[x] !== 'wall' || surfaceNoise(x, y, 79) > art.vines * .5) continue
      vine(w, x * T + 5, y * T, x + y * map.width)
      if (surfaceNoise(x, y, 80) < 0.3) vine(w, x * T + 11, y * T + 3, x + y * map.width + 5)
    }
    w.restore()
    // Solid freestanding props come from core, so every painted cart/crate has collision.
    const propKinds = [...new Set((map.scenery ?? []).map(item => item.kind))]
    if (propKinds.length) {
      const key = 'outdoor-prop-atlas'; this.keys.push(key)
      const atlas = scene.textures.createCanvas(key, propKinds.length * 40, 40)!
      propKinds.forEach((kind, index) => {
        atlas.context.save(); atlas.context.beginPath(); atlas.context.rect(index * 40, 0, 40, 40); atlas.context.clip()
        decoration(atlas.context, kind, index * 40 + 19, 32, index + seed)
        atlas.context.restore(); atlas.add(kind, 0, index * 40, 0, 40, 40)
      })
      atlas.refresh()
      for (const item of map.scenery ?? []) {
        const image = scene.add.image(item.x * T + 8, item.y * T + 8, key, item.kind).setOrigin(19 / 40, 32 / 40).setDepth(10 + item.y / 1000).setName(`outdoor-prop-${item.kind}`)
        this.images.push(image)
        if (['fern', 'palm', 'planter', 'flowerbed', 'cypress', 'awning', 'canopy', 'laundry'].includes(item.kind)) this.foliage.push({ image, phase: item.x + item.y, strength: item.kind === 'palm' ? .016 : .009 })
      }
    }
    ground.refresh(); walls.refresh(); roads.refresh()
    this.images.push(scene.add.image(0, 0, this.keys[2]!).setOrigin(0).setDepth(.7).setName('environment-paths'))
    this.images.push(scene.add.image(0, 0, this.keys[0]!).setOrigin(0).setDepth(1.3).setName('environment-ground'))
    this.images.push(scene.add.image(0, 0, this.keys[1]!).setOrigin(0).setDepth(3.5).setName('environment-walls'))
  }

  update(delta: number, reduced: boolean): void {
    if (reduced) return
    this.elapsed += Math.min(delta, 100)
    for (const plant of this.foliage) plant.image.rotation = Math.sin(this.elapsed / 850 + plant.phase) * plant.strength * this.wind
    for (const boat of this.boats) boat.image.y = boat.y + Math.round(Math.sin(this.elapsed / 950 + boat.phase) * 2)
    this.glints?.clear()
    for (const body of this.water) {
      for (let i = 0; i < 7; i++) {
        const phase = (this.elapsed / 1800 + i * .37) % 1
        const x = body.x + (surfaceNoise(i, 3) - .5) * body.width * .65
        const y = body.y + (surfaceNoise(i, 4) - .5) * body.height * .5
        this.glints?.lineStyle(1, 0xb5d3ca, Math.sin(phase * Math.PI) * .35).lineBetween(Math.round(x - 3 - phase * 6), Math.round(y), Math.round(x + 3 + phase * 6), Math.round(y))
      }
      if (!body.marine) {
        // A tiny waterbird circles slowly within the pool; two pixel paddles trail it.
        const x = Math.round(body.x + Math.sin(this.elapsed / 11000) * body.width * .19)
        const y = Math.round(body.y + Math.cos(this.elapsed / 14000) * body.height * .15)
        this.glints?.fillStyle(0xdacfa7).fillRect(x - 2, y, 5, 3).fillRect(x + 2, y - 2, 2, 3)
          .fillStyle(0xc7935c).fillRect(x + 4, y - 1, 2, 1)
      }
    }
  }

  destroy(): void {
    this.glints?.destroy()
    this.images.forEach((image) => image.destroy())
    this.keys.forEach((key) => { if (this.scene.textures.exists(key)) this.scene.textures.remove(key) })
  }
}
