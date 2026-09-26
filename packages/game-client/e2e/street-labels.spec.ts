import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

test('street names track sprite heads on every animation frame', async ({ page }, testInfo) => {
  await page.route('**/game/ninja/**', async route => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    await route.fulfill({ body: await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix)), contentType: suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png' })
  })
  await page.goto('/e2e/story-preview.html?style=harbor')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).storyHarness))).toBe(true)
  await page.getByRole('button', { name: 'Whole map', exact: true }).click()
  const result = await page.evaluate(async () => {
    const scene = (window as any).storyHarness.game.scene.getScene('tiled-map')
    const samples: { id: string; x: number; y: number; dx: number; gap: number; targetError: number }[] = []
    // Sample after the scene updates and before rendering; stale tile anchors fail here.
    const sample = () => {
      for (const resident of scene.ambientLife.residents) {
        if (!resident.person) continue
        const id = `street:${resident.person.id}`
        const label = scene.captions.get(id)
        const target = scene.targets().find((target: any) => target.id === id)
        if (!label?.visible || !target) continue
        samples.push({ id, x: resident.sprite.x, y: resident.sprite.y,
          dx: label.x + label.width / 2 - resident.sprite.x,
          gap: resident.sprite.y - 8 - (label.y + label.height),
          targetError: Math.abs(target.bounds.x + target.bounds.width / 2 - resident.sprite.x)
            + Math.abs(target.bounds.y + target.bounds.height / 2 - resident.sprite.y) })
      }
    }
    scene.events.on('postupdate', sample)
    await new Promise(resolve => setTimeout(resolve, 2500))
    scene.events.off('postupdate', sample)
    return samples
  })
  expect(result.length).toBeGreaterThan(20)
  expect(result.some((sample, i) => result.slice(i + 1).some(other => other.id === sample.id && Math.hypot(other.x - sample.x, other.y - sample.y) > 1))).toBe(true)
  for (const sample of result) {
    expect(sample.dx).toBeCloseTo(0, 5)
    expect(sample.gap).toBeCloseTo(3, 5)
    expect(sample.targetError).toBeCloseTo(0, 5)
  }
  await page.screenshot({ path: testInfo.outputPath('street-labels.png') })
})
