/** Native-resolution materials: variation changes the surface, never the collision grid. */
export const MATERIAL_VARIANTS = 8
export const MATERIAL_COUNT = 20
export function surfaceNoise(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(salt + 1, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function materialTile(material: number, x: number, y: number, seed = 17): number {
  return 1000 + material + MATERIAL_COUNT * Math.floor(surfaceNoise(x, y, seed) * MATERIAL_VARIANTS)
}

/** Stable room finishes survive reloads while varying grain direction, tone and wear. */
export function roomFinish(identity: string): { seed: number; tint: number; rotation: number } {
  let seed = 2166136261
  for (const character of identity) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  const tones = [0xffffff, 0xe6edf0, 0xf4e5d0, 0xe0e8d6, 0xeaded3, 0xd9e4df]
  return { seed, tint: tones[(seed >>> 0) % tones.length]!, rotation: (seed >>> 8 & 1) * Math.PI / 2 }
}

/** Eight variations of cobbles, limestone, encaustic tile, timber, flagstone and workshop stone. */
export function paintMaterials(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false
  for (let variant = 0; variant < MATERIAL_VARIANTS; variant++) {
    for (let material = 0; material < MATERIAL_COUNT; material++) {
      ctx.save()
      ctx.translate(material * 16, variant * 16)
      ctx.beginPath(); ctx.rect(0, 0, 16, 16); ctx.clip()
      const rect = (color: string, x: number, y: number, w: number, h: number) => {
        ctx.fillStyle = color; ctx.fillRect(x, y, w, h)
      }
      const noise = (n: number) => surfaceNoise(n, variant, material + 21)
      const stone = (x: number, y: number, w: number, h: number, base: string, light: string, dark: string) => {
        // Stepped corners, narrow mortar and a one-pixel bevel break the square outline.
        rect(base, x + 1, y, w - 2, h)
        rect(base, x, y + 1, w, h - 2)
        rect(light, x + 1, y, w - 3, 1)
        rect(dark, x + 2, y + h - 1, w - 3, 1)
        rect(dark, x + w - 1, y + 2, 1, h - 3)
      }
      if (material >= 6) {
        const palettes: Record<number, [string, string, string]> = {
          6: ['#6b8052', '#84935b', '#5f764c'], 7: ['#927751', '#aa9064', '#806849'],
          8: ['#d6bb83', '#e5d09b', '#c7a972'], 9: ['#baa076', '#d7bd8b', '#a18b69'],
          10: ['#ad7f62', '#c39975', '#896d5b'], 11: ['#9b9a87', '#b8b19a', '#858b7c'],
          12: ['#dce8df', '#f1f2dd', '#c5d7d4'], 13: ['#91bfc6', '#bbd7d2', '#719ea9'],
          14: ['#8c7554', '#ad956d', '#675d48'], 15: ['#b98c69', '#d2a680', '#996e56'],
          16: ['#8caaa0', '#d8c9a6', '#5d837d'], 17: ['#616f70', '#7b8580', '#4a5a60'],
          18: ['#746750', '#8e7d59', '#5d5b47'], 19: ['#556442', '#6c7848', '#414f39'],
        }
        const [base, light, dark] = palettes[material]!
        rect(base, 0, 0, 16, 16)
        if ([9, 10, 15, 17].includes(material)) {
          rect(dark, 0, 0, 16, 16)
          for (let row = 0; row < 2; row++) for (let col = -1; col < 3; col++) {
            stone(col * 10 + (row % 2 ? 5 : 0), row * 8, 9, 7, base, light, dark)
          }
        } else if (material === 14) {
          for (let row = 0; row < 4; row++) {
            rect(dark, 0, row * 4 + 3, 16, 1)
            rect(light, 1, row * 4, 14, 1)
            rect(dark, 2, row * 4 + 1, 1, 1); rect(dark, 13, row * 4 + 1, 1, 1)
          }
        } else if (material === 16) {
          for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) {
            rect((x + y) % 8 ? light : dark, x + 1, y + 1, 3, 3)
          }
        } else if (material === 11) {
          for (let pebble = 0; pebble < 13; pebble++) {
            const x = Math.floor(noise(pebble + 80) * 16), y = Math.floor(noise(pebble + 100) * 16)
            rect(pebble % 2 ? dark : light, x, y, 2, 1)
          }
        } else if (material === 8 || material === 12 || material === 13) {
          for (let ripple = 0; ripple < 3; ripple++) {
            const x = Math.floor(noise(ripple + 80) * 10), y = Math.floor(noise(ripple + 90) * 16)
            rect(light, x, y, 5, 1); rect(material === 13 ? dark : base, x + 4, y + 1, 4, 1)
          }
        } else {
          for (let mark = 0; mark < 7; mark++) {
            const x = Math.floor(noise(mark + 80) * 16), y = Math.floor(noise(mark + 100) * 16)
            rect(mark % 2 ? dark : light, x, y, material === 19 ? 3 : 2, 1)
            if (material === 6 || material === 19) rect(light, x + 1, y - 1, 1, 2)
          }
        }
      } else if (material === 0) {
        rect('#666960', 0, 0, 16, 16)
        const palette = ['#85877a', '#8b897c', '#7f8479', '#929080']
        for (let row = 0; row < 3; row++) {
          const offset = row % 2 ? -4 : 0
          for (let col = 0; col < 3; col++) {
            const x = offset + col * 9
            stone(x, row * 6 - 1, 8, 5, palette[Math.floor(noise(row * 3 + col) * 4)]!, '#a0a18e', '#72776d')
          }
        }
        if (variant === 3 || variant === 6) {
          rect('#62695a', 7, 5, 3, 1); rect('#747d60', 8, 6, 1, 2)
        }
      } else if (material === 3) {
        rect('#65513c', 0, 0, 16, 16)
        for (let row = 0; row < 4; row++) {
          rect(row % 2 ? '#9b8059' : '#a58a62', 0, row * 4, 16, 3)
          rect('#b49a70', 1, row * 4, 12, 1)
          rect('#806744', Math.floor(noise(row) * 13), row * 4 + 1, 3, 1)
          rect('#705a40', (variant * 3 + row * 7) % 16, row * 4, 1, 3)
        }
      } else if (material === 2) {
        rect('#989984', 0, 0, 16, 16)
        for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
          stone(col * 8, row * 8, 7, 7, (row + col) % 2 ? '#8f9a8a' : '#c2b99d', '#c6c0a7', '#919782')
        }
      } else {
        const workshop = material === 5
        rect(workshop ? '#60665e' : '#929383', 0, 0, 16, 16)
        stone(0, 0, 16, 16, workshop ? '#878d7a' : variant % 3 === 0 ? '#b7b29a' : '#bdb79e', workshop ? '#9ca28b' : '#ccc3a7', workshop ? '#727b6d' : '#a5a58f')
        if (variant === 2 || variant === 5) {
          rect('#959987', 10, 0, 1, 3); rect('#959987', 9, 3, 1, 2); rect('#a4a58e', 8, 5, 1, 2)
        }
      }
      // Sparse mineral flecks and worn pixels, kept low-contrast for readable objects.
      for (let speck = 0; speck < 9; speck++) {
        ctx.globalAlpha = 0.09 + noise(speck + 40) * 0.09
        rect(speck % 2 ? '#eee0bc' : '#343f37', Math.floor(noise(speck + 10) * 16), Math.floor(noise(speck + 25) * 16), speck % 3 === 0 ? 2 : 1, 1)
      }
      ctx.restore()
    }
  }
}
