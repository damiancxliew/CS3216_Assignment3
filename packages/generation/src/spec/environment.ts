import { z } from 'zod'

export const ENVIRONMENT_MATERIALS = ['cobble', 'limestone', 'checker', 'timber', 'flagstone', 'slate', 'grass', 'earth', 'sand', 'sandstone', 'brick', 'gravel', 'snow', 'ice', 'decking', 'terracotta', 'mosaic', 'basalt', 'mud', 'leaves'] as const
export const ENVIRONMENT_PROPS = ['planter', 'bench', 'lamp', 'crate', 'barrel', 'rope', 'pottery', 'awning', 'palm', 'boulder', 'log', 'fern', 'pipe', 'sacks', 'brazier', 'column', 'rubble', 'sandbags', 'bicycle', 'noticeboard', 'flowerbed', 'cart', 'fishing-net', 'bollard', 'canopy', 'laundry', 'urn', 'cypress', 'buoy', 'anchor'] as const
/** Public art direction. No private plot, arbitrary URLs, shaders or executable model output. */
export const environmentSchema = z.object({
  description: z.string().trim().min(1).max(400),
  ground: z.enum(ENVIRONMENT_MATERIALS),
  accent: z.enum(ENVIRONMENT_MATERIALS),
  path: z.enum(ENVIRONMENT_MATERIALS),
  pathStyle: z.enum(['formal', 'winding', 'worn']),
  roof: z.enum(['terracotta', 'slate', 'thatch', 'canvas', 'timber']),
  waterfront: z.enum(['none', 'harbor', 'river', 'pond', 'oasis']),
  layout: z.enum(['courtyard', 'garden-loop', 'quayside', 'meandering']).default('courtyard'),
  population: z.enum(['quiet', 'residents', 'workers', 'traders']).default('residents'),
  wind: z.enum(['calm', 'breeze', 'gusts']).default('breeze'),
  fauna: z.array(z.enum(['camel', 'goat', 'chicken', 'cat'])).max(4).default([]),
  vegetation: z.number().min(0).max(1),
  propDensity: z.enum(['sparse', 'lived-in', 'busy']),
  props: z.preprocess(value => Array.isArray(value) ? [...new Set(value)] : value, z.array(z.enum(ENVIRONMENT_PROPS)).min(3).max(10)),
})
export type EnvironmentPlan = z.infer<typeof environmentSchema>
