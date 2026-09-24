/**
 * Planner I/O shapes (FR-2, FR-1a). The planner produces the *narrative* half of
 * the spec; ingest and the teacher own the rest (`version`, `id`, `sources`,
 * `readingLevel`) and the pipeline merges them in before validation. That keeps
 * the model from being able to invent a source or lower the reading level.
 */
import { z } from 'zod'

import {
  adventureSpecObjectSchema,
  MAX_ROOMS_PER_STAGE,
  MAX_STAGES,
  MIN_ROOMS_PER_STAGE,
  readingLevelSchema,
  roomSchema,
  stageSchema,
} from '../spec/v2'

export const teacherInputSchema = z.object({
  /** Optional title hint; the planner may improve it. */
  title: z.string().trim().min(1).max(120).nullable().default(null),
  setting: z.string().trim().min(1).max(200),
  learningObjectives: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  studentRole: z.string().trim().min(1).max(200),
  /** Required (FR-1a): an adventure cannot be created without it. */
  readingLevel: readingLevelSchema,
  stageCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3),
  /** The teacher's stage plan, in order: what each stage is about and what the student decides. Empty leaves it to the planner. */
  stageOutline: z.array(z.object({ title: z.string().trim().min(1).max(120), focus: z.string().trim().min(1).max(300) })).max(3).default([]),
  defaultTimerSeconds: z.number().int().min(0).max(3600).default(480),
})
export type TeacherInput = z.infer<typeof teacherInputSchema>
export type TeacherInputRaw = z.input<typeof teacherInputSchema>

// Published adventures need a spatial map. Keep the shared spec parser tolerant
// of legacy records, while making new planner output explicit in its JSON schema.
const plannerRoomSchema = roomSchema.extend({ enclosure: z.enum(['enclosed', 'open']) })
const plannerStageSchema = stageSchema.extend({ rooms: z.array(plannerRoomSchema).min(MIN_ROOMS_PER_STAGE).max(MAX_ROOMS_PER_STAGE) })
export const plannerAdventureSchema = adventureSpecObjectSchema
  .omit({ version: true, id: true, sources: true, readingLevel: true })
  .extend({ stages: z.array(plannerStageSchema).min(1).max(MAX_STAGES) })

export const plannerOutputSchema = z.object({
  adventure: plannerAdventureSchema,
  /**
   * FR-3: what the sources did not say that the adventure needed. Reported to
   * the teacher, never filled in silently.
   */
  missingInformation: z.array(z.string().trim().min(1).max(400)).max(20),
})
export type PlannerOutput = z.infer<typeof plannerOutputSchema>

export function plannerOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(plannerOutputSchema, { target: 'draft-2020-12', io: 'output' })
}
