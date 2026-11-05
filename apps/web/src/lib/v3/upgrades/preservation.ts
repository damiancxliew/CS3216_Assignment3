import { isDeepStrictEqual } from 'node:util';
import type { AdventureSpec } from '@adventure/spec-v3';
import { preserveLegacyStageImages, portraitKeys } from '../media/resolvers';
/** Pin implicit legacy media before the new content revision changes URL resolution. */
export function preserveUpgradeMedia(spec: AdventureSpec, adventureId: string, revision: number) {
    const candidate = preserveLegacyStageImages(spec, adventureId, revision);
    const versions = ((candidate.authoring ??= {}).portraitVersions ??= {});
    for (const key of portraitKeys(candidate))
        if (!Object.hasOwn(versions, key))
            versions[key] = revision;
    return candidate;
}
/** Model output may add mechanics, never rewrite existing source/story/media. */
export function preservesUpgradeSource(source: AdventureSpec, candidate: AdventureSpec, id: string, revision: number): boolean {
    const expected = preserveUpgradeMedia(source, id, revision);
    const actual = structuredClone(candidate);
    delete expected.schemaVersion;
    delete actual.schemaVersion;
    expected.documents.forEach((d, i) => {
        if (!source.documents[i]!.readingCheck)
            delete actual.documents[i]?.readingCheck;
    });
    expected.stages.forEach((s, i) => {
        if (!source.stages[i]!.preparation)
            delete actual.stages[i]?.preparation;
    });
    return isDeepStrictEqual(expected, actual);
}
