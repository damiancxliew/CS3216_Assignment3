import type { StageLayoutInput } from '@adventure/game-core'

export const playgroundFixture = {
  stageId: 'harbor-settlement',
  spawnRoomId: 'meeting-hall',
  rooms: [
    { id: 'archive', size: 'small', doorDefault: 'closed' },
    { id: 'market', size: 'large', doorDefault: 'open' },
    { id: 'meeting-hall', size: 'medium', doorDefault: 'open' },
  ],
  placements: [
    { id: 'actor-elder', kind: 'actor', roomId: 'meeting-hall' },
    { id: 'actor-merchant', kind: 'actor', roomId: 'market' },
    { id: 'actor-scribe', kind: 'actor', roomId: 'archive' },
    { id: 'evidence-ledger', kind: 'evidence', roomId: 'archive' },
    { id: 'evidence-seal', kind: 'evidence', roomId: 'market' },
    { id: 'decision-treaty', kind: 'decision', roomId: 'meeting-hall' },
  ],
} satisfies StageLayoutInput

export const roomNames: Readonly<Record<string, string>> = {
  archive: 'Archive',
  market: 'Market',
  'meeting-hall': 'Council Hall',
}

export const actorNames: Readonly<Record<string, string>> = {
  player: 'You',
  'actor-elder': 'Elder',
  'actor-merchant': 'Merchant',
  'actor-scribe': 'Scribe',
}
