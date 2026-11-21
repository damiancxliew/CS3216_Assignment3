import { runCheckEval } from './v3-check'

const via = process.argv[2] === 'completion' ? 'completion' : 'decisions'
await runCheckEval(via)
