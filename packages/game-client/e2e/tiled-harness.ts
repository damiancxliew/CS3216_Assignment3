import Phaser from 'phaser'
import { compileStage, spaceAt } from '@adventure/game-core'
import type { PlaygroundSnapshot } from '../src/model.js'
import { createTiledMapView } from '../src/tiled-view.js'

// Synthetic public data only. This harness is loaded explicitly by the browser test.
const compiled = compileStage({
  stageId: 'newsroom', spawnRoomId: 'city',
  rooms: ['city', 'photos', 'archive', 'wire'].map((id) => ({ id, size: 'medium', doorDefault: 'open' })),
  landmarks: ['city', 'photos', 'archive', 'wire'].map((roomId) => ({ roomId, kind: 'shelf' })),
  placements: [{ id: 'decision', kind: 'decision', roomId: 'city' }],
}, 'newsroom-labels')
const city = compiled.map.rooms.find((room) => room.id === 'city')!
const wire = compiled.map.rooms.find((room) => room.id === 'wire')!
const playerPosition = { x: city.x + 3, y: city.y + 5 }
const person = (id: string, name: string, x: number, y: number) => ({
  id, name, position: { x, y }, space: spaceAt(compiled.map, { x, y }), targetRoomId: null, status: 'idle' as const,
  sprite: id === 'player' ? 'Boy' : 'Princess', spriteSheetUrl: null as string | null,
})
export const snapshot: PlaygroundSnapshot = {
  seed: 'newsroom-labels', map: compiled.map, doors: compiled.initialDoors,
  actors: [person('player', 'You', playerPosition.x, playerPosition.y), person('tojo', 'Hideki Tojo', city.x + 5, city.y + 4), person('hitler', 'Adolf Hitler', wire.x + 3, wire.y + 5)],
  props: [
    { id: 'card', name: 'Fascism Source Card', position: { x: city.x + 3, y: city.y + 4 }, found: false },
    { id: 'brief', name: 'Japan Militarism Brief', position: { x: wire.x + 4, y: wire.y + 4 }, found: false },
  ],
  landmarks: compiled.map.landmarks!.map((landmark) => ({
    id: landmark.roomId, roomId: landmark.roomId, kind: landmark.kind,
    name: ({ city: 'Wire Basket', photos: 'Caption Filing Cabinet', archive: 'Versailles Drawer', wire: 'Shortwave Set' } as Record<string, string>)[landmark.roomId]!,
    description: landmark.roomId === 'city' ? 'Typewriter on a city desk' : '',
    position: { x: landmark.x, y: landmark.y }, width: 2, height: 2,
  })),
  roomNames: { city: 'City Desk', photos: 'Photo Morgue', archive: 'Treaty Archive', wire: 'Wire Booth' },
  playerGoal: null, playerStatus: 'idle', running: true, npcRoutes: false, revision: 0,
  audio: { muted: true }, ambient: { id: 'clear', intensity: 1 },
}

export const clicks: string[] = []
export let game: Phaser.Game
const prototype = Phaser.Game.prototype as unknown as { boot: (this: Phaser.Game) => void }
const boot = prototype.boot
prototype.boot = function () { game = this; boot.call(this) }
const parent = document.createElement('div')
parent.style.cssText = 'width:100vw;height:100vh;background:#202b2b'
document.body.replaceChildren(parent)
document.body.style.margin = '0'
export const view = await createTiledMapView(parent, snapshot, () => clicks.push('walk'), true, {
  assetBase: '/game/ninja',
  onActor: (id) => clicks.push(`actor:${id}`), onProp: (id) => clicks.push(`prop:${id}`), onLandmark: (id) => clicks.push(`landmark:${id}`),
})
prototype.boot = boot

export function captions() {
  return game.scene.getScene('tiled-map').children.list
    .filter((child): child is Phaser.GameObjects.Text => child instanceof Phaser.GameObjects.Text && child.visible)
    .map((child) => ({ text: child.text, ...child.getBounds() }))
}

export function inspect() {
  const scene = game.scene.getScene('tiled-map')
  const containers = scene.children.list.filter((child): child is Phaser.GameObjects.Container => child instanceof Phaser.GameObjects.Container)
  const sprites = containers.flatMap((container) => container.list.filter((child): child is Phaser.GameObjects.Sprite => child instanceof Phaser.GameObjects.Sprite))
  const generatedSprite = sprites.find((sprite) => sprite.texture.key.startsWith('asset-'))
  return {
    captions: captions(),
    stockSprites: sprites.map((sprite) => sprite.texture.key),
    images: containers.flatMap((container) => container.list.filter((child): child is Phaser.GameObjects.Image => child instanceof Phaser.GameObjects.Image).map((image) => image.texture.key)),
    generatedLeftFrames: generatedSprite ? scene.anims.get(`${generatedSprite.texture.key}-left`)?.frames.map((frame) => Number(frame.textureFrame)) ?? [] : [],
    ground: (scene.children.list.find((child) => child instanceof Phaser.Tilemaps.TilemapLayer && child.layer.name === 'ground') as Phaser.Tilemaps.TilemapLayer).getTileAt(1, 1)?.index,
  }
}

export function pointFor(text: string) {
  const label = captions().find((caption) => caption.text.startsWith(text))!
  const camera = game.scene.getScene('tiled-map').cameras.main
  return {
    x: (label.x + label.width / 2 - camera.scrollX - camera.width / 2) * camera.zoom + camera.width / 2,
    y: (label.y + label.height / 2 - camera.scrollY - camera.height / 2) * camera.zoom + camera.height / 2,
  }
}
