import { z } from 'zod'

const Id = z.string().min(1).max(200)
const Text = z.string().trim().min(1).max(2500)
export const ReadingSupport = z.strictObject({ start: z.number().int().nonnegative().max(100_000), end: z.number().int().positive().max(100_000) })
export const ReadingQuestion = z.strictObject({
  id: Id,
  prompt: Text,
  options: z.array(z.strictObject({ id: Id, text: Text })).length(3),
  correctOptionId: Id,
  support: z.array(ReadingSupport).min(1).max(5),
  explanation: Text,
})
export const ReadingCheck = z.strictObject({
  discoveryId: Id,
  variants: z.array(ReadingQuestion).length(4),
  recovery: ReadingQuestion,
  recoveryDiscoveryIds: z.array(Id).max(30),
})
export const PreparationGroup = z.strictObject({ discoveryIds: z.array(Id).min(1).max(30), minMet: z.number().int().min(1).max(30) })
export const StagePreparation = z.strictObject({
  characters: z.record(Id, z.array(PreparationGroup).max(20)),
  decision: z.array(PreparationGroup).max(20),
  essentialCharacters: z.array(z.strictObject({ characterId: Id, discoveryIds: z.array(Id).min(1).max(20) })).min(1).max(20),
})
export type ReadingQuestion = z.infer<typeof ReadingQuestion>
export type ReadingCheck = z.infer<typeof ReadingCheck>
export type PreparationGroup = z.infer<typeof PreparationGroup>
export type StagePreparation = z.infer<typeof StagePreparation>

export function preparationProgress(groups: readonly PreparationGroup[], discovered: readonly string[]) {
  const known = new Set(discovered)
  const required = groups.reduce((sum, group) => sum + group.minMet, 0)
  const completed = groups.reduce((sum, group) => sum + Math.min(group.minMet, group.discoveryIds.filter(id => known.has(id)).length), 0)
  return { completed, required, ready: completed === required }
}
