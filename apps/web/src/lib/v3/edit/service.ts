import { z } from 'zod';
import { validateSpec, type AdventureSpec, type CheckIssue } from '@adventure/spec-v3';
import { canStaffAdventure } from '@/lib/play/v3/access';
import type { V3PlayStore } from '@/lib/play/v3/store';
import { stancePortraitRequests } from '@/lib/v3/portraits/generate';
import { applyV3Edits, V3Edit, type CapturedSource } from './commands';
import { validateEditedSpec } from './validation';

export type SaveV3Result =
  | { ok: true; version: number; spec: AdventureSpec; errors: CheckIssue[]; warnings: CheckIssue[] }
  | { ok: false; code: 'conflict' | 'access' | 'invalid-edit'; message: string };
export interface V3EditDeps {
  store: V3PlayStore;
  sources(id: string): Promise<CapturedSource[]>;
  env?: NodeJS.ProcessEnv;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Mark changed prose at its nearest stable entity, preserving unchanged evidence. */
export function deriveAttribution(base: AdventureSpec, edited: AdventureSpec): void {
  const contributions = [...(base.authoring?.teacherContributions ?? [])];
  const walk = (old: unknown, next: unknown, entity: string, field: string) => {
    if (!next || typeof next !== 'object') return;
    if (Array.isArray(next)) {
      next.forEach((item, i) => {
        if (typeof item === 'string' && (!Array.isArray(old) || item !== old[i])) {
          const local = `${field}.${i}`;
          if (!contributions.some(c => c.entity === entity && c.field === local)) contributions.push({ entity, field: local });
        }
        const id = item && typeof item === 'object' && 'id' in item ? String(item.id) : undefined;
        const prior = Array.isArray(old) ? (id ? old.find(x => x?.id === id) : old[i]) : undefined;
        walk(prior, item, entity, `${field}.${i}`);
      });
      return;
    }
    const obj = next as Record<string, unknown>;
    const prior = old && typeof old === 'object' ? old as Record<string, unknown> : {};
    if (typeof obj.id === 'string') { entity = obj.id; field = ''; }
    let changedProse = false;
    const technical = new Set(['id', 'sourceLabel', 'citations', 'authoring', 'kind', 'type', 'effect', 'tier', 'readingLevel']);
    for (const [key, value] of Object.entries(obj)) {
      if (technical.has(key)) continue;
      const local = field ? `${field}.${key}` : key;
      if (typeof value === 'string' && !key.endsWith('Id') && !same(prior[key], value)) {
        changedProse = true;
        if (!contributions.some(c => c.entity === entity && c.field === local)) contributions.push({ entity, field: local });
      }
      if (typeof value === 'object') walk(prior[key], value, entity, local);
    }
    if ('sourceLabel' in obj && !changedProse && !same(obj.sourceLabel, prior.sourceLabel) && !('body' in obj)) throw Error('Source labels are server managed');
    if (changedProse) {
      if ('sourceLabel' in obj) obj.sourceLabel = obj.real === false && 'body' in obj ? 'invented' : 'from the teacher';
      if ('citations' in obj && obj.real !== true) obj.citations = [];
    }
    // Citation editing cannot attach old evidence to new prose or fabricate provenance.
    if ('citations' in obj && !same(obj.citations, prior.citations) && !changedProse && !('body' in obj)) throw Error('Citations are server managed');
  };
  walk(base, edited, base.id, '');
  (edited.authoring ??= {}).teacherContributions = contributions;
}

export async function saveAdventureEdits(deps: V3EditDeps, userId: string, id: string, expectedVersion: number, rawEdits: unknown): Promise<SaveV3Result> {
  const adventure = await deps.store.loadAdventure(id);
  if (!adventure || !(await canStaffAdventure(deps.store, adventure, userId, deps.env)) || !['draft', 'published', 'archived'].includes(adventure.status)) return { ok: false, code: 'access', message: 'Not found.' };
  if (adventure.specVersion !== expectedVersion) return { ok: false, code: 'conflict', message: 'This adventure changed. Your local edits are still here. Reload to use the saved version.' };
  const commands = z.array(V3Edit).max(2000).safeParse(rawEdits);
  const parsed = validateSpec(adventure.spec);
  if (!commands.success || !parsed.ok) return { ok: false, code: 'invalid-edit', message: 'Invalid editing commands or stored adventure.' };
  const sources = await deps.sources(id);
  let spec: AdventureSpec;
  try {
    spec = applyV3Edits(parsed.spec, commands.data, sources);
    if (!same(spec, parsed.spec)) {
      deriveAttribution(parsed.spec, spec);
      // Source replacements have authoritative provenance, irrespective of attribution.
      for (const command of commands.data) if (command.type === 'replaceExcerpt') {
        const doc = spec.documents.find(d => d.id === command.documentId)!;
        const source = sources.find(s => s.id === command.sourceId)!;
        doc.sourceLabel = source.title; doc.citations = [{ sourceId: source.id, quote: doc.body }];
      }
      const oldPortraits = new Map(stancePortraitRequests(parsed.spec).map(p => [p.portraitKey, p.prompt]));
      const versions = Object.fromEntries(stancePortraitRequests(spec).map(p => [p.portraitKey,
        oldPortraits.get(p.portraitKey) === p.prompt ? (parsed.spec.authoring?.portraitVersions ? parsed.spec.authoring.portraitVersions[p.portraitKey] ?? null : adventure.specVersion) : null]));
      (spec.authoring ??= {}).portraitVersions = versions;
    }
  } catch (error) {
    return { ok: false, code: 'invalid-edit', message: error instanceof z.ZodError ? 'The edits must have a valid structure. Check the highlighted fields.' : error instanceof Error ? error.message : 'Invalid edit.' };
  }
  const generationErrors = await deps.store.loadCheckErrors(id);
  const checks = validateEditedSpec(spec, sources, generationErrors);
  // An empty/no-op Save must not create metadata or a snapshot.
  if (!same(spec, parsed.spec)) (spec.authoring ??= {}).retainedErrors = checks.errors;
  const saved = await deps.store.saveDraft(id, expectedVersion, spec);
  if (!saved.saved) return { ok: false, code: 'conflict', message: 'This adventure changed while saving. Your local edits are still here. Reload to use the saved version.' };
  return { ok: true, spec, version: saved.version!, ...checks };
}
