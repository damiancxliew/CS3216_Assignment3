import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// This replays checked output; it NEVER makes paid model calls in tests.
test('production environment plans render, reveal rooms, and animate the harbor', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  test.skip(!existsSync(resolve('e2e/story-plans.generated.json')), 'Run the opt-in generation preview script first')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/game/ninja/**', async route => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    await route.fulfill({ body: await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix)), contentType: suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png' })
  })
  await page.route('**/e2e/story-plans.generated.json', async route => route.fulfill({ contentType: 'application/json', body: await readFile(resolve('e2e/story-plans.generated.json')) }))
  for (const style of ['civic', 'harbor', 'desert']) {
    await page.goto(`/e2e/story-preview.html?style=${style}&production=1`)
    await expect(page.getByRole('button', { name: 'Walk outside' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => Boolean((window as any).storyHarness))).toBe(true)
    const plans = await page.evaluate(() => {
      const h = (window as any).storyHarness
      return { env: h.snapshot.environment, shape: h.snapshot.map.rooms.map((r: any) => r.shape), title: document.querySelector('header')!.textContent }
    })
    expect(plans.title).toContain('Preview / server LLM')
    expect(await page.evaluate(() => (window as any).storyHarness.game.scene.getScene('tiled-map').cameras.main.zoom)).toBeGreaterThanOrEqual(3)
    await page.screenshot({ path: testInfo.outputPath(`${style}-detail.png`) })
    await page.getByRole('button', { name: 'Whole map', exact: true }).click()
    expect(new Set(plans.env.props).size).toBe(plans.env.props.length)
    if (style !== 'harbor') expect(plans.shape.some((s: string) => s !== 'rectangle')).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${style}-production.png`) })
    await page.getByRole('button', { name: 'Walk outside' }).click()
    await expect.poll(() => page.evaluate(() => {
      const h = (window as any).storyHarness
      return h.game.scene.getScene('tiled-map').children.list.filter((o: any) => o.name.startsWith('room-roof-')).every((o: any) => o.alpha === 1)
    }), { timeout: 18000 }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${style}-covered.png`) })
    const life = await page.evaluate(async () => {
      const h = (window as any).storyHarness, scene = h.game.scene.getScene('tiled-map')
      const people = scene.children.list.filter((o: any) => /^ambient-(residents|workers|traders|animal)-/.test(o.name))
      const before = people.map((p: any) => [p.x, p.y])
      await new Promise(r => setTimeout(r, 1400))
      const moved = people.some((p: any, i: number) => p.x !== before[i][0] || p.y !== before[i][1])
      const inside = people.every((p: any) => p.x > 16 && p.y > 16 && p.x < h.snapshot.map.width * 16 - 16 && p.y < h.snapshot.map.height * 16 - 16)
      const water = h.snapshot.map.waterBodies?.length ?? 0
      h.view.setReducedMotion(true)
      const stopped = people.map((p: any) => [p.x, p.y])
      await new Promise(r => setTimeout(r, 200))
      const frozen = people.every((p: any, i: number) => p.x === stopped[i][0] && p.y === stopped[i][1])
      h.view.setReducedMotion(false)
      return { count: people.length, moved, inside, water, frozen, animals: people.filter((p: any) => p.name.startsWith('ambient-animal-')).map((p: any) => p.name) }
    })
    expect(life.count).toBeGreaterThanOrEqual(5)
    expect(life.animals.some((name: string) => name.includes(style === 'desert' ? 'camel' : 'cat'))).toBe(true)
    expect(life).toMatchObject({ moved: true, inside: true, water: 1, frozen: true })
    if (style === 'harbor') {
      const boats = await page.evaluate(() => {
        const h = (window as any).storyHarness, scene = h.game.scene.getScene('tiled-map')
        const boats = scene.children.list.filter((o: any) => o.name === 'harbor-boat')
        if (boats.some((o: any) => o.width > 24 || o.height > 40)) throw new Error('Boat is oversized')
        return boats.map((o: any) => o.y)
      })
      expect(boats).toHaveLength(1)
      await expect.poll(() => page.evaluate((before) => {
        const scene = (window as any).storyHarness.game.scene.getScene('tiled-map')
        return scene.children.list.filter((o: any) => o.name === 'harbor-boat').some((o: any, i: number) => o.y !== before[i])
      }, boats), { timeout: 10000 }).toBe(true)
      const reducedStops = await page.evaluate(async () => {
        const h = (window as any).storyHarness, scene = h.game.scene.getScene('tiled-map')
        h.view.setReducedMotion(true)
        const boats = scene.children.list.filter((o: any) => o.name === 'harbor-boat')
        const stopped = boats.map((o: any) => o.y)
        await new Promise(r => setTimeout(r, 200))
        return boats.every((o: any, i: number) => o.y === stopped[i])
      })
      expect(reducedStops).toBe(true)
    }
  }
  expect(errors).toEqual([])
})
