import { describe, expect, it } from 'vitest'
import { fixtureScenery, roomScenery, usesUrbanGround } from '../src/scenery.js'

describe('public story scenery', () => {
  it('gives the newsroom a paved setting and recognizable equipment', () => {
    expect(usesUrbanGround(['City Desk', 'Photo Morgue', 'Treaty Archive', 'Wire Booth'])).toBe(true)
    expect(roomScenery('Photo Morgue')).toBe('newsroom')
    expect(roomScenery('Treaty Archive')).toBe('archive')
    expect(fixtureScenery('Shortwave Set')).toBe('radio')
    expect(fixtureScenery('Versailles Drawer')).toBe('filing')
    expect(fixtureScenery('Wire Basket on the city desk')).toBe('desk')
  })
  it('preserves outdoor settings and ordinary fixtures without matching context', () => {
    expect(usesUrbanGround(['Forest camp', 'Harbor', 'Market'])).toBe(false)
    expect(fixtureScenery('Treaty oak tree')).toBeNull()
    expect(roomScenery('Council chamber')).toBe('council')
  })
})
