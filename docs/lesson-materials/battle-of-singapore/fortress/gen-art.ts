// Generates the fictional characters' portraits and the two stage paintings with the app's own prompts.
// Real people (Percival, Bennett) use archival photographs instead; see art/CREDITS.md.
// Run: npx vite-node --config vitest.config.ts docs/lesson-materials/battle-of-singapore/fortress/gen-art.ts
import fs from 'node:fs'
import { EngineSpec } from '../../../../packages/engine/src/index.ts'
import { stancePortraitRequests } from '../../../../apps/web/src/lib/v3/portraits/generate.ts'
import { v3StagePaintingPrompt } from '../../../../apps/web/src/lib/v3/stage-art/generate.ts'

const folder = new URL('.', import.meta.url).pathname
const out = folder + 'art/'
fs.mkdirSync(out, { recursive: true })
const spec = EngineSpec.parse(JSON.parse(fs.readFileSync(folder + 'adventure.json', 'utf8')).spec)
const fictional = new Set(spec.characters.filter(c => !c.real).map(c => c.id))

const jobs = [
  // One base portrait per fictional character, in its first (or only) expression.
  ...stancePortraitRequests(spec)
    .filter(p => fictional.has(p.portraitKey.split(':')[0]!))
    .filter((p, i, all) => all.findIndex(q => q.portraitKey.split(':')[0] === p.portraitKey.split(':')[0]) === i)
    .map(p => ({ file: `portrait-${p.portraitKey.split(':')[0]}.png`, prompt: p.prompt, size: '1024x1024' })),
  ...spec.stages.map((s, i) => ({ file: `stage-${i + 1}-${s.id}.png`, prompt: v3StagePaintingPrompt(spec, i), size: '1536x1024' })),
]

const model = process.env.LLM_MODEL_IMAGE ?? 'gpt-image-1-mini'
await Promise.all(jobs.map(async job => {
  const res = await fetch(`${(process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: job.prompt, size: job.size, quality: 'medium', n: 1 }),
  })
  const body = await res.json()
  if (!res.ok) { console.error(job.file, res.status, body.error?.message); return }
  fs.writeFileSync(out + job.file, Buffer.from(body.data[0].b64_json, 'base64'))
  console.log('wrote', job.file)
}))
