import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/game/ninja/**', async route => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    await route.fulfill({ body: await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix)), contentType: suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png' })
  })
})

for (const [context, kind] of [['National Service', 'troops'], ['Street riots', 'rioters'], ['Police patrol', 'patrol']]) {
  test(`${kind} use bundled sprites and can be greeted without a host action`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/e2e/story-preview.html?style=civic&crowd=${encodeURIComponent(context!)}`)
    await expect.poll(() => page.evaluate(() => Boolean((window as any).storyHarness))).toBe(true)
    await page.getByRole('button', { name: 'Whole map', exact: true }).click()
    const result = await page.evaluate(() => {
      const harness = (window as any).storyHarness
      const scene = harness.game.scene.getScene('tiled-map')
      const residents = scene.ambientLife.residents.filter((r: any) => r.person)
      const first = residents[0]
      const before = JSON.stringify(harness.snapshot)
      const player = scene.current.actors.find((a: any) => a.id === 'player')
      player.position = { ...first.at }
      const greeted = harness.view.greetNearby()
      return { count: residents.length, greeted, lines: first.person.talk.lines,
        bubble: first.bubble?.text, names: residents.map((r: any) => r.sprite.name),
        missing: residents.filter((r: any) => r.sprite.texture.key === '__MISSING').length,
        hasDrill: residents.every((r: any) => !!r.drill),
        unchanged: JSON.stringify(harness.snapshot) === before }
    })
    expect(result.count).toBe(6)
    expect(result.names.every((name: string) => name.startsWith(`ambient-${kind}-`))).toBe(true)
    expect(result.missing).toBe(0)
    expect(result.greeted).toBe(true)
    expect(result.lines).toContain(result.bubble)
    expect(result.unchanged).toBe(true)
    if (kind === 'troops') expect(result.hasDrill).toBe(true)
    expect(errors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`${kind}.png`) })
  })
}

test('troops move together and stop for reduced motion', async ({ page }) => {
  await page.goto('/e2e/story-preview.html?style=civic&crowd=National%20Service')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).storyHarness))).toBe(true)
  const result = await page.evaluate(async () => {
    const { game, view } = (window as any).storyHarness
    const scene = game.scene.getScene('tiled-map')
    const troops = scene.ambientLife.residents.filter((r: any) => r.person)
    const positions = () => troops.map((r: any) => ({ x: r.sprite.x, y: r.sprite.y }))
    const start = positions()
    await new Promise(resolve => setTimeout(resolve, 650))
    const moved = positions()
    view.setReducedMotion(true)
    await new Promise(resolve => setTimeout(resolve, 100))
    const stopped = positions()
    await new Promise(resolve => setTimeout(resolve, 650))
    return { start, moved, stopped, end: positions() }
  })
  expect(result.moved[0].y).not.toBe(result.start[0].y)
  for (let i = 0; i < 6; i++) {
    expect(result.moved[i].x - result.moved[0].x).toBe((i % 3) * 16)
    expect(result.moved[i].y - result.moved[0].y).toBeCloseTo(Math.floor(i / 3) * 32, 5)
  }
  expect(result.end).toEqual(result.stopped)
})
