/**
 * LLM wire schemas for the endings pass — one defining-moment call and one ending call,
 * strict structured-output friendly (unused atom fields as null) — and the conversions
 * to AdventureSpec fragments.
 */
import { z } from 'zod'
import type { Condition } from '@adventure/spec-v3'

const Id = z.string()
const Text = z.string()

export const Atom = z.object({
  kind: z.enum(['discovered', 'stanceAtLeast', 'notePassed', 'slantConfronted', 'outcome']),
  negate: z.boolean(),
  discoveryId: Id.nullable(),
  characterId: Id.nullable(),
  stanceId: Id.nullable(),
  slantId: Id.nullable(),
  momentId: Id.nullable(),
  outcomeId: Id.nullable(),
})
export type Atom = z.infer<typeof Atom>

export const MomentLlmOutput = z.object({
  nudge: Text,
  finalCallNarration: Text,
  acts: z.array(z.object({ id: Id, reaction: Text, deception: z.boolean() })),
  outcomes: z.array(z.object({ id: Id, predictionText: Text, because: Text })),
  conditionalRules: z.array(z.object({ actId: Id, outcomeId: Id, when: z.array(Atom) })),
  secretUnlock: z.object({ actId: Id, conditions: z.array(Atom), minMet: z.number().int() }).nullable(),
})
export type MomentLlmOutput = z.infer<typeof MomentLlmOutput>

export const EndingLlmOutput = z.object({
  epilogue: Text,
  interviewer: Text,
  question: Text,
  verdicts: z.array(z.object({ text: Text, counterPoints: z.array(Id) })),
  generalCounter: Text,
})
export type EndingLlmOutput = z.infer<typeof EndingLlmOutput>

// --- conversions ---------------------------------------------------------------

function atomCondition(atom: Atom): Condition {
  let base: Condition
  switch (atom.kind) {
    case 'discovered':
      base = { discovered: atom.discoveryId! }
      break
    case 'stanceAtLeast':
      base = { stanceAtLeast: { characterId: atom.characterId!, stanceId: atom.stanceId! } }
      break
    case 'notePassed':
      base = { notePassed: { discoveryId: atom.discoveryId!, characterId: atom.characterId! } }
      break
    case 'slantConfronted':
      base = { slantConfronted: atom.slantId! }
      break
    case 'outcome':
      base = { outcome: { momentId: atom.momentId!, outcomeId: atom.outcomeId! } }
      break
  }
  return atom.negate ? { not: base } : base
}

/** each atom → its own Condition (for secret unlock lists). */
export const atomConditions = (atoms: Atom[]): Condition[] => atoms.map(atomCondition)

/** 1–3 atoms → one Condition: negate wraps in {not}, several become {all:[…]}. */
export function toWhenCondition(atoms: Atom[]): Condition | undefined {
  const conditions = atomConditions(atoms)
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return { all: conditions }
}
