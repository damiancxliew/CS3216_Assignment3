import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { PlaygroundSnapshot } from '../src/model.js'

const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }, testInfo) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (testInfo.title.includes('renderer import failure') && message.text() === 'Failed to load resource: net::ERR_FAILED' && message.location().url.includes('/src/view')) return
    errors.push(message.text())
  })
})
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([])
})

async function snapshot(page: Page): Promise<PlaygroundSnapshot> {
  return page.evaluate(() => window.__MAP_PLAYGROUND__ as PlaygroundSnapshot)
}

async function pauseAndDisableRoutes(page: Page): Promise<void> {
  const pause = page.getByRole('button', { name: 'Pause simulation' })
  await pause.focus()
  await pause.press('Enter')
  const routes = page.getByRole('checkbox', { name: 'Scripted NPC routes' })
  await routes.focus()
  await routes.press('Space')
}

async function doorPixel(page: Page, roomId: string): Promise<number[]> {
  return page.evaluate((targetRoomId) => {
    const state = window.__MAP_PLAYGROUND__ as PlaygroundSnapshot
    const door = state.map.doors.find(({ roomId }) => roomId === targetRoomId)!
    const canvas = document.querySelector('canvas[aria-label="Settlement map"]') as HTMLCanvasElement
    const context = canvas.getContext('2d')!
    const x = Math.floor((door.position.x + 0.5) * canvas.width / state.map.width)
    const y = Math.floor((door.position.y + 0.5) * canvas.height / state.map.height)
    return Array.from(context.getImageData(x, y, 1, 1).data)
  }, roomId)
}

test('keyboard-only map playground flow and global traveler projection', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The Settlement' })).toBeVisible()
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  await expect(page.getByText('Elder')).toBeVisible()
  await expect(page.getByText('Merchant')).toBeVisible()
  await expect(page.getByText('Scribe')).toBeVisible()
  await expect(page.locator('.traveler strong').filter({ hasText: 'You' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Step simulation' })).toBeDisabled()
  await pauseAndDisableRoutes(page)
  await expect(page.getByRole('button', { name: 'Step simulation' })).toBeEnabled()
  await expect(page.getByRole('status')).toHaveText('Player: idle · Council Hall')
  const mutationResult = await page.evaluate(async () => {
    const status = document.querySelector('[role="status"]')!
    let mutations = 0
    const observer = new MutationObserver(() => { mutations += 1 })
    observer.observe(status, { childList: true, characterData: true, subtree: true })
    const stepButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Step simulation') as HTMLButtonElement
    for (let index = 0; index < 5; index += 1) stepButton.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    observer.disconnect()
    return { mutations, text: status.textContent }
  })
  expect(mutationResult).toEqual({ mutations: 0, text: 'Player: idle · Council Hall' })

  const openArchive = page.getByRole('button', { name: 'Open Archive door' })
  await openArchive.focus()
  await openArchive.press('Enter')
  const archive = page.getByRole('button', { name: 'Walk to Archive' })
  await archive.focus()
  await archive.press('Enter')
  const step = page.getByRole('button', { name: 'Step simulation' })
  await step.focus()
  for (let index = 0; index < 150; index += 1) {
    const current = await snapshot(page)
    const playerSpace = current.actors.find(({ id }) => id === 'player')?.space
    if (playerSpace?.kind === 'room' && playerSpace.roomId === 'archive') break
    await step.press('Enter')
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Step simulation')
  }
  await expect.poll(async () => {
    const space = (await snapshot(page)).actors.find(({ id }) => id === 'player')?.space
    return space?.kind === 'room' ? space.roomId : undefined
  }).toBe('archive')
  await expect(page.getByText(/Archive/).first()).toBeVisible()

  const canvas = page.locator('canvas[aria-label="Settlement map"]')
  const beforeField = await snapshot(page)
  const seed = page.getByLabel('Layout seed')
  await seed.focus()
  await seed.press('ArrowRight')
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')?.position).toEqual(beforeField.actors.find(({ id }) => id === 'player')?.position)
  const direction = await page.evaluate(() => {
    const state = window.__MAP_PLAYGROUND__ as PlaygroundSnapshot
    const player = state.actors.find(({ id }) => id === 'player')!
    const keys: Array<[string, number, number]> = [['ArrowUp', 0, -1], ['ArrowRight', 1, 0], ['ArrowDown', 0, 1], ['ArrowLeft', -1, 0]]
    return keys.find(([, dx, dy]) => {
      const x = player.position.x + dx
      const y = player.position.y + dy
      const tile = state.map.tiles[y]?.[x]
      return tile === 'grass' || tile === 'path' || tile === 'floor'
    })?.[0] ?? 'ArrowUp'
  })
  await canvas.focus()
  await canvas.press(direction)
  await expect.poll(async () => (await snapshot(page)).actors.find(({ id }) => id === 'player')?.position).not.toEqual(beforeField.actors.find(({ id }) => id === 'player')?.position)

  const invalid = page.getByLabel('Layout seed')
  const stableId = (await snapshot(page)).map.id
  await invalid.fill('bad seed!')
  await invalid.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Use 1–64')
  expect((await snapshot(page)).map.id).toBe(stableId)
  const closeArchive = page.getByRole('button', { name: 'Close Archive door' })
  await closeArchive.focus()
  await closeArchive.press('Enter')
  await expect(page.getByRole('button', { name: 'Open Archive door' })).toBeVisible()
})

test('room route waits, displaces doorway actors, and resumes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  await pauseAndDisableRoutes(page)
  const archive = page.getByRole('button', { name: 'Walk to Archive' })
  await archive.press('Enter')
  const step = page.getByRole('button', { name: 'Step simulation' })
  await step.focus()
  for (let index = 0; index < 150; index += 1) {
    const current = await snapshot(page)
    const player = current.actors.find(({ id }) => id === 'player')!
    if (player.status === 'waiting_for_door') break
    await step.press('Enter')
  }
  const waiting = await snapshot(page)
  const archiveDoor = waiting.map.doors.find(({ roomId }) => roomId === 'archive')!
  expect(waiting.actors.find(({ id }) => id === 'player')!.position).toEqual(archiveDoor.outside)
  await page.getByRole('button', { name: 'Open Archive door' }).press('Enter')
  await step.press('Enter')
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')!.space).toEqual({ kind: 'door', doorId: archiveDoor.id })
  await page.getByRole('button', { name: 'Close Archive door' }).press('Enter')
  const displaced = await snapshot(page)
  expect(displaced.actors.find(({ id }) => id === 'player')!.position).toEqual(archiveDoor.outside)
  expect(displaced.playerGoal).toEqual({ kind: 'room', roomId: 'archive' })
  expect(displaced.playerStatus).toBe('waiting_for_door')
  await page.getByRole('button', { name: 'Close Market door' }).press('Enter')
  expect((await snapshot(page)).playerStatus).toBe('waiting_for_door')
  await page.getByRole('button', { name: 'Open Archive door' }).press('Enter')
  await step.press('Enter')
  await step.press('Enter')
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')!.space).toEqual({ kind: 'room', roomId: 'archive' })
})

test('scheduler pause, reset, and UI state synchronization stay stable', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  await pauseAndDisableRoutes(page)
  const paused = await snapshot(page)
  await page.clock.runFor(640)
  expect((await snapshot(page)).revision).toBe(paused.revision)
  await page.getByRole('button', { name: 'Resume simulation' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Step simulation' })).toBeDisabled()
  await page.clock.runFor(480)
  expect((await snapshot(page)).revision).toBeGreaterThan(paused.revision)
  await page.getByRole('button', { name: 'Pause simulation' }).press('Enter')
  const original = await snapshot(page)
  const seed = page.getByLabel('Layout seed')
  await seed.fill('bad seed!')
  await seed.press('Enter')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Reset map' }).press('Enter')
  const reset = await snapshot(page)
  await expect(seed).toHaveValue('harbor-demo')
  await expect(seed).toHaveAttribute('aria-invalid', 'false')
  await expect(page.getByRole('alert')).toBeHidden()
  await expect(page.getByRole('checkbox', { name: 'Scripted NPC routes' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Pause simulation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Step simulation' })).toBeDisabled()
  expect(reset.playerGoal).toBeNull()
  expect(original.map.id).toBe(reset.map.id)
  const detached = await snapshot(page)
  detached.map.tiles[0]![0] = 'grass'
  detached.actors[0]!.position.x = 999
  detached.doors[Object.keys(detached.doors)[0]!] = detached.doors[Object.keys(detached.doors)[0]!] === 'open' ? 'closed' : 'open'
  expect((await snapshot(page)).actors[0]!.position.x).not.toBe(999)
})

test('door canvas glyph follows closed-open-closed state', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  await expect.poll(() => snapshot(page)).toMatchObject({ map: { width: expect.any(Number) } })
  await pauseAndDisableRoutes(page)
  const closedPixel = await doorPixel(page, 'archive')
  await expect.poll(async () => (await snapshot(page)).doors['door:archive']).toBe('closed')
  await page.getByRole('button', { name: 'Open Archive door' }).press('Enter')
  await expect.poll(async () => (await snapshot(page)).doors['door:archive']).toBe('open')
  await expect.poll(() => doorPixel(page, 'archive')).not.toEqual(closedPixel)
  await page.getByRole('button', { name: 'Close Archive door' }).press('Enter')
  await expect.poll(async () => (await snapshot(page)).doors['door:archive']).toBe('closed')
  await expect.poll(() => doorPixel(page, 'archive')).toEqual(closedPixel)
})

test('semantic canvas click-to-walk uses responsive map bounds', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  await pauseAndDisableRoutes(page)
  const target = await page.evaluate(() => {
    const state = window.__MAP_PLAYGROUND__ as PlaygroundSnapshot
    const player = state.actors.find(({ id }) => id === 'player')!
    const offsets: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    const point = offsets.map(([x, y]) => ({ x: player.position.x + x, y: player.position.y + y })).find(({ x, y }) => ['grass', 'path', 'floor'].includes(state.map.tiles[y]?.[x] ?? ''))!
    return point
  })
  const canvas = page.locator('canvas[aria-label="Settlement map"]')
  const box = await canvas.boundingBox()
  const current = await snapshot(page)
  await page.mouse.click(box!.x + (target.x + 0.5) * box!.width / current.map.width, box!.y + (target.y + 0.5) * box!.height / current.map.height)
  await expect.poll(async () => (await snapshot(page)).playerGoal).toEqual({ kind: 'point', point: target })
  const step = page.getByRole('button', { name: 'Step simulation' })
  await step.focus()
  await step.press('Enter')
  await expect.poll(async () => (await snapshot(page)).actors.find(({ id }) => id === 'player')?.position).toEqual(target)
})

test('renderer import failure keeps DOM controls usable', async ({ page }) => {
  await page.route('**/src/view*', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByText(/Renderer unavailable/)).toBeVisible()
  await page.getByRole('button', { name: 'Walk to Market' }).press('Enter')
  await expect(page.getByRole('status')).toContainText('destination Market')
})

test('production bundle omits development hook and private-content markers', async () => {
  const files = await readdir(resolve(process.cwd(), 'dist/assets'))
  const scripts = files.filter((file) => file.endsWith('.js'))
  const contents = await Promise.all(scripts.map((file) => readFile(resolve(process.cwd(), 'dist/assets', file), 'utf8')))
  const bundle = contents.join('\n')
  expect(bundle).not.toContain('__MAP_PLAYGROUND__')
  expect(bundle).not.toContain('privateContext')
  expect(bundle).not.toContain('sourceIds')
})

test('reduced motion screenshots and mount lifecycle stay clean', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  const screenshotPath = `/tmp/playable-map-client-${testInfo.project.name}.png`
  await page.screenshot({ path: screenshotPath, fullPage: true })
  expect(testInfo.project.name).toBeTruthy()
  const lifecycle = await page.evaluate(async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const modulePath = '/src/index.ts'
    const { mountPlayground } = await import(modulePath)
    const first = await mountPlayground(root, { seed: 'lifecycle-a' })
    const firstCount = root.querySelectorAll('canvas').length
    first.destroy()
    const stoppedRevision = first.getSnapshot().revision
    const second = await mountPlayground(root, { seed: 'lifecycle-b' })
    const secondCount = root.querySelectorAll('canvas').length
    const titleCount = root.querySelectorAll('h1').length
    const beforeTick = second.getSnapshot().revision
    await new Promise((resolve) => window.setTimeout(resolve, 400))
    const firstStopped = first.getSnapshot().revision === stoppedRevision
    const secondRunning = second.getSnapshot().revision > beforeTick
    second.destroy()
    root.remove()
    return { firstCount, secondCount, titleCount, firstStopped, secondRunning }
  })
  expect(lifecycle).toEqual({ firstCount: 1, secondCount: 1, titleCount: 1, firstStopped: true, secondRunning: true })
  expect(await page.locator('canvas').count()).toBe(1)
  expect(await snapshot(page)).toMatchObject({ map: { width: expect.any(Number) } })
})
