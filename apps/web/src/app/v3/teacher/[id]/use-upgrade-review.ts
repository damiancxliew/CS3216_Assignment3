"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdventureSpec } from '@adventure/spec-v3';
import type { UpgradeRun } from '@/lib/v3/upgrades/types';
import { upgradeReviewState } from './upgrade-presentation';

/** Browser-session review marks bind to the exact content, not just a row index. */
export function useUpgradeReview(run: UpgradeRun | null, source: AdventureSpec) {
  const review = useMemo(() => run ? upgradeReviewState(run, source) : null, [run, source]);
  const key = run ? `upgrade-review:${run.adventureId}:${run.id}:${run.sourceRevision}` : '';
  const [saved, setSaved] = useState<{ key: string; marks: Record<string, string> }>({ key: '', marks: {} });
  useEffect(() => {
    if (!key) return;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      const marks = value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([, fingerprint]) => typeof fingerprint === 'string'))
        : {};
      setSaved({ key, marks });
    } catch { setSaved({ key, marks: {} }); }
  }, [key]);
  const previous = useRef<{ key: string; content: Record<string, string> }>({ key: '', content: {} });
  const [latestPath, setLatestPath] = useState<string | null>(null);
  useEffect(() => {
    const before = previous.current.key === key ? previous.current.content : {};
    const completed = review?.sections.filter(section => section.status === 'done') ?? [];
    const changed = completed.filter(section => before[section.path] !== section.fingerprint);
    if (changed.length) setLatestPath(changed.at(-1)!.path);
    previous.current = { key, content: Object.fromEntries(completed.map(section => [section.path, section.fingerprint])) };
  }, [key, review]);
  const marks = saved.key === key ? saved.marks : {};
  const reviewed = new Set(review?.sections.filter(section => section.status === 'done' && marks[section.path] === section.fingerprint).map(section => section.path));
  const markReviewed = (path: string, checked: boolean) => {
    const section = review?.sections.find(section => section.path === path);
    if (!section || section.status !== 'done') return;
    const next = { ...marks };
    if (checked) next[path] = section.fingerprint;
    else delete next[path];
    setSaved({ key, marks: next });
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Review still works when browser storage is unavailable. */ }
  };
  return { review, reviewed, markReviewed, latestPath };
}
