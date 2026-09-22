import type { Point } from '@adventure/game-core'
import { PlaygroundModel, type PlaygroundSnapshot } from './model.js'
import { roomNames } from './fixture.js'
import type { MapView } from './view.js'

let mountCounter = 0

export interface PlaygroundOptions { seed?: string }
export interface PlaygroundHandle { getSnapshot(): PlaygroundSnapshot; destroy(): void }

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function button(label: string, className = 'button'): HTMLButtonElement {
  const node = element('button', className)
  node.type = 'button'
  node.textContent = label
  return node
}

const MOVEMENT_DELTAS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
}

export async function mountPlayground(root: HTMLElement, options: PlaygroundOptions = {}): Promise<PlaygroundHandle> {
  const model = new PlaygroundModel(options.seed ?? 'harbor-demo')
  const controller = new AbortController()
  const mountId = ++mountCounter
  const wrapper = element('div', 'playground')
  const header = element('header', 'page-header')
  const title = element('h1')
  title.textContent = 'The Settlement'
  const eyebrow = element('p', 'eyebrow')
  eyebrow.textContent = 'MAP PLAYGROUND'
  header.append(title, eyebrow)
  wrapper.append(header)

  const toolbar = element('section', 'toolbar')
  const seedForm = element('form', 'seed-form')
  seedForm.noValidate = true
  const seedLabel = element('label')
  seedLabel.textContent = 'Layout seed'
  const seedInput = element('input')
  seedInput.type = 'text'
  seedInput.maxLength = 64
  seedInput.pattern = '[A-Za-z0-9._\\-]{1,64}'
  seedInput.value = model.snapshot().seed
  seedInput.id = `layout-seed-${mountId}`
  seedLabel.htmlFor = seedInput.id
  const generate = button('Generate map')
  generate.type = 'submit'
  const seedError = element('div', 'form-error')
  seedError.id = `seed-error-${mountId}`
  seedError.setAttribute('role', 'alert')
  seedError.hidden = true
  seedInput.setAttribute('aria-describedby', seedError.id)
  seedInput.setAttribute('aria-invalid', 'false')
  seedForm.append(seedLabel, seedInput, generate, seedError)
  const reset = button('Reset map')
  const pause = button('Pause simulation')
  const step = button('Step simulation')
  const routeLabel = element('label', 'check-label')
  const routes = element('input')
  routes.type = 'checkbox'
  routes.checked = true
  routeLabel.append(routes, document.createTextNode(' Scripted NPC routes'))
  toolbar.append(seedForm, reset, pause, step, routeLabel)
  wrapper.append(toolbar)

  const content = element('main', 'content-grid')
  const mapColumn = element('section', 'map-column')
  const mapHeading = element('h2')
  mapHeading.textContent = 'Settlement map'
  const mapHost = element('div', 'map-host')
  const instructions = element('p', 'instructions')
  instructions.id = `map-instructions-${mountId}`
  instructions.textContent = 'Focus the map and hold arrow keys or WASD to walk. Release to stop; choose a destination to auto-walk. Pause stops routes; manual movement remains available.'
  mapHost.setAttribute('aria-describedby', instructions.id)
  const metadata = element('p', 'map-meta')
  const legend = element('div', 'legend')
  const legendEntries: Array<[string, string]> = [['You', 'player'], ['NPC', 'npc'], ['Open door', 'open'], ['Closed door', 'closed'], ['Path', 'path']]
  legendEntries.forEach(([label, kind]) => {
    const item = element('span', `legend-item legend-${kind}`)
    item.textContent = label
    legend.append(item)
  })
  mapColumn.append(mapHeading, mapHost, instructions, metadata, legend)

  const sidebar = element('aside', 'sidebar')
  const statusHeading = element('h2')
  statusHeading.textContent = 'Travel status'
  const status = element('p', 'status-line')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const destinationsHeading = element('h2')
  destinationsHeading.textContent = 'Destinations'
  const destinations = element('div', 'destination-list')
  const directionHeading = element('h2')
  directionHeading.textContent = 'Direction pad'
  const directionPad = element('div', 'direction-pad')
  const directions: Array<[string, number, number]> = [['Move north', 0, -1], ['Move west', -1, 0], ['Move east', 1, 0], ['Move south', 0, 1]]
  directions.forEach(([label, dx, dy]) => {
    const control = button(label, 'button direction-button')
    control.addEventListener('click', () => { clearHeldKeys(); model.movePlayer(dx, dy); publish() }, { signal: controller.signal })
    directionPad.append(control)
  })
  const stop = button('Stop walking')
  const utilities = element('section', 'utilities')
  const travelersPanel = element('section', 'utility-panel')
  const travelersHeading = element('h2')
  travelersHeading.textContent = 'Travelers'
  const travelers = element('div', 'traveler-list')
  travelersPanel.append(travelersHeading, travelers)
  const doorsPanel = element('section', 'utility-panel')
  const doorsHeading = element('h2')
  doorsHeading.textContent = 'Sandbox door controls'
  const doorNote = element('p', 'small-note')
  doorNote.textContent = 'Demo-only controls bypass proximity and admission. No backend authorization.'
  const doorControls = element('div', 'door-list')
  doorsPanel.append(doorsHeading, doorNote, doorControls)
  const disclaimer = element('p', 'disclaimer')
  disclaimer.textContent = 'Local spatial sandbox · synthetic public fixture · no AI, chat, saving or backend'
  sidebar.append(statusHeading, status, destinationsHeading, destinations, directionHeading, directionPad, stop, disclaimer)
  utilities.append(travelersPanel, doorsPanel)
  content.append(mapColumn, sidebar)
  wrapper.append(content, utilities)
  root.replaceChildren(wrapper)

  let view: MapView | undefined
  let timer: number | undefined
  let canvas: HTMLCanvasElement | null = null
  let repeatTimer: number | undefined
  const heldKeys = new Map<string, Point>()
  let lastAnnouncement = ''
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const roomName = (roomId: string) => roomNames[roomId] ?? roomId
  const spaceLabel = (space: PlaygroundSnapshot['actors'][number]['space']) => space?.kind === 'room' ? roomName(space.roomId) : space?.kind === 'door' ? 'Doorway' : space?.kind === 'outdoor' ? 'Outdoors' : 'Unknown'
  const statusLabel = (value: string) => value === 'waiting_for_door' ? 'waiting for door' : value
  const travelerRows = new Map<string, { item: HTMLDivElement; detail: HTMLSpanElement }>()
  for (const entry of model.snapshot().actors) {
    const item = element('div', 'traveler')
    const name = element('strong')
    name.textContent = entry.name
    const detail = element('span')
    item.append(name, detail)
    travelers.append(item)
    travelerRows.set(entry.id, { item, detail })
  }

  const publish = () => {
    const snapshot = model.snapshot()
    const player = snapshot.actors.find(({ id }) => id === 'player')!
    const announcement = `Player: ${statusLabel(snapshot.playerStatus)} · ${spaceLabel(player.space)}${snapshot.playerGoal?.kind === 'room' ? ` · destination ${roomName(snapshot.playerGoal.roomId)}` : ''}`
    if (announcement !== lastAnnouncement) {
      status.textContent = announcement
      lastAnnouncement = announcement
    }
    pause.textContent = snapshot.running ? 'Pause simulation' : 'Resume simulation'
    pause.setAttribute('aria-label', snapshot.running ? 'Pause simulation' : 'Resume simulation')
    step.disabled = snapshot.running
    routes.checked = snapshot.npcRoutes
    metadata.textContent = `Map ${snapshot.map.id} · seed ${snapshot.seed}`
    snapshot.actors.forEach((entry) => {
      const row = travelerRows.get(entry.id)
      if (!row) return
      row.detail.textContent = `${spaceLabel(entry.space)} · ${statusLabel(entry.status)} · (${entry.position.x}, ${entry.position.y})${entry.targetRoomId ? ` · target ${roomName(entry.targetRoomId)}` : ''}`
    })
    snapshot.map.doors.forEach((entry, index) => {
      const control = doorControls.children[index]
      if (control instanceof HTMLButtonElement) control.textContent = `${snapshot.doors[entry.id] === 'open' ? 'Close' : 'Open'} ${roomName(entry.roomId)} door`
    })
    if (view) view.render(snapshot)
  }

  seedForm.addEventListener('submit', (event) => {
    event.preventDefault()
    clearHeldKeys()
    try {
      model.reset(seedInput.value)
      seedInput.value = model.snapshot().seed
      seedInput.setAttribute('aria-invalid', 'false')
      seedError.hidden = true
      seedError.textContent = ''
      publish()
    } catch {
      seedInput.setAttribute('aria-invalid', 'true')
      seedError.hidden = false
      seedError.textContent = 'Use 1–64 letters, numbers, dots, underscores, or hyphens.'
    }
  }, { signal: controller.signal })
  reset.addEventListener('click', () => { clearHeldKeys(); model.reset(model.snapshot().seed); seedInput.value = model.snapshot().seed; seedInput.setAttribute('aria-invalid', 'false'); seedError.hidden = true; seedError.textContent = ''; publish() }, { signal: controller.signal })
  pause.addEventListener('click', () => { model.setRunning(!model.snapshot().running); publish() }, { signal: controller.signal })
  step.addEventListener('click', () => { model.step(); publish() }, { signal: controller.signal })
  routes.addEventListener('change', () => { model.setNpcRoutes(routes.checked); publish() }, { signal: controller.signal })
  stop.addEventListener('click', () => { clearHeldKeys(); model.stopPlayer(); publish() }, { signal: controller.signal })

  const roomIds = model.snapshot().map.rooms.map(({ id }) => id).sort()
  roomIds.forEach((roomId) => {
    const destination = button(`Walk to ${roomName(roomId)}`, 'button destination')
    destination.addEventListener('click', () => { clearHeldKeys(); model.navigateToRoom(roomId); publish() }, { signal: controller.signal })
    destinations.append(destination)
  })
  model.snapshot().map.doors.forEach((entry) => {
    const control = button('', 'button door-control')
    control.dataset.doorId = entry.id
    control.addEventListener('click', () => { model.toggleDoor(entry.id); publish() }, { signal: controller.signal })
    doorControls.append(control)
  })

  const clearHeldKeys = () => {
    heldKeys.clear()
    if (repeatTimer !== undefined) window.clearInterval(repeatTimer)
    repeatTimer = undefined
  }
  const repeatHeldKey = () => {
    if (!canvas || document.activeElement !== canvas || document.visibilityState !== 'visible') {
      clearHeldKeys()
      return
    }
    const delta = [...heldKeys.values()].at(-1)
    if (delta) {
      model.movePlayer(delta.x, delta.y)
      publish()
    }
  }
  const keyHandler = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      clearHeldKeys()
      return
    }
    if (event.defaultPrevented || event.target !== canvas || document.activeElement !== canvas || document.visibilityState !== 'visible') return
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const delta = MOVEMENT_DELTAS[key]
    if (!delta) return
    event.preventDefault()
    const identity = event.code || key
    if (event.repeat || heldKeys.has(identity)) return
    heldKeys.set(identity, delta)
    model.movePlayer(delta.x, delta.y)
    publish()
    if (repeatTimer === undefined) repeatTimer = window.setInterval(repeatHeldKey, 160)
  }
  const keyUpHandler = (event: KeyboardEvent) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    heldKeys.delete(event.code || key)
    if (heldKeys.size === 0) clearHeldKeys()
  }

  const visibilityHandler = () => {
    if (document.visibilityState !== 'visible') clearHeldKeys()
    else publish()
  }
  document.addEventListener('visibilitychange', visibilityHandler, { signal: controller.signal })
  document.addEventListener('keyup', keyUpHandler, { signal: controller.signal })
  window.addEventListener('blur', clearHeldKeys, { signal: controller.signal })
  publish()
  try {
    const module = await import('./view.js')
    view = await module.createMapView(mapHost, model.snapshot(), (point) => { clearHeldKeys(); model.navigateToPoint(point); publish() }, reducedMotionQuery.matches)
    view.render(model.snapshot())
    canvas = mapHost.querySelector('canvas')
    canvas?.setAttribute('aria-describedby', instructions.id)
    canvas?.addEventListener('keydown', keyHandler, { signal: controller.signal })
    canvas?.addEventListener('blur', clearHeldKeys, { signal: controller.signal })
    reducedMotionQuery.addEventListener('change', (event) => { view?.setReducedMotion(event.matches) }, { signal: controller.signal })
  } catch (error) {
    const message = element('p', 'renderer-error')
    message.textContent = `Renderer unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    mapHost.append(message)
  }

  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && model.snapshot().running) { model.step(); publish() }
  }, 160)
  publish()
  return {
    getSnapshot: () => model.snapshot(),
    destroy() {
      clearHeldKeys()
      if (timer !== undefined) window.clearInterval(timer)
      controller.abort()
      view?.destroy()
      wrapper.remove()
    },
  }
}
