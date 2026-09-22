import type { StageLayoutInput } from '../src/types.js'

export const settlementFixture: StageLayoutInput = {
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
}
