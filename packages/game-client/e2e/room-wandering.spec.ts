import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test('indoor characters wander visibly and remain clickable after a state refresh', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/game/ninja/**', async (route) => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    await route.fulfill({
      body: await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix)),
      contentType: suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png',
    })
  })
  await page.route('**/game/portraits/**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.route('**/wander-test', (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>' }))
  await page.goto('/wander-test')
  // The renderer pauses ambient motion in hidden tabs. CI runs browser
  // projects concurrently, so make this page visible before timing a walk.
  await page.bringToFront()
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false)
  const initial = await page.evaluate(async () => {
    const path = '/e2e/tiled-harness.ts'
    const harness = await import(/* @vite-ignore */ path)
    Object.assign(window, { wanderingHarness: harness })
    harness.snapshot.roomWandering = true
    harness.view.setReducedMotion(false)
    harness.view.render(structuredClone(harness.snapshot))
    return harness.snapshot.actors.find((actor: any) => actor.id === 'tojo').position
  })
  const position = () => page.evaluate(() => {
    const scene = (window as any).wanderingHarness.game.scene.getScene('tiled-map')
    const marker = scene.markers.get('tojo')
    return { x: marker.container.x, y: marker.container.y }
  })
  await expect.poll(position, { timeout: 8000 }).not.toEqual({ x: initial.x * 16 + 8, y: initial.y * 16 + 8 })
  const point = await page.evaluate(() => {
    const harness = (window as any).wanderingHarness
    harness.view.render(structuredClone(harness.snapshot))
    return harness.pointFor('Hideki Tojo')
  })
  await page.mouse.move(point.x, point.y)
  // Let an in-progress tile finish before checking the hover pause and clicking.
  await page.waitForTimeout(500)
  const paused = await position()
  await page.waitForTimeout(800)
  expect(await position()).toEqual(paused)
  const target = await page.evaluate(() => (window as any).wanderingHarness.pointFor('Hideki Tojo'))
  await page.mouse.click(target.x, target.y)
  expect(await page.evaluate(() => (window as any).wanderingHarness.clicks)).toContain('actor:tojo')
  await page.evaluate(() => (window as any).wanderingHarness.view.setReducedMotion(true))
  expect(await position()).toEqual({ x: initial.x * 16 + 8, y: initial.y * 16 + 8 })
  expect(errors).toEqual([])
})
