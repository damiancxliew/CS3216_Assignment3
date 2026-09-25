import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { overlaps } from '../src/map-labels.js'
import { MATERIAL_COUNT, MATERIAL_VARIANTS } from '../src/materials.js'

test('pixel actors animate, ignore portrait art and retain clickable captions', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/game/ninja/**', async (route) => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/ninja/'.length)
    if (suffix.startsWith('characters/MissingCharacter/')) return route.fulfill({ status: 404, body: '' })
    const body = await readFile(resolve('../..', 'apps/web/public/game/ninja', suffix))
    const contentType = suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : 'image/png'
    await route.fulfill({ body, contentType })
  })
  await page.route('**/missing-portrait.png', (route) => route.fulfill({ status: 404, body: '' }))
  await page.route('**/game/portraits/adolf-hitler.jpg', async (route) => route.fulfill({
    contentType: 'image/jpeg', body: await readFile(resolve('../..', 'apps/web/public/game/portraits/adolf-hitler.jpg')),
  }))
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
  expect(initial.stockSprites).toEqual(['char-Boy', 'char-Inspector', 'char-Noble'])
  expect(initial.images).toHaveLength(0)
  expect(initial.ground).toBeGreaterThanOrEqual(1000)
  expect(initial.ground).toBeLessThan(1000 + MATERIAL_COUNT * MATERIAL_VARIANTS)
  expect((initial.ground - 1000) % MATERIAL_COUNT).toBe(11)
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

  // Portrait availability must never replace a walking body with a static card.
  await page.evaluate(() => {
    const harness = (window as any).tiledHarness
    const portrait = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="#716c5b" d="M0 0h64v64H0z"/><path fill="#282b28" d="M9 64V48l16-9h14l16 9v16zM21 12h23v21H21z"/><path fill="#c4a27c" d="M24 19h17v21H24z"/><path fill="#252b29" d="M25 25h4v2h-4zm11 0h4v2h-4z"/></svg>')
    harness.snapshot.actors.find((actor: any) => actor.id === 'tojo').portraitUrl = portrait
    harness.view.render(structuredClone(harness.snapshot))
  })
  expect((await inspect()).images).toEqual([])
  expect((await inspect()).stockSprites).toEqual(initial.stockSprites)
  await page.screenshot({ path: testInfo.outputPath('newsroom.png') })

  // Real frame progression, correct direction, idle reset and reduced-motion stop.
  const walking = await page.evaluate(async () => {
    const h = (window as any).tiledHarness
    h.view.setReducedMotion(false)
    const actor = h.snapshot.actors.find((a: any) => a.id === 'tojo')
    h.snapshot.actors.find((a: any) => a.id === 'player').space = null
    h.snapshot.roomWandering = true
    actor.status = 'moving'
    const sprite = h.game.scene.getScene('tiled-map').markers.get('tojo').sprite
    const frames: number[] = []
    const observeFrame = () => frames.push(sprite.frame.name)
    sprite.on('animationupdate', observeFrame)
    actor.position.x -= 1
    h.view.render(structuredClone(h.snapshot))
    const first = sprite.frame.name
    const playing = sprite.anims.isPlaying
    const direction = sprite.anims.currentAnim.key
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Walking animation did not return to idle')), 15000)
      sprite.once('animationstop', () => { clearTimeout(timeout); resolve() })
    })
    sprite.off('animationupdate', observeFrame)
    const idle = { playing: sprite.anims.isPlaying, frame: sprite.frame.name }
    actor.position.x += 1
    h.view.render(structuredClone(h.snapshot))
    h.view.setReducedMotion(true)
    h.snapshot.roomWandering = false
    actor.status = 'idle'
    return { first, frames, playing, direction, idle, reducedPlaying: sprite.anims.isPlaying }
  })
  expect(walking.playing).toBe(true)
  expect(walking.direction).toBe('char-Inspector-left')
  expect(walking.frames.some((frame: number) => frame !== walking.first)).toBe(true)
  expect(walking.idle).toEqual({ playing: false, frame: 2 })
  expect(walking.reducedPlaying).toBe(false)

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
    harness.snapshot.actors.find((entry: any) => entry.id === 'tojo').portraitUrl = '/missing-portrait.png'
    harness.snapshot.actors.find((entry: any) => entry.id === 'hitler').portraitUrl = '/missing-portrait.png'
    harness.view.render(structuredClone(harness.snapshot))
  })
  expect((await inspect()).images).toHaveLength(0)
  expect((await inspect()).images).toEqual(initial.images)
  expect((await inspect()).stockSprites).toEqual(initial.stockSprites)
  // Preserve production's generated pixel walking sheets alongside the curated fallback.
  await page.evaluate(() => {
    const h = (window as any).tiledHarness
    h.snapshot.actors.find((a: any) => a.id === 'tojo').spriteSheetUrl = '/game/ninja/characters/Boy/walk.png'
    h.view.render(structuredClone(h.snapshot))
  })
  await expect.poll(async () => (await inspect()).stockSprites.filter((key: string) => key.startsWith('asset-')).length).toBe(1)
  expect((await inspect()).generatedLeftFrames).toEqual([2, 6, 10, 14])
  await page.evaluate(() => {
    const h = (window as any).tiledHarness
    h.snapshot.actors.find((a: any) => a.id === 'tojo').spriteSheetUrl = null
    h.view.render(structuredClone(h.snapshot))
  })
  await page.evaluate(() => {
    const h = (window as any).tiledHarness
    h.snapshot.actors.find((actor: any) => actor.id === 'tojo').sprite = 'MissingCharacter'
    h.view.render(structuredClone(h.snapshot))
  })
  await expect.poll(async () => (await inspect()).stockSprites).toEqual(['char-Boy', 'char-Noble', 'char-Villager'])
  expect(errors).toEqual([])
})

test('weather stays outdoors, respects reduced motion and cleans up on changes', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/game/**', async (route) => {
    const suffix = new URL(route.request().url()).pathname.slice('/game/'.length)
    const body = await readFile(resolve('../..', 'apps/web/public/game', suffix))
    await route.fulfill({ body, contentType: suffix.endsWith('.svg') ? 'image/svg+xml' : suffix.endsWith('.ogg') ? 'audio/ogg' : suffix.endsWith('.jpg') ? 'image/jpeg' : 'image/png' })
  })
  await page.route('**/weather-test', (route) => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>' }))
  await page.goto('/weather-test')
  await page.evaluate(async () => {
    const path = '/e2e/tiled-harness.ts'
    Object.assign(window, { tiledHarness: await import(/* @vite-ignore */ path) })
  })
  for (const id of ['rain', 'thunderstorm', 'haze', 'fog']) {
    const state = await page.evaluate(async (id) => {
      const h = (window as any).tiledHarness
      h.view.setReducedMotion(false)
      h.snapshot.ambient = { id, intensity: 3 }
      h.view.render(structuredClone(h.snapshot))
      const scene = h.game.scene.getScene('tiled-map')
      const path = '/src/weather.ts'
      const { isExposed } = await import(/* @vite-ignore */ path)
      const room = h.snapshot.map.rooms.find((r: any) => r.enclosure === 'enclosed')
      const children = scene.children.list.filter((child: any) => child.name.startsWith('weather-'))
      return { count: children.length, masked: children.every((child: any) => !!child.mask), sheltered: !isExposed(h.snapshot.map, room.x + 1, room.y + 1) }
    }, id)
    expect(state).toEqual({ count: 3, masked: true, sheltered: true })
    await page.waitForTimeout(160)
    await page.screenshot({ path: testInfo.outputPath(`${id}.png`) })
  }
  const motion = await page.evaluate(() => {
    const h = (window as any).tiledHarness
    h.snapshot.ambient = { id: 'thunderstorm', intensity: 3 }
    h.view.setReducedMotion(true)
    h.view.render(structuredClone(h.snapshot))
    const scene = h.game.scene.getScene('tiled-map')
    const air = scene.children.getByName('weather-air')
    const before = [...air.commandBuffer]
    scene.update(20000, 16000)
    return { before, after: [...air.commandBuffer], wet: scene.children.getByName('weather-surface').commandBuffer.length }
  })
  expect(motion.after).toEqual(motion.before)
  expect(motion.wet).toBeGreaterThan(0)
  const remaining = await page.evaluate(() => {
    const h = (window as any).tiledHarness
    h.snapshot.ambient = { id: 'clear', intensity: 1 }
    h.view.render(structuredClone(h.snapshot))
    return h.game.scene.getScene('tiled-map').children.list.filter((child: any) => child.name.startsWith('weather-')).length
  })
  expect(remaining).toBe(0)
  expect(errors).toEqual([])
})
