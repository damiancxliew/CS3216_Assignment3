import { expect, test, type Page } from '@playwright/test'
import type { PlaygroundSnapshot } from '../src/model.js'

const errorsByPage = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  errorsByPage.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
})
test.afterEach(({ page }) => expect(errorsByPage.get(page)).toEqual([]))

async function snapshot(page: Page): Promise<PlaygroundSnapshot> {
  return page.evaluate(() => window.__MAP_PLAYGROUND__ as PlaygroundSnapshot)
}

async function pausedPage(page: Page): Promise<void> {
  await page.clock.install()
  await page.goto('/')
  await expect(page.locator('canvas[aria-label="Settlement map"]')).toBeVisible()
  await page.getByRole('button', { name: 'Pause simulation' }).press('Enter')
  const routes = page.getByRole('checkbox', { name: 'Move other characters' })
  await routes.focus()
  await routes.press('Space')
}

async function longestDirection(page: Page): Promise<{ key: string; delta: [number, number]; length: number }> {
  return page.evaluate(() => {
    const state = window.__MAP_PLAYGROUND__ as PlaygroundSnapshot
    const player = state.actors.find(({ id }) => id === 'player')!
    const candidates: Array<[string, [number, number]]> = [['ArrowUp', [0, -1]], ['ArrowRight', [1, 0]], ['ArrowDown', [0, 1]], ['ArrowLeft', [-1, 0]]]
    return candidates.map(([key, delta]) => {
      let length = 0
      for (let offset = 1; offset < 10; offset += 1) {
        const x = player.position.x + delta[0] * offset
        const y = player.position.y + delta[1] * offset
        if (!['grass', 'path', 'floor'].includes(state.map.tiles[y]?.[x] ?? '')) break
        length += 1
      }
      return { key, delta, length }
    }).sort((left, right) => right.length - left.length)[0]!
  })
}

function distance(before: { x: number; y: number }, after: { x: number; y: number }): number {
  return Math.abs(after.x - before.x) + Math.abs(after.y - before.y)
}

test('held keys repeat independently of OS repeat and stop on release', async ({ page }) => {
  await pausedPage(page)
  const direction = await longestDirection(page)
  expect(direction.length).toBeGreaterThanOrEqual(3)
  const canvas = page.locator('canvas[aria-label="Settlement map"]')
  await canvas.focus()
  const start = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  await page.keyboard.down(direction.key)
  const immediate = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  expect(distance(start, immediate)).toBe(1)
  await page.clock.runFor(320)
  const repeated = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  expect(distance(start, repeated)).toBeGreaterThanOrEqual(3)
  expect(repeated.x === start.x || repeated.y === start.y).toBe(true)
  await page.keyboard.up(direction.key)
  const stopped = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  await page.clock.runFor(480)
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')!.position).toEqual(stopped)
})

test('held keys clear on repeat events, focus loss, and modifier input', async ({ page }) => {
  await pausedPage(page)
  const direction = await longestDirection(page)
  const canvas = page.locator('canvas[aria-label="Settlement map"]')
  await canvas.focus()
  await page.keyboard.down(direction.key)
  const moving = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  const repeatPrevented = await page.evaluate((key) => {
    const canvas = document.querySelector('canvas[aria-label="Settlement map"]')!
    const event = new KeyboardEvent('keydown', { key, code: key, repeat: true, bubbles: true, cancelable: true })
    canvas.dispatchEvent(event)
    return event.defaultPrevented
  }, direction.key)
  expect(repeatPrevented).toBe(true)
  await page.clock.runFor(320)
  const progressed = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  expect(distance(moving, progressed)).toBeGreaterThan(0)
  await page.getByLabel('Layout seed').focus()
  await page.clock.runFor(480)
  const afterFocusLoss = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  await canvas.focus()
  await page.clock.runFor(320)
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')!.position).toEqual(afterFocusLoss)
  await page.keyboard.up(direction.key)
  await page.keyboard.down('Control')
  await page.keyboard.down(direction.key)
  await page.clock.runFor(320)
  await page.keyboard.up(direction.key)
  await page.keyboard.up('Control')
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')!.position).toEqual(afterFocusLoss)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.clock.runFor(320)
  expect((await snapshot(page)).actors.find(({ id }) => id === 'player')!.position).toEqual(afterFocusLoss)
})

test('latest held direction wins and released direction resumes', async ({ page }) => {
  await pausedPage(page)
  const choices = await page.evaluate(() => {
    const state = window.__MAP_PLAYGROUND__ as PlaygroundSnapshot
    const player = state.actors.find(({ id }) => id === 'player')!
    const candidates: Array<[string, [number, number]]> = [['ArrowUp', [0, -1]], ['ArrowRight', [1, 0]], ['ArrowDown', [0, 1]], ['ArrowLeft', [-1, 0]]]
    return candidates.filter(([, [dx, dy]]) => ['grass', 'path', 'floor'].includes(state.map.tiles[player.position.y + dy]?.[player.position.x + dx] ?? '')).slice(0, 2)
  })
  expect(choices).toHaveLength(2)
  const canvas = page.locator('canvas[aria-label="Settlement map"]')
  await canvas.focus()
  await page.keyboard.down(choices[0]![0])
  const first = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  await page.keyboard.down(choices[1]![0])
  const secondImmediate = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  expect(distance(first, secondImmediate)).toBeLessThanOrEqual(1)
  expect(secondImmediate.x === first.x || secondImmediate.y === first.y).toBe(true)
  await page.clock.runFor(160)
  const second = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  expect(distance(secondImmediate, second)).toBeLessThanOrEqual(1)
  expect(second.x === secondImmediate.x || second.y === secondImmediate.y).toBe(true)
  await page.keyboard.up(choices[1]![0])
  await page.clock.runFor(160)
  const resumed = (await snapshot(page)).actors.find(({ id }) => id === 'player')!.position
  expect(distance(second, resumed)).toBeLessThanOrEqual(2)
  expect(resumed.x === second.x || resumed.y === second.y).toBe(true)
  await page.keyboard.up(choices[0]![0])
})
