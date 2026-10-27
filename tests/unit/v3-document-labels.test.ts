import { describe, expect, it } from 'vitest';
import { documentDisplayTitle, documentMapLabel } from '@/lib/play/v3/document-labels';

describe('document presentation labels', () => {
  it('keeps in-world labels short without displaying editorial source instructions', () => {
    expect(documentMapLabel('2007 MOE release describing Lim’s letter, not the letter’s text')).toBe('2007 MOE release');
    expect(documentMapLabel('Later source-pack reading: a rice purchasing card')).toBe('A rice purchasing card');
    expect(documentMapLabel('School adaptation of occupation print; original issue unverified')).toBe('Occupation print');
    expect(documentMapLabel('Illustrative collection-note draft about a plan')).toBe('Collection-note draft');
    expect(documentMapLabel('Practice editorial: what belongs in a report?')).toBe('Editorial');
  });
  it('bounds unfamiliar long titles while retaining short titles', () => {
    expect(documentMapLabel('A letter')).toBe('A letter');
    expect(documentMapLabel('A very lengthy catalogue description with a large amount of detail').length).toBeLessThanOrEqual(28);
    expect(documentMapLabel('Anextremelylongunbrokentitlethatcannotfit').length).toBeLessThanOrEqual(28);
  });
  it('removes the later-source hint while retaining the reader’s full descriptive title', () => {
    expect(documentDisplayTitle('Later source-pack reading: a rice purchasing card')).toBe('A rice purchasing card');
    expect(documentDisplayTitle('2007 MOE release describing Lim’s letter, not the letter’s text')).toBe('2007 MOE release describing Lim’s letter, not the letter’s text');
  });
});
