import { expect, it } from 'vitest'
import { mountPlayground } from '../src/index.js'

it('imports the reusable client entry without browser globals in Node', () => {
  expect(mountPlayground).toBeTypeOf('function')
})
