import { expect, it } from 'vitest';
import { UPGRADE_REGISTRY } from '@adventure/spec-v3';
import { UPGRADE_IMPLEMENTATIONS } from '@/lib/v3/upgrades/migrate';

it('provides an executable migration and preservation policy for every upgrade exposed to teachers', () => {
  expect(Object.keys(UPGRADE_IMPLEMENTATIONS).sort()).toEqual(UPGRADE_REGISTRY.map(step => step.id).sort());
  for (const step of UPGRADE_REGISTRY) {
    const implementation = UPGRADE_IMPLEMENTATIONS[step.id];
    expect(implementation, `Missing implementation for ${step.id}`).toBeDefined();
    expect(implementation!.kind).toBe(step.kind);
    expect(implementation!.tasks).toBeTypeOf('function');
    expect(implementation!.preserves).toBeTypeOf('function');
    expect(implementation!.finish).toBeTypeOf('function');
  }
});
