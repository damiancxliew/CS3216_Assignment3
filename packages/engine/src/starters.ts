/**
 * Question starters for the talk box. Derived only from hint angles the author wrote to guide students
 * ("Ask X why …"), never from a discovery's own text, so a starter can point at a topic but not leak an answer.
 */
import { currentStage } from './context'
import type { EngineSpec } from './spec'
import type { EngineState } from './state'

const GENERIC_STARTERS = ['What worries you most right now?', 'What do you think will happen next?', 'Who else should I talk to?']
const MAX_STARTERS = 3
const MAX_LENGTH = 70

/** "Ask Percival why he is so sure of his plan." → "Why are you so sure of your plan?"; null when the hint isn't an askable shape. */
export function hintToStarter(hint: string, characterName: string): string | null {
  const text = hint.trim().replace(/[.!?]+$/, '')
  const names = [characterName, ...characterName.split(/\s+/).filter((part) => part.length > 2)]
  const lead = /^ask\s+/i.exec(text)
  if (lead === null) return null
  let rest = text.slice(lead[0].length)
  const name = names.find((candidate) => rest.toLowerCase().startsWith(`${candidate.toLowerCase()} `))
  if (name === undefined) return null
  rest = rest.slice(name.length + 1).trim()
  const match = /^(why|what|how|who|where|when|whether|about)\s+(.+)$/i.exec(rest)
  if (match === null) return null
  const word = match[1]!.toLowerCase()
  const body = match[2]!
  if (/["“”]|\b(?:the player|you)\b/i.test(body)) return null
  let question: string
  if (word === 'about') {
    if (/\b(?:he|she|they|his|her|their|him|them)\b/i.test(body)) return null
    question = `What can you tell me about ${body}?`
  } else {
    // Only "why he is …"-shaped hints convert cleanly; other clauses would need real grammar, so they are skipped.
    const clause = /^(?:he|she|they)\s+(is|are)\s+(.+)$/i.exec(body)
    if (clause === null || word === 'whether') return null
    const tail = clause[2]!.replace(/\b(?:his|her|their)\b/gi, 'your').replace(/\b(?:him|them)\b/gi, 'you')
    if (/\b(?:he|she|they|his|her|their)\b/i.test(tail)) return null
    question = `${word[0]!.toUpperCase()}${word.slice(1)} are you ${tail}?`
  }
  return question.length > MAX_LENGTH ? null : question
}

/** Up to three starters for one character: authored ask-hints for undiscovered things they hold, padded with generic ones. */
export function startersFor(ctx: { spec: EngineSpec; state: EngineState }, characterId: string): string[] {
  const { spec, state } = ctx
  const character = spec.characters.find((candidate) => candidate.id === characterId)
  if (character === undefined) return [...GENERIC_STARTERS]
  const stageId = currentStage(ctx).id
  const starters: string[] = []
  for (const angle of spec.hintAngles) {
    if (angle.kind !== 'ask' || state.discovered.includes(angle.discoveryId)) continue
    const discovery = spec.discoveries.find((candidate) => candidate.id === angle.discoveryId)
    if (discovery === undefined || discovery.stageId !== stageId || !('characterId' in discovery.holder) || discovery.holder.characterId !== characterId) continue
    const starter = hintToStarter(angle.text, character.name)
    if (starter !== null && !starters.includes(starter)) starters.push(starter)
  }
  const out = starters.slice(0, 2)
  // Generic fillers rotate by character so neighbours in a room don't all show the same chips.
  const offset = [...characterId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % GENERIC_STARTERS.length
  for (let i = 0; out.length < MAX_STARTERS && i < GENERIC_STARTERS.length; i += 1) out.push(GENERIC_STARTERS[(offset + i) % GENERIC_STARTERS.length]!)
  return out.slice(0, MAX_STARTERS)
}
