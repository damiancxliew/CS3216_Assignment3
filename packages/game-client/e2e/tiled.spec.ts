import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { overlaps } from '../src/map-labels.js'

test('newsroom captions, walking sprites and displaced click targets', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/game/ninja/**', async (route) => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    const body = await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix))
    const contentType = suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png'
    await route.fulfill({ body, contentType })
  })
  await page.route('**/missing-sprite.png', (route) => route.fulfill({ status: 404, body: '' }))
  // A blank same-origin document avoids mounting the unrelated primitive demo.
  await page.route('**/tiled-test', (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>' }))
  await page.goto('/tiled-test', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const path = '/e2e/tiled-harness.ts'
    const harness = await import(/* @vite-ignore */ path)
    Object.assign(window, { tiledHarness: harness })
  })
  const inspect = () => page.evaluate(() => (window as any).tiledHarness.inspect())
  const initial = await inspect()
  expect(initial.stockSprites).toEqual(['char-Princess', 'char-Princess', 'char-Boy'])
  expect(initial.images).toHaveLength(1)
  expect(initial.ground).toBe(1000)
  for (const [index, caption] of initial.captions.entries()) {
    expect(initial.captions.slice(index + 1).some((other: any) => overlaps(caption, other, 0)), caption.text).toBe(false)
  }
  expect(initial.captions.filter((caption: any) => /\n(Talk|Read|Inspect)$/.test(caption.text))).toHaveLength(1)

  // Move the camera to the crowded room on narrow screens, then use real pointer input.
  const propPoint = await page.evaluate(() => (window as any).tiledHarness.pointFor('Fascism Source Card'))
  await page.mouse.move(propPoint.x, propPoint.y)
  await page.waitForTimeout(100)
  const focusedPropPoint = await page.evaluate(() => (window as any).tiledHarness.pointFor('Fascism Source Card'))
  await page.mouse.click(focusedPropPoint.x, focusedPropPoint.y)
  expect(await page.evaluate(() => (window as any).tiledHarness.clicks)).toContain('prop:card')

  // A completed sheet replaces the curated walker without changing the map.
  await page.evaluate(() => {
    const harness = (window as any).tiledHarness
    harness.snapshot.actors.find((actor: any) => actor.id === 'tojo').spriteSheetUrl = '/game/ninja/characters/Boy/walk.png'
    harness.view.render(structuredClone(harness.snapshot))
  })
  await expect.poll(async () => (await inspect()).stockSprites.filter((key: string) => key.startsWith('asset-')).length).toBe(1)
  expect((await inspect()).stockSprites).toContain('char-Princess')
  await page.screenshot({ path: testInfo.outputPath('newsroom.png') })

  // Caption placement also runs between snapshots, while characters cross each other.
  await page.evaluate(() => {
    const harness = (window as any).tiledHarness
    harness.view.setReducedMotion(false)
    const actor = harness.snapshot.actors.find((entry: any) => entry.id === 'tojo')
    actor.position = { ...harness.snapshot.actors[0].position }
    harness.view.render(structuredClone(harness.snapshot))
  })
  const collisionFrames = await page.evaluate(async () => {
    const harness = (window as any).tiledHarness
    const collisions: string[] = []
    for (let frame = 0; frame < 15; frame += 1) {
      await new Promise(requestAnimationFrame)
      const labels = harness.captions()
      for (let i = 0; i < labels.length; i += 1) {
        for (const other of labels.slice(i + 1)) {
          const label = labels[i]
          if (label.x < other.x + other.width && label.x + label.width > other.x && label.y < other.y + other.height && label.y + label.height > other.y) collisions.push(label.text)
        }
      }
    }
    return collisions
  })
  expect(collisionFrames).toEqual([])
  await page.evaluate(() => {
    const harness = (window as any).tiledHarness
    harness.snapshot.actors.find((entry: any) => entry.id === 'tojo').spriteSheetUrl = '/missing-sprite.png'
    harness.snapshot.actors.find((entry: any) => entry.id === 'hitler').spriteSheetUrl = '/missing-sprite.png'
    harness.view.render(structuredClone(harness.snapshot))
  })
  await expect.poll(async () => (await inspect()).images.length).toBe(1)
  expect((await inspect()).images).toEqual(initial.images)
  expect((await inspect()).stockSprites).toEqual(initial.stockSprites)
  expect(errors).toEqual([])
})
