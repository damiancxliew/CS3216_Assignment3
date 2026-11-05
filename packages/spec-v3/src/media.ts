import { z } from "zod";
const url = z
  .string()
  .url()
  .regex(/^https?:\/\//, "Expected HTTP(S) URL");
/** Public presentation only. Private permission confirmations never enter a spec. */
export const MediaSnapshot = z.strictObject({
  candidateId: z.string().uuid(),
  origin: z.enum(["upload", "commons", "loc", "un", "ai"]),
  url,
  storageKey: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  format: z.enum(["webp", "png", "jpeg", "external"]),
  caption: z.string().min(1).max(2000),
  alt: z.string().min(1).max(1000),
  credit: z.string().max(2000),
  sourceUrl: url.optional(),
  licence: z
    .strictObject({ label: z.string().min(1), url: url.optional() })
    .optional(),
  spriteLayout: z.literal("4x4-down-up-left-right").optional(),
});
export type MediaSnapshot = z.infer<typeof MediaSnapshot>;
export const ImageSelection = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("fallback") }),
  z.strictObject({ type: z.literal("candidate"), candidate: MediaSnapshot }),
  z.strictObject({
    type: z.literal("legacy"),
    url: url.nullable(),
    version: z.number().int().positive(),
  }),
]);
export type ImageSelection = z.infer<typeof ImageSelection>;
export const WalkingSpriteSelection = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("bundled"),
    bundledId: z.string().min(1),
    fallback: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("custom"),
    candidate: MediaSnapshot,
    fallback: z.string().min(1),
  }),
]);
export type WalkingSpriteSelection = z.infer<typeof WalkingSpriteSelection>;
