import { z } from "zod";
import { AdventureSpec, MediaSnapshot } from "@adventure/spec-v3";
import { V3Edit, applyV3Edits, type CapturedSource } from "@/lib/v3/edit/commands";

export const browserDraftKey = (adventureId: string) => `v3-editor-draft:${adventureId}`;
const BrowserDraft = z.object({
  version: z.number().int().positive(),
  base: AdventureSpec,
  edits: z.array(V3Edit),
  candidates: z.record(z.string(), z.object({
    id: z.string().uuid(), adventureId: z.string(), target: z.object({ kind: z.enum(["stage", "portrait", "playerSprite", "characterSprite"]), key: z.string().min(1) }), snapshot: MediaSnapshot,
  })),
});
export type BrowserDraft = z.infer<typeof BrowserDraft>;

export function recoverBrowserDraft(raw: string, adventureId: string, sources: CapturedSource[]) {
  const saved = BrowserDraft.parse(JSON.parse(raw));
  if (Object.values(saved.candidates).some(candidate => candidate.adventureId !== adventureId))
    throw Error("Draft belongs to another adventure.");
  return { ...saved, draft: applyV3Edits(saved.base, saved.edits, sources, true, { candidates: saved.candidates }) };
}
