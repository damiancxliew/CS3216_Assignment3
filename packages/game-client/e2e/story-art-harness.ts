import Phaser from 'phaser'
import { compileStage, spaceAt, findPath, type Point, type RoomShape, type RoomSize, type Enclosure, type LandmarkKind } from '@adventure/game-core'
import { createTiledMapView } from '../src/tiled-view.js'
import type { PlaygroundSnapshot } from '../src/model.js'
import { STORY_ART, MATERIAL_NAMES, type EnvironmentPlan, type StoryArt } from '../src/story-art.js'

type Example = { title: string; context: string; rooms: Array<[string, RoomSize, Enclosure, LandmarkKind]> }
const examples: Record<string, Example> = {
  civic: { title: 'CIVIC DISTRICT · elections and the press', context: 'A working city district with newspaper offices, public records and an assembly hall.', rooms: [['Press Room', 'medium', 'enclosed', 'table'], ['Records Archive', 'small', 'enclosed', 'shelf'], ['Assembly Hall', 'large', 'enclosed', 'monument']] },
  harbor: { title: 'TRADING HARBOUR · cargo and diplomacy', context: 'A coastal harbor of wooden jetties, a customs house and merchant warehouses.', rooms: [['Customs House', 'small', 'enclosed', 'table'], ['Cargo Warehouse', 'medium', 'enclosed', 'shelf'], ['Open Quay', 'large', 'open', 'dock']] },
  desert: { title: 'CARAVAN MARKET · trade at an oasis', context: 'A dry desert trading post, with a shaded bazaar, sandstone court and caravan tents.', rooms: [['Shaded Bazaar', 'large', 'open', 'stall'], ['Caravan Tent', 'small', 'enclosed', 'table'], ['Oasis Court', 'medium', 'enclosed', 'well']] },
  jungle: { title: 'RAINFOREST CAMP · an expedition inland', context: 'A jungle expedition with a bamboo field station, wooded trail and a river camp.', rooms: [['Field Station', 'small', 'enclosed', 'table'], ['Forest Trail', 'large', 'open', 'tree'], ['River Camp', 'medium', 'open', 'hearth']] },
  industrial: { title: 'INDUSTRIAL YARD · workers and production', context: 'A brick factory, boiler workshop and loading yard in an industrial settlement.', rooms: [['Factory Floor', 'large', 'enclosed', 'table'], ['Boiler Workshop', 'small', 'enclosed', 'hearth'], ['Loading Yard', 'medium', 'open', 'shelf']] },
  winter: { title: 'SNOWBOUND SETTLEMENT · supplies before the thaw', context: 'A snowy northern settlement, with a timber lodge, supply depot and frozen square.', rooms: [['Winter Lodge', 'medium', 'enclosed', 'hearth'], ['Supply Depot', 'small', 'enclosed', 'shelf'], ['Frozen Square', 'large', 'open', 'monument']] },
}
const style = new URLSearchParams(location.search).get('style') ?? 'civic'
const example = examples[style] ?? examples.civic!
const profile = STORY_ART[style as StoryArt['id']] ?? STORY_ART.civic
// Manual fixtures remain explicitly labelled until the optional live production call succeeds.
let production: any = null
if (new URLSearchParams(location.search).get('production') === '1') {
  const response = await fetch('/e2e/story-plans.generated.json')
  if (response.ok) production = (await response.json()).find((p: any) => p.id === style)
}
const shapes: RoomShape[] = ['courtyard-wing', 'octagonal', 'rounded']
const rooms = production ? production.rooms.map((r: any, i: number) => ({ ...r, kind: r.landmark, id: `place-${i}`, doorDefault: r.enclosure === 'open' ? null : 'open' })) : example.rooms.map(([name, size, enclosure, kind], i) => ({ id: `place-${i}`, name, size, enclosure, kind, shape: shapes[i]!, doorDefault: enclosure === 'open' ? null : 'open' as const }))
const environment: EnvironmentPlan = production?.environment ?? {
  description: example.context, ground: MATERIAL_NAMES[profile.ground]!, accent: MATERIAL_NAMES[profile.secondary]!, path: MATERIAL_NAMES[profile.path]!,
  pathStyle: style === 'civic' ? 'worn' : 'winding', roof: style === 'civic' ? 'terracotta' : style === 'desert' ? 'canvas' : style === 'winter' || style === 'industrial' ? 'slate' : 'timber',
  waterfront: style === 'harbor' ? 'harbor' : 'none', vegetation: profile.vegetation,
  propDensity: 'busy', props: [...profile.decorations],
}
const compiled = compileStage({ stageId: style, spawnRoomId: rooms[0]!.id, rooms, landscape: { layout: environment.layout ?? (style === 'harbor' ? 'quayside' : style === 'desert' ? 'meandering' : 'garden-loop'), water: environment.waterfront }, scenery: { palette: environment.props, density: environment.propDensity },
  landmarks: rooms.map((r: any) => ({ roomId: r.id, kind: r.kind })),
  placements: [...rooms.map((r: any, i: number) => ({ id: `actor-${i}`, kind: 'actor' as const, roomId: r.id })), { id: 'decision', kind: 'decision', roomId: rooms[0]!.id }],
}, `story-preview-${style}`)
const actors = [{ id: 'player', name: 'You', position: compiled.playerSpawn, sprite: 'Boy' }, ...compiled.placements.filter((p) => p.kind === 'actor').map((p, i) => ({ id: p.id, name: ['Local guide', 'Keeper', 'Trader'][i]!, position: p.position, sprite: ['Inspector', 'OldMan', 'Villager2'][i]! }))]
export const snapshot: PlaygroundSnapshot = {
  seed: style, map: compiled.map, doors: compiled.initialDoors,
  actors: actors.map((a) => ({ ...a, space: spaceAt(compiled.map, a.position), targetRoomId: null, status: 'idle' })),
  playerGoal: null, playerStatus: 'idle', running: true, npcRoutes: false, revision: 0,
  roomNames: Object.fromEntries(rooms.map((r: any) => [r.id, r.name])),
  roomDescriptions: Object.fromEntries(rooms.map((r: any) => [r.id, r.name])),
  storyContext: production?.context ?? example.context, visualStyle: production?.visualStyle ?? profile.id, environment,
  ambient: production?.ambient ?? { id: style === 'winter' ? 'snow' : 'clear', intensity: 1 }, audio: { muted: true },
  landmarks: compiled.map.landmarks!.map((l) => ({ id: l.roomId, roomId: l.roomId, name: ({ table: 'Writing table', shelf: 'Storage shelves', monument: 'Memorial', dock: 'Landing stage', stall: 'Market stall', well: 'Water well', tree: 'Old tree', hearth: 'Hearth' })[l.kind], kind: l.kind, position: { x: l.x, y: l.y }, width: 2, height: 2 })),
}
export let game!: Phaser.Game
const prototype = Phaser.Game.prototype as unknown as { boot: (this: Phaser.Game) => void }
const boot = prototype.boot
prototype.boot = function () { game = this; boot.call(this) }
document.body.style.cssText = `margin:0;background:${profile.background};font-family:system-ui;color:#f0e4c9`
const heading = document.createElement('header')
heading.style.cssText = 'box-sizing:border-box;height:64px;padding:12px 24px;background:#1e302f'
heading.textContent = production?.title ?? example.title
const caption = document.createElement('div'); caption.style.cssText = 'font-size:12px;opacity:.7;margin-top:4px'; caption.textContent = production ? 'Preview / server LLM art direction · walk into a building to reveal its interior' : 'Authored preview fixture · production API authentication pending · walk into a building to reveal its interior'
heading.append(caption)
const parent = document.createElement('div'); parent.style.cssText = 'width:100vw;height:calc(100vh - 64px)'
document.body.replaceChildren(heading, parent)
export const view = await createTiledMapView(parent, structuredClone(snapshot), destination => { void walkTo(destination) }, false, { assetBase: '/game/ninja' })
prototype.boot = boot
const scene = game.scene.getScene('tiled-map')
const camera = scene.cameras.main
let overview = false
function toggleOverview(): void {
  overview = !overview
  if (overview) {
    ;(scene as any).following = false
    camera.stopFollow(); camera.removeBounds()
    camera.setZoom(Math.min(parent.clientWidth / (compiled.map.width * 16 + 24), parent.clientHeight / (compiled.map.height * 16 + 24)))
    camera.centerOn(compiled.map.width * 8, compiled.map.height * 8)
  } else (scene as any).fitCamera()
  overviewButton.textContent = overview ? 'Detail view' : 'Whole map'
}

let walking = 0
export async function walkTo(destination: Point): Promise<void> {
  const player = snapshot.actors.find(a => a.id === 'player')!
  const path = findPath(snapshot.map, snapshot.doors, player.position, destination)
  if (!path) return
  const run = ++walking
  for (const step of path) {
    if (run !== walking) return
    player.position = step; player.space = spaceAt(snapshot.map, step); player.status = 'moving'
    snapshot.revision++; view.render(structuredClone(snapshot))
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  player.status = 'idle'; snapshot.revision++; view.render(structuredClone(snapshot))
}
const controls = document.createElement('nav')
controls.style.cssText = 'position:fixed;bottom:12px;left:12px;display:flex;gap:6px;flex-wrap:wrap;max-width:95vw'
for (const room of snapshot.map.rooms.filter(r => r.enclosure === 'enclosed')) {
  const door = snapshot.map.doors.find(d => d.roomId === room.id)!
  const button = document.createElement('button'); button.textContent = `Enter ${snapshot.roomNames?.[room.id]}`
  button.style.cssText = 'border:1px solid #9ba790;border-radius:8px;background:#233b35;color:#f0e4c9;padding:8px 12px;cursor:pointer'
  button.onclick = () => { void walkTo(door.inside) }; controls.append(button)
}
const exit = document.createElement('button'); exit.textContent = 'Walk outside'
exit.style.cssText = 'border:1px solid #9ba790;border-radius:8px;background:#233b35;color:#f0e4c9;padding:8px 12px;cursor:pointer'
exit.onclick = () => { const player = snapshot.actors.find(a => a.id === 'player')!; const here = spaceAt(snapshot.map, player.position); const door = snapshot.map.doors.find(d => here?.kind === 'room' && d.roomId === here.roomId) ?? snapshot.map.doors[0]!; void walkTo(door.outside) }
controls.append(exit)
const overviewButton = document.createElement('button'); overviewButton.textContent = 'Whole map'; overviewButton.style.cssText = exit.style.cssText; overviewButton.onclick = toggleOverview
controls.append(overviewButton); document.body.append(controls)

Object.assign(window, { storyHarness: { game, view, snapshot, walkTo } })
if (import.meta.hot) import.meta.hot.dispose(() => { walking++; view.destroy() })
