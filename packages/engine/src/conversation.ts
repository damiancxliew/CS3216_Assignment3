/**
 * Talking to a character: the rules run first, then the model words the reply [C11, C12]. The reply is
 * returned at once; whether it conveyed a discovery is settled later by the post-turn check (`postTurn`),
 * which reads the snapshot taken here.
 */
import { replyAsCharacter, type PersonaInput, type StudentTurn } from '@adventure/orchestration/v3'

import { currentStage, fail, lookup, type StepContext } from './context'
import { heldBackTopics, noteText, revealableFor, studentNoteTexts } from './rules/knowledge'
import { stanceIndex } from './conditions'
import type { SpecCharacter } from './spec'

export const MAX_PENDING_CHECKS = 3
const TRANSCRIPT_LINES = 12

/** Ask for what they want on the 3rd reply, then every 4th (P11.2), so it isn't every line. */
export function shouldAskForWant(replies: number): boolean {
  return replies >= 2 && (replies - 2) % 4 === 0
}

export function requireConversation(ctx: StepContext, characterId: string): SpecCharacter {
  const { state } = ctx
  if (state.phase !== 'stage' || state.stageIntroPending) fail('illegal_phase', 'conversation needs an open stage')
  if (state.moment !== null) fail('illegal_phase', 'the defining moment has begun')
  const character = lookup.character(ctx.spec, characterId)
  const present = state.characters[characterId]?.roomId
  if (present === null || present === undefined || present !== state.playerRoomId) fail('not_present', `${character.name} is not here`)
  if (state.pendingChecks.length >= MAX_PENDING_CHECKS) fail('pending', 'still listening; try again in a moment')
  return character
}

function personaInput(
  ctx: StepContext,
  character: SpecCharacter,
  turn: StudentTurn,
  revealable: readonly { text: string }[],
  extra: { stanceJustChanged: boolean; handingOver: string[] },
): PersonaInput {
  const { spec, state, now } = ctx
  const stage = currentStage(ctx)
  const characterState = state.characters[character.id]
  const stance = character.stances[stanceIndex(spec, character.id, characterState?.stanceId ?? null)]
  const room = stage.rooms.find((candidate) => candidate.id === state.playerRoomId)
  const othersPresent = spec.characters
    .filter((other) => other.id !== character.id && state.characters[other.id]?.roomId === state.playerRoomId)
    .map((other) => other.name)
  const memory = state.passedOn
    .filter((passed) => passed.characterId === character.id)
    .map((passed) => `They told you: ${noteText(spec, passed.discoveryId)}`)
  const transcript = state.transcript
    .filter((message) => message.characterId === character.id && (message.kind === 'player' || message.kind === 'character'))
    .slice(-TRANSCRIPT_LINES)
    .map((message) => ({
      speaker: message.kind === 'player' ? ('student' as const) : ('you' as const),
      text: message.insertedNoteId === null ? message.text : `[shows a note] ${noteText(spec, state.notes.find((note) => note.id === message.insertedNoteId)?.discoveryId ?? '')} ${message.text}`.trim(),
    }))
  return {
    character: {
      name: character.name,
      title: character.title,
      voice: character.persona.voice,
      phrases: character.persona.phrases.map((phrase) => phrase.text),
      knewThen: character.persona.knewThen,
      wantsFromStudent: character.persona.wantsFromStudent,
      withholds: character.persona.withholds,
      publicPosition: character.persona.publicPosition,
      privateAgenda: character.persona.privateAgenda,
      slants: character.slants.map((slant) => slant.claim),
    },
    demeanour: stance?.demeanour ?? null,
    stanceJustChanged: extra.stanceJustChanged,
    askForWant: shouldAskForWant(characterState?.replies ?? 0),
    role: { name: spec.role.name, position: spec.role.position, reputation: spec.role.reputation },
    scene: { timePlace: stage.timePlace, situation: state.stageOpening ?? stage.openingNarration, room: room?.name ?? 'here', othersPresent },
    mayShare: revealable.map((discovery) => discovery.text),
    notYet: heldBackTopics(spec, state, character.id, now),
    studentNotes: studentNoteTexts(spec, state),
    memory,
    handingOver: extra.handingOver.map((documentId) => lookup.document(spec, documentId).title),
    transcript,
    turn,
    readingLevel: spec.readingLevel,
  }
}

/**
 * The character answers. `playerMessageId` is the student's line, already in the transcript. The pending check
 * snapshots what was revealable when the reply was written, so a later change can't widen what it may confirm.
 */
export async function reply(
  ctx: StepContext,
  character: SpecCharacter,
  playerMessageId: string,
  turn: StudentTurn,
  extra: { stanceJustChanged: boolean; handingOver: string[] } = { stanceJustChanged: false, handingOver: [] },
): Promise<void> {
  const revealable = revealableFor(ctx.spec, ctx.state, character.id, ctx.now)
  const input = personaInput(ctx, character, turn, revealable, extra)
  const result = await replyAsCharacter(ctx.llm, input)
  ctx.say('character', result.reply, { characterId: character.id })
  const characterState = ctx.state.characters[character.id]
  if (characterState !== undefined) characterState.replies += 1
  ctx.state.pendingChecks.push({
    messageId: playerMessageId,
    characterId: character.id,
    stageIndex: ctx.state.stageIndex,
    revealable: revealable.map((discovery) => ({ id: discovery.id, text: discovery.text })),
    studentNotes: [...input.studentNotes],
    turn,
    reply: result.reply,
  })
}
