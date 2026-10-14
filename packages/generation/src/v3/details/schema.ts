/**
 * LLM wire schemas for the stage-details, persona, minors and link calls — strict
 * structured-output friendly (every field required, optionals as `null`, maps as pair lists) —
 * and the conversions to AdventureSpec fragments.
 */
import { z } from 'zod'
import type { Condition } from '@adventure/spec-v3'

const Id = z.string()
const Text = z.string()

const Cit = z.object({ sourceId: Id, quote: Text.nullable() })
const Requires = z.object({ discoveries: z.array(Id), stanceAtLeast: Id.nullable() })
const Effect = z.object({ kind: z.enum(['toStance', 'stanceDelta']), stance: Id.nullable(), delta: z.number().int().nullable() })
const PersonaCore = z.object({
  voice: Text,
  phrases: z.array(z.object({ text: Text, sourceLabel: Text, citations: z.array(Cit).nullable() })),
  knewThen: Text,
  wantsFromStudent: Text,
  withholds: z.array(Text),
})
const WireDiscovery = <R extends z.ZodTypeAny>(requires: R) =>
  z.object({
    id: Id,
    stageId: Id,
    text: Text,
    note: Text,
    topic: Text,
    sourceLabel: Text,
    citations: z.array(Cit).nullable(),
    requires,
  })

export const StageDetailsLlmOutput = z.object({
  openingNarration: Text,
  documents: z.array(
    z.object({
      id: Id,
      kind: z.enum(['newspaper', 'letter', 'telegram', 'speech', 'minutes', 'memoir', 'treaty', 'report', 'other']),
      title: Text,
      real: z.boolean(),
      provenance: z.object({ masthead: Text.nullable(), date: Text.nullable(), sender: Text.nullable(), recipient: Text.nullable(), place: Text.nullable() }),
      body: Text,
      sourceLabel: Text,
      glossary: z.array(z.object({ term: Text, meaning: Text })),
      keyPassages: z.array(z.object({ id: Id, text: Text })),
      citations: z.array(Cit).nullable(),
      slanted: z.boolean(),
      slantNote: Text.nullable(),
    }),
  ),
  coreLinks: z.array(z.object({ discoveryId: Id, keyPassageId: Id })),
  discoveries: z.array(
    z.object({
      id: Id,
      documentId: Id,
      keyPassageId: Id,
      text: Text,
      note: Text,
      topic: Text,
      sourceLabel: Text,
      citations: z.array(Cit).nullable(),
    }),
  ),
  documentPlacement: z.array(z.object({ documentId: Id, roomId: Id })),
  situations: z.array(
    z.object({
      momentId: Id,
      outcomeId: Id,
      openingNarration: Text.nullable(),
      placement: z.array(z.object({ characterId: Id, roomId: Id })).nullable(),
      documentPlacement: z.array(z.object({ documentId: Id, roomId: Id })).nullable(),
    }),
  ),
  storyEvents: z.array(
    z.object({
      id: Id,
      when: z.object({
        kind: z.enum(['atSeconds', 'discovered', 'stuck', 'timerOut']),
        seconds: z.number().nullable(),
        discoveryId: Id.nullable(),
      }),
      effect: z.enum(['summons', 'move', 'deliverDocument', 'news', 'beginMoment']),
      characterId: Id.nullable(),
      toRoomId: Id.nullable(),
      documentId: Id.nullable(),
      text: Text,
    }),
  ),
  openQuestions: z.array(z.object({ id: Id, text: Text, discoveryIds: z.array(Id) })),
})
export type StageDetailsLlmOutput = z.infer<typeof StageDetailsLlmOutput>

export const PersonaLlmOutput = z.object({
  persona: PersonaCore,
  stances: z.array(z.object({ label: Text, demeanour: Text, hidden: z.boolean() })),
  initialStance: z.number().int(),
  trustNotice: Text,
  coreConditions: z.array(z.object({ discoveryId: Id, requires: Requires })),
  discoveries: z.array(WireDiscovery(Requires)),
  slants: z.array(z.object({ id: Id, claim: Text, contradictedBy: z.array(Id) })),
  triggers: z.array(
    z.object({
      id: Id,
      on: z.object({ kind: z.enum(['notePassed', 'slantConfronted', 'discovered']), id: Id }),
      requires: Requires.nullable(),
      effect: Effect,
      handsOver: z.array(Id),
      notice: Text,
    }),
  ),
})
export type PersonaLlmOutput = z.infer<typeof PersonaLlmOutput>

export const MinorsLlmOutput = z.object({
  characters: z.array(
    z.object({
      characterId: Id,
      persona: PersonaCore,
      discoveries: z.array(WireDiscovery(z.object({ discoveries: z.array(Id) }))),
      slants: z.array(z.object({ id: Id, claim: Text, contradictedBy: z.array(Id), unlocksDiscoveryId: Id.nullable() })),
    }),
  ),
})
export type MinorsLlmOutput = z.infer<typeof MinorsLlmOutput>

export const LinkLlmOutput = z.object({
  slantLinks: z.array(z.object({ slantId: Id, contradictedBy: z.array(Id) })),
  noteTriggers: z.array(z.object({ id: Id, characterId: Id, discoveryId: Id, effect: Effect, notice: Text })),
})
export type LinkLlmOutput = z.infer<typeof LinkLlmOutput>

export function detailsJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as Record<string, unknown>
}

// --- conversions ---------------------------------------------------------------

export const citations = (items: { sourceId: string; quote: string | null }[] | null) => {
  const list = items?.map((c) => (c.quote === null ? { sourceId: c.sourceId } : { sourceId: c.sourceId, quote: c.quote }))
  return list && list.length > 0 ? list : undefined
}

export const pairs = (items: { [k: string]: string }[], a: string, b: string) => Object.fromEntries(items.map((p) => [p[a]!, p[b]!]))

/** requires → Condition, or undefined when nothing is required. */
export function toCondition(requires: { discoveries: string[]; stanceAtLeast: string | null }, characterId: string): Condition | undefined {
  const items: Condition[] = requires.discoveries.map((id) => ({ discovered: id }))
  if (requires.stanceAtLeast !== null) items.push({ stanceAtLeast: { characterId, stanceId: requires.stanceAtLeast } })
  if (items.length === 0) return undefined
  if (items.length === 1) return items[0]
  return { all: items }
}

export function toEffect(effect: { kind: 'toStance' | 'stanceDelta'; stance: string | null; delta: number | null }) {
  return effect.kind === 'toStance' ? { toStance: effect.stance! } : { stanceDelta: effect.delta! as 1 | -1 }
}

export function toWhen(when: { kind: 'atSeconds' | 'discovered' | 'stuck' | 'timerOut'; seconds: number | null; discoveryId: string | null }) {
  switch (when.kind) {
    case 'atSeconds':
      return { atSeconds: when.seconds! }
    case 'discovered':
      return { condition: { discovered: when.discoveryId! } as Condition }
    case 'stuck':
      return { stuck: true as const }
    case 'timerOut':
      return { timerOut: true as const }
  }
}

const provenance = (p: { masthead: string | null; date: string | null; sender: string | null; recipient: string | null; place: string | null }) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null)) as {
    masthead?: string
    date?: string
    sender?: string
    recipient?: string
    place?: string
  }

/** Wire document → spec Document; key passage offsets are computed from the body. */
export function toDocument(doc: StageDetailsLlmOutput['documents'][number]) {
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    provenance: provenance(doc.provenance),
    body: doc.body,
    real: doc.real,
    sourceLabel: doc.sourceLabel,
    glossary: doc.glossary,
    keyPassages: doc.keyPassages.map((passage) => {
      const start = doc.body.indexOf(passage.text)
      return { id: passage.id, start, end: start + passage.text.length }
    }),
    citations: citations(doc.citations),
  }
}
