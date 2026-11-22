import { z } from 'zod'

export const FLAG_CATEGORIES = ['abusive', 'threat', 'hateful', 'provocative', 'sexual', 'self_harm'] as const
export const FlagCategory = z.enum(FLAG_CATEGORIES)
export type FlagCategory = z.infer<typeof FlagCategory>

export const FLAG_SEVERITIES = ['urgent', 'serious', 'review'] as const
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number]

export const FLAG_SEVERITY: Record<FlagCategory, FlagSeverity> = {
  self_harm: 'urgent',
  threat: 'urgent',
  hateful: 'serious',
  sexual: 'serious',
  abusive: 'serious',
  provocative: 'review',
}

export function flagSeverity(category: string): FlagSeverity {
  return category in FLAG_SEVERITY ? FLAG_SEVERITY[category as FlagCategory] : 'review'
}

export function compareSeverity(a: FlagSeverity, b: FlagSeverity): number {
  return FLAG_SEVERITIES.indexOf(a) - FLAG_SEVERITIES.indexOf(b)
}
