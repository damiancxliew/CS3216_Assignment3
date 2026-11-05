"use client";
import { useEffect, useRef, useState } from "react";
import { decodeStoredSpec, type AdventureSpec } from "@adventure/spec-v3";
import type { UpgradeRun, UpgradeResult, UpgradeStartInput, UpgradeProposalInput, UpgradeRefineInput } from "@/lib/v3/upgrades/types";
import { useReviewChat } from "./review-chat-context";

export type UpgradeActions = {
  get(adventureId: string, runId?: string): Promise<UpgradeResult | null>;
  start(adventureId: string, input: UpgradeStartInput): Promise<UpgradeResult>;
  refine(adventureId: string, input: UpgradeRefineInput): Promise<UpgradeResult>;
  apply(adventureId: string, input: UpgradeProposalInput): Promise<UpgradeResult>;
  discard(adventureId: string, input: UpgradeProposalInput): Promise<UpgradeResult>;
};
export function useUpgradeWorkflow({ adventureId, revision, dirty, disabled, actions, onApplied, enabled }: {
  adventureId: string; revision: number; dirty: boolean; disabled: boolean; actions: UpgradeActions;
  enabled: boolean;
  onApplied(spec: AdventureSpec, revision: number): void;
}) {
  const [run, setRun] = useState<UpgradeRun | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const sequence = useRef(0);
  const context = useReviewChat();
  const register = context?.registerUpgrade;
  useEffect(() => {
    if (!enabled) return;
    const request = ++sequence.current;
    let cancelled = false;
    setLoading(true);
    actions.get(adventureId).then((result) => {
      if (cancelled || request !== sequence.current) return;
      if (result?.ok) {
        setRun(result.run);
        if (!['applied', 'discarded'].includes(result.run.status)) setOpen(true);
      } else if (result) setMessage(result.message);
      else setRun(null);
    }).catch(() => {
      if (!cancelled && request === sequence.current) setMessage('Could not load the upgrade. Refresh to retry.');
    }).finally(() => { if (!cancelled && request === sequence.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [actions, adventureId, revision, enabled]);
  useEffect(() => {
    if (!run || run.status !== 'running' || pending) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void actions.get(adventureId, run.id).then((result) => {
        if (!cancelled && result?.ok) setRun(result.run);
      }).catch(() => { if (!cancelled) setMessage('Progress could not refresh. The proposal is saved.'); });
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [run, actions, adventureId, pending]);
  const stale = Boolean(run && run.sourceRevision !== revision && run.status !== 'applied');
  const busy = pending || disabled || loading || run?.status === 'running';
  const perform = async (operation: () => Promise<UpgradeResult>) => {
    if (pending || disabled || dirty) return 'Save your edits first.';
    ++sequence.current;
    setPending(true);
    setMessage('');
    try {
      const result = await operation();
      if (!result.ok) { setMessage(result.message); return result.message; }
      setRun(result.run);
      if (result.run.status === 'applied' && result.run.appliedRevision !== null) {
        const decoded = decodeStoredSpec(result.run.candidate);
        if (decoded.ok) onApplied(decoded.spec, result.run.appliedRevision);
        setMessage('Draft saved. Preview it before publishing.');
      }
      return result.run.status === 'ready' ? 'Ready to review.' : 'Progress saved.';
    } catch {
      const error = 'Could not confirm the change. Refresh to check before retrying.';
      setMessage(error);
      return error;
    } finally { setPending(false); setLoading(false); }
  };
  const routeRef = useRef<(instruction: string) => Promise<string>>(async () => '');
  routeRef.current = async (instruction) => {
    setOpen(true);
    if (dirty) return 'Save your edits first.';
    if (!run || ['applied', 'discarded'].includes(run.status)) return 'Choose Prepare upgrade to get a proposal. Review it before applying.';
    if (stale || run.status === 'stale') return 'Draft changed. Rebuild the proposal.';
    return perform(() => actions.refine(adventureId, { runId: run.id, proposalRevision: run.proposalRevision, instruction }));
  };
  const chatActive = open && Boolean(run && !['applied', 'discarded', 'stale'].includes(run.status));
  useEffect(() => {
    if (!register || !enabled) return;
    register({ key: `upgrade:${adventureId}`, active: chatActive, pending: busy || dirty, route: (instruction) => routeRef.current(instruction) });
    return () => register(null);
  }, [register, adventureId, chatActive, busy, dirty, enabled]);
  return { run, open, setOpen, pending, busy, loading, message, stale,
    start: () => perform(() => actions.start(adventureId, { expectedRevision: revision })),
    retry: () => run && perform(() => actions.refine(adventureId, { runId: run.id, proposalRevision: run.proposalRevision, instruction: '' })),
    apply: () => run && perform(() => actions.apply(adventureId, { runId: run.id, proposalRevision: run.proposalRevision })),
    discard: () => run && perform(() => actions.discard(adventureId, { runId: run.id, proposalRevision: run.proposalRevision })),
  };
}
