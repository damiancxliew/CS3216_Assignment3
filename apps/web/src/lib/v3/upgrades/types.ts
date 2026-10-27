import type { CheckIssue } from "@adventure/spec-v3";
export type UpgradeStatus = 'running' | 'blocked' | 'ready' | 'applied' | 'discarded' | 'failed' | 'stale';
export interface UpgradeRun {
    id: string;
    adventureId: string;
    requesterId: string;
    schoolId: string;
    sourceRevision: number;
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    proposalRevision: number;
    status: UpgradeStatus;
    candidate: unknown | null;
    migrationState?: unknown;
    findings: CheckIssue[];
    summary: {
        documents: number;
        stages: number;
        changes: string[];
    };
    progress: {
        completed: number;
        total: number;
        label: string;
        stepId?: string;
    };
    appliedRevision: number | null;
    error: string | null;
    instruction: string;
    createdAt: string;
}
export type UpgradeResult = {
    ok: true;
    run: UpgradeRun;
} | {
    ok: false;
    code: 'access' | 'conflict' | 'invalid' | 'unsupported';
    message: string;
};
export type UpgradeStartInput = {
    expectedRevision: number;
    targetSchemaVersion?: number;
};
export type UpgradeProposalInput = {
    runId: string;
    proposalRevision: number;
};
export type UpgradeRefineInput = UpgradeProposalInput & {
    instruction: string;
};
export type RunPatch = Partial<Pick<UpgradeRun, 'status' | 'candidate' | 'findings' | 'summary' | 'progress' | 'error' | 'instruction' | 'proposalRevision' | 'migrationState'>>;
