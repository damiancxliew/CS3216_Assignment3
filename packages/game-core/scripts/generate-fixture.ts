import { writeFile } from 'node:fs/promises'
import { it } from 'vitest'
import { compileStage } from '../src/index.js'
import { settlementFixture } from '../fixtures/settlement.js'

it('generates the checked-in settlement fixture', async () => {
  const compiled = compileStage(settlementFixture, 'fixture-seed')
  await writeFile(
    new URL('../fixtures/settlement.compiled.json', import.meta.url),
    `${JSON.stringify(compiled, null, 2)}\n`,
  )
})
