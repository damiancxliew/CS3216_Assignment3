import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AdventureSpec } from '@adventure/spec-v3';
import { applyV3Edits } from '@/lib/v3/edit/commands';

it('requires the reviewed upgrade operation to change or remove schemaVersion', () => {
  const base = AdventureSpec.parse(JSON.parse(readFileSync('fixtures/golden-1819.json', 'utf8')));
  const legacy = { ...base, schemaVersion: 1 as const };
  expect(() => applyV3Edits(legacy, [{ type: 'set', path: ['schemaVersion'], value: 2 }])).toThrow(/protected|upgrade/i);
  expect(() => applyV3Edits(legacy, [{ type: 'remove', path: ['schemaVersion'] }])).toThrow(/protected|upgrade/i);
});
