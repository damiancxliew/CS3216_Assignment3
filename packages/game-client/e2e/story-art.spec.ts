import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test('story settings produce distinct art and preserve entrances on style changes', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/game/ninja/**', async (route) => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    await route.fulfill({ body: await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix)), contentType: suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png' })
  })
  await page.route('**/story-preview?*', (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>' }))
  const fingerprints = []
  for (const style of ['civic', 'harbor', 'desert', 'jungle', 'industrial', 'winter']) {
    await page.goto(`/story-preview?style=${style}`)
    const state = await page.evaluate(async () => {
      const path = '/e2e/story-art-harness.ts'
      const h = await import(/* @vite-ignore */ path)
      Object.assign(window, { storyHarness: h })
      const scene = h.game.scene.getScene('tiled-map')
      const decoration = scene.textures.get('environment-walls').getSourceImage() as HTMLCanvasElement
      const context = decoration.getContext('2d')!
      return { fingerprint: scene.textures.get('story-walls').getSourceImage().toDataURL(),
        doorsClear: h.snapshot.map.doors.every((d: any) => context.getImageData(d.position.x * 16 + 8, d.position.y * 16 + 8, 1, 1).data[3] === 0),
        cornerClear: scene.textures.get('story-walls').getSourceImage().getContext('2d').getImageData(0, 6 * 16, 1, 1).data[3] === 0,
      }
    })
    fingerprints.push(state.fingerprint)
    expect(state.doorsClear).toBe(true)
    expect(state.cornerClear).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${style}.png`) })
    if (style === 'civic') {
      const initialRoofs = await page.evaluate(() => {
        const h = (window as any).storyHarness, scene = h.game.scene.getScene('tiled-map')
        return h.snapshot.map.rooms.filter((r: any) => r.enclosure === 'enclosed').map((r: any) => ({ id: r.id, alpha: scene.children.getByName(`room-roof-${r.id}`).alpha }))
      })
      expect(initialRoofs.filter((r: any) => r.alpha === 0)).toHaveLength(1)
      expect(initialRoofs.filter((r: any) => r.alpha === 1)).toHaveLength(2)
      // Exercise an actual path through the doorway. Roof should return after exit.
      await page.getByRole('button', { name: 'Walk outside' }).click()
      await expect.poll(() => page.evaluate(() => {
        const h = (window as any).storyHarness
        return h.game.scene.getScene('tiled-map').children.list.filter((o: any) => o.name.startsWith('room-roof-')).every((o: any) => o.alpha === 1)
      }), { timeout: 15000 }).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('civic-covered.png') })
      await page.getByRole('button', { name: 'Enter Press Room' }).click()
      await expect.poll(() => page.evaluate(() => (window as any).storyHarness.game.scene.getScene('tiled-map').children.getByName('room-roof-place-0').alpha)).toBeLessThan(1)
      await expect.poll(() => page.evaluate(() => (window as any).storyHarness.game.scene.getScene('tiled-map').children.getByName('room-roof-place-0').alpha)).toBe(0)
      await page.screenshot({ path: testInfo.outputPath('civic-entered.png') })
      const hidden = await page.evaluate(() => {
        const h = (window as any).storyHarness, scene = h.game.scene.getScene('tiled-map')
        const other = h.snapshot.actors.find((a: any) => a.id === 'actor-1')
        return { target: scene.targets().some((t: any) => t.id === 'actor:actor-1'), hit: scene.hitTarget({ x: other.position.x * 16 + 8, y: other.position.y * 16 + 8 }) }
      })
      expect(hidden).toEqual({ target: false, hit: null })
    }
  }
  expect(new Set(fingerprints).size).toBe(6)
  const rebuild = await page.evaluate(() => {
    const h = (window as any).storyHarness
    h.snapshot.visualStyle = 'civic'
    h.view.render(structuredClone(h.snapshot))
    const scene = h.game.scene.getScene('tiled-map')
    return scene.children.list.filter((o: any) => o.name.startsWith('environment-')).length
  })
  expect(rebuild).toBe(3)
  expect(errors).toEqual([])
})
