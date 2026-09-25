import Phaser from 'phaser'
import { type MapRoom, spaceAt } from '@adventure/game-core'
import type { PlaygroundSnapshot } from './model.js'
import { roomMaterial, type StoryArt } from './story-art.js'
import { materialTile, MATERIAL_COUNT, roomFinish, surfaceNoise } from './materials.js'
const T = 16

/** Curved native-resolution outlines follow the compiler's cut-away footprint. */
function outline(c: CanvasRenderingContext2D, room: MapRoom): void {
  const w = room.width * T, h = room.height * T, inset = 6
  c.beginPath()
  if (room.shape === 'rounded') { c.roundRect(inset, inset, w - inset * 2, h - inset * 2, 39); return }
  const points = room.shape === 'octagonal'
    ? [[37, inset], [w - 37, inset], [w - inset, 37], [w - inset, h - 37], [w - 37, h - inset], [37, h - inset], [inset, h - 37], [inset, 37]]
    : room.shape === 'courtyard-wing'
      ? [[Math.floor(room.width / 3) * T + inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset], [inset, Math.floor(room.height / 2) * T + inset], [Math.floor(room.width / 3) * T + inset, Math.floor(room.height / 2) * T + inset]]
      : [[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]]
  // Round BOTH convex and concave corners (including the L-shaped wing).
  points.forEach((point, i) => {
    const previous = points[(i + points.length - 1) % points.length]!, next = points[(i + 1) % points.length]!
    const approach = (p: number[]) => {
      const d = Math.hypot(p[0]! - point[0]!, p[1]! - point[1]!)
      return [point[0]! + (p[0]! - point[0]!) * Math.min(7, d / 3) / d, point[1]! + (p[1]! - point[1]!) * Math.min(7, d / 3) / d]
    }
    const a = approach(previous), b = approach(next)
    if (!i) c.moveTo(a[0]!, a[1]!); else c.lineTo(a[0]!, a[1]!)
    c.quadraticCurveTo(point[0]!, point[1]!, b[0]!, b[1]!)
  })
  c.closePath()
}

export class RoomShells {
  private images: Phaser.GameObjects.Image[] = []
  private roofs = new Map<string, { image: Phaser.GameObjects.Image; covered: boolean }>()
  private keys: string[] = []
  constructor(private scene: Phaser.Scene, snapshot: PlaygroundSnapshot, art: StoryArt) {
    for (const room of snapshot.map.rooms) {
      if (room.enclosure !== 'enclosed') continue
      const w = room.width * T, h = room.height * T
      const shellKey = `room-shell-${room.id}`, roofKey = `room-roof-${room.id}`
      this.keys.push(shellKey, roofKey)
      const shell = scene.textures.createCanvas(shellKey, w, h)!, c = shell.context
      const material = roomMaterial(`${snapshot.roomNames?.[room.id] ?? ''} ${snapshot.roomDescriptions?.[room.id] ?? ''}`, art)
      const finish = roomFinish(`${snapshot.storyContext ?? snapshot.seed}:${room.id}`)
      outline(c, room); c.save(); c.clip()
      const atlas = scene.textures.get('period-interiors').getSourceImage() as HTMLCanvasElement
      for (let yy = 0; yy < room.height; yy++) for (let xx = 0; xx < room.width; xx++) {
        const index = materialTile(material, xx, yy, finish.seed) - 1000
        c.drawImage(atlas, (index % MATERIAL_COUNT) * T, Math.floor(index / MATERIAL_COUNT) * T, T, T, xx * T, yy * T, T, T)
      }
      c.fillStyle = `rgba(85,70,45,${(finish.seed % 5) * .018})`; c.fillRect(0, 0, w, h); c.restore()
      c.lineJoin = 'round'; c.lineWidth = 11; c.strokeStyle = art.wallShade; c.stroke()
      c.lineWidth = 7; c.strokeStyle = art.wallColor; c.stroke()
      c.lineWidth = 1; c.strokeStyle = art.wallLight; c.stroke()
      // Opening follows authoritative door placement, including north entrances.
      for (const door of snapshot.map.doors.filter(d => d.roomId === room.id)) {
        c.clearRect((door.position.x - room.x) * T, (door.position.y - room.y) * T, T, T)
      }
      shell.refresh()
      this.images.push(scene.add.image(room.x * T, room.y * T, shellKey).setOrigin(0).setDepth(2.2).setName(shellKey))
      const roof = scene.textures.createCanvas(roofKey, w, h)!, r = roof.context
      const roofType = snapshot.environment?.roof ?? (art.id === 'civic' ? 'terracotta' : art.id === 'desert' ? 'canvas' : art.id === 'jungle' || art.id === 'village' ? 'thatch' : art.id === 'industrial' || art.id === 'winter' ? 'slate' : 'timber')
      const colors = { terracotta: ['#7d5145', '#a87158', '#c58e69'], slate: ['#40565c', '#637b7e', '#8b9b99'], thatch: ['#74623f', '#a09058', '#c9b575'], canvas: ['#9c8963', '#d6bd8b', '#f0dcaa'], timber: ['#655644', '#917a56', '#b39c73'] }[roofType]
      r.save(); outline(r, room); r.clip(); r.fillStyle = colors[1]!; r.fillRect(0, 0, w, h)
      if (roofType === 'canvas') {
        // Broad fabric panels and seams, never masonry printed onto a tent.
        for (let x = 0; x < w; x += 18) {
          r.fillStyle = Math.floor(x / 18) % 2 ? '#c6aa78' : '#e0c998'; r.fillRect(x, 0, 18, h)
          r.fillStyle = '#ac926466'; r.fillRect(x, 0, 1, h)
          r.fillStyle = '#f4e3bc88'; r.fillRect(x + 2, 0, 2, h)
        }
      } else if (roofType === 'timber' || roofType === 'thatch') {
        for (let x = 0; x < w; x += roofType === 'timber' ? 7 : 3) {
          r.fillStyle = colors[0]!; r.fillRect(x, 0, 1, h)
          r.fillStyle = colors[2]!; r.fillRect(x + 1, 0, 1, h)
          for (let y = 0; y < h; y += 19) {
            r.fillStyle = colors[0]!; r.fillRect(x, y + Math.round(surfaceNoise(x, y, 28) * 8), roofType === 'timber' ? 7 : 3, 1)
          }
        }
      } else {
        for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 8) {
          const dx = x + (Math.floor(y / 6) % 2) * 4
          r.fillStyle = colors[0]!; r.fillRect(dx, y + 3, 8, 1); r.fillRect(dx + 1, y + 4, 6, 1)
          r.fillStyle = colors[2]!; r.fillRect(dx + 1, y, 1, 3); r.fillRect(dx + 2, y + 1, 1, 3)
          r.fillStyle = colors[0]!; r.fillRect(dx + 7, y, 1, 3)
        }
      }
      const facet = (points: number[][], color: string) => {
        r.beginPath(); points.forEach(([x, y], i) => i ? r.lineTo(Math.round(x!), Math.round(y!)) : r.moveTo(Math.round(x!), Math.round(y!)))
        r.closePath(); r.fillStyle = color; r.fill()
      }
      const seam = (points: number[][], width = 2) => {
        r.beginPath(); points.forEach(([x, y], i) => i ? r.lineTo(Math.round(x!), Math.round(y!)) : r.moveTo(Math.round(x!), Math.round(y!)))
        r.lineWidth = width; r.lineJoin = 'round'; r.strokeStyle = colors[0]!; r.stroke()
        r.lineWidth = 1; r.strokeStyle = colors[2]!; r.stroke()
      }
      const hip = (x: number, y: number, rw: number, rh: number) => {
        const ridgeY = y + rh * .44, left = x + Math.min(rw * .3, rh * .38), right = x + rw - Math.min(rw * .3, rh * .38)
        facet([[x, y], [x + rw, y], [right, ridgeY], [left, ridgeY]], '#fff1ca18')
        facet([[left, ridgeY], [right, ridgeY], [x + rw, y + rh], [x, y + rh]], '#282c3235')
        facet([[x + rw, y], [x + rw, y + rh], [right, ridgeY]], '#202a354c')
        seam([[x, y], [left, ridgeY], [x, y + rh]])
        seam([[x + rw, y], [right, ridgeY], [x + rw, y + rh]])
        seam([[left, ridgeY], [right, ridgeY]], 5)
        for (let xx = left + 2; xx < right; xx += 7) { r.fillStyle = colors[0]!; r.fillRect(Math.round(xx), Math.round(ridgeY - 2), 1, 5) }
      }
      if (roofType === 'canvas' || room.shape === 'octagonal') {
        const cx = w * .5, cy = h * .46
        const ring = [[7, 7], [w / 2, 7], [w - 7, 7], [w - 7, h / 2], [w - 7, h - 7], [w / 2, h - 7], [7, h - 7], [7, h / 2]]
        ring.forEach((point, i) => {
          facet([[cx, cy], point, ring[(i + 1) % ring.length]!], i < 3 ? '#fff5cd22' : i < 6 ? '#4c42382c' : '#fff5cd0c')
          seam([[cx, cy], point], 1)
        })
        if (roofType === 'canvas') {
          r.fillStyle = colors[0]!; r.fillRect(cx - 3, cy - 4, 6, 7)
          r.fillStyle = colors[2]!; r.fillRect(cx - 2, cy - 5, 4, 3)
        } else {
          // A raised cupola gives the ceremonial building its own silhouette.
          facet([[cx - 15, cy], [cx, cy - 12], [cx + 15, cy], [cx + 10, cy + 7], [cx - 10, cy + 7]], colors[0]!)
          r.fillStyle = '#dccba5'; r.fillRect(cx - 9, cy + 4, 18, 11)
          for (let dx = -6; dx <= 6; dx += 6) { r.fillStyle = '#344845'; r.fillRect(cx + dx - 1, cy + 6, 3, 6) }
          seam([[cx - 16, cy + 3], [cx, cy - 9], [cx + 16, cy + 3]], 3)
        }
      } else if (room.shape === 'courtyard-wing') {
        const elbowX = Math.floor(room.width / 3) * T + 6, elbowY = Math.floor(room.height / 2) * T + 6
        hip(elbowX, 6, w - elbowX - 6, h - 12)
        hip(6, elbowY, w - 12, h - elbowY - 6)
      } else hip(6, 6, w - 12, h - 12)
      if (roofType !== 'canvas' && roofType !== 'thatch' && room.shape !== 'octagonal') {
        // Twin dormers, brick chimney, flue shadow and copper flashing.
        for (const dx of [.32, .68]) {
          const x = Math.round(w * dx), y = Math.round(h * .7)
          r.fillStyle = '#28322e44'; r.fillRect(x - 3, y + 3, 17, 14)
          r.fillStyle = '#c9b995'; r.fillRect(x - 7, y, 14, 11)
          r.fillStyle = '#3c5354'; r.fillRect(x - 4, y + 2, 8, 7)
          r.fillStyle = '#d5c299'; r.fillRect(x, y + 2, 1, 7)
          facet([[x - 10, y], [x, y - 8], [x + 10, y]], colors[0]!)
          seam([[x - 10, y], [x, y - 8], [x + 10, y]])
        }
        const x = Math.round(w * .77), y = Math.round(h * .24)
        r.fillStyle = '#282e3140'; r.fillRect(x + 5, y + 2, 9, 19)
        r.fillStyle = '#8f7562'; r.fillRect(x, y, 9, 15)
        r.fillStyle = '#c0a386'; r.fillRect(x - 2, y - 2, 13, 4)
        r.fillStyle = '#3c4140'; r.fillRect(x + 1, y - 1, 7, 2)
        for (let yy = y + 5; yy < y + 14; yy += 4) { r.fillStyle = '#604f45'; r.fillRect(x, yy, 9, 1) }
      }
      for (let i = 0; i < 20; i++) {
        r.fillStyle = '#f1dca51b'; r.fillRect(surfaceNoise(i, w, 12) * w, surfaceNoise(i, h, 14) * h, 3, 1)
      }
      r.restore(); outline(r, room); r.lineWidth = 5; r.strokeStyle = colors[0]!; r.stroke()
      r.lineWidth = 1; r.strokeStyle = colors[2]!; r.stroke()
      roof.refresh()
      const image = scene.add.image(room.x * T, room.y * T, roofKey).setOrigin(0).setDepth(35).setName(roofKey)
      this.roofs.set(room.id, { image, covered: true })
    }
    this.reveal(snapshot, true)
  }
  reveal(snapshot: PlaygroundSnapshot, reduced: boolean): void {
    const player = snapshot.actors.find(a => a.id === 'player')
    const location = player ? spaceAt(snapshot.map, player.position) : null
    for (const [id, roof] of this.roofs) {
      const covered = location?.kind !== 'room' || location.roomId !== id
      if (roof.covered === covered && !reduced) continue
      roof.covered = covered
      this.scene.tweens.killTweensOf(roof.image)
      if (reduced) roof.image.setAlpha(covered ? 1 : 0)
      else this.scene.tweens.add({ targets: roof.image, alpha: covered ? 1 : 0, duration: covered ? 420 : 300, ease: 'Sine.easeInOut' })
    }
  }
  destroy(): void {
    for (const { image } of this.roofs.values()) { this.scene.tweens.killTweensOf(image); image.destroy() }
    this.images.forEach(image => image.destroy())
    this.keys.forEach(key => this.scene.textures.remove(key))
  }
}
