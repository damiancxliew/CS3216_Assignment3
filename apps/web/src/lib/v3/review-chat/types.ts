import { z } from "zod";
import { V3Edit } from "../edit/commands";
import type { SkeletonShape } from "@adventure/spec-v3";
import type { BriefStateV3 } from "../brief/schema";

export const reviewChatInput = z.discriminatedUnion("pass", [
  z.object({
    pass: z.literal("sources"),
    removedSourceIds: z.array(z.string()).max(100),
  }),
  z.object({ pass: z.literal("skeleton"), skeleton: z.unknown() }),
  z.object({
    pass: z.enum(["details", "endings", "reveal"]),
    edits: z.array(V3Edit).max(2000),
  }),
  z.object({
    pass: z.literal("draft"),
    version: z.number().int().nonnegative(),
    edits: z.array(V3Edit).max(2000),
  }),
]);
export type ReviewChatInput = z.infer<typeof reviewChatInput>;
export type ReviewChatProposal =
  | { pass: "sources"; removedSourceIds: string[] }
  | { pass: "skeleton"; skeleton: SkeletonShape }
  | { pass: "details" | "endings" | "reveal" | "draft"; edits: V3Edit[] };
export type ReviewChatResult =
  | {
      ok: true;
      preview: { label: string; before: string; after: string }[];
      notes: string;
      proposal: ReviewChatProposal | null;
      state: BriefStateV3;
    }
  | { ok: false; message: string };
