"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownUp, Download, Upload, History, Copy, ExternalLink } from "lucide-react";
import { compactButton as button } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { updateAdventureFromZip } from "@/app/v3/teacher/import-actions";
import { getV3SavedVersions } from "@/app/v3/teacher/[id]/version-actions";
import { publishSavedV3Version } from "@/app/v3/teacher/[id]/publish-actions";

export function AdventureTransfer({ adventureId, version, publishedVersion, disabled = false }: {
  adventureId: string; version: number; publishedVersion: number | null; disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => dialog.current?.showModal()} className={button.quiet}><ArrowDownUp className="size-4" aria-hidden />Import / export</button>
      <dialog ref={dialog} aria-label="Import and export" className="fixed inset-0 m-auto max-h-[90dvh] w-[min(28rem,calc(100vw-2rem))] space-y-5 overflow-y-auto rounded-surface border-2 border-ink bg-surface p-6 text-ink shadow-xl backdrop:bg-ink/40">
        <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-extrabold">Import / export</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="Close import and export" className={button.quiet}>Close</button></div>
        <section className="space-y-3 border-b border-line pb-5">
          <h3 className="flex items-center gap-2 font-bold"><Download className="size-4" aria-hidden />Export version {version}</h3>
          <div className="grid grid-cols-2 gap-3">
            <a href={`/api/v3/adventures/${adventureId}/export?format=zip`} download className={`${button.quiet} justify-center`}>Download ZIP</a>
            <a href={`/api/v3/adventures/${adventureId}/export`} download className={`${button.quiet} justify-center`}>Download JSON</a>
          </div>
          <p className="text-xs text-muted">ZIP includes images and sprites. JSON keeps their links.</p>
        </section>
        <div>
          <h3 className="flex items-center gap-2 font-bold"><Upload className="size-4" aria-hidden />Import version {version + 1}</h3>
          <p className="mt-2 text-sm text-muted">Earlier versions and student attempts are kept. {publishedVersion ? `Version ${publishedVersion} stays live.` : "The new version stays unpublished."}</p>
        </div>
        <ActionForm action={updateAdventureFromZip.bind(null, adventureId, version, publishedVersion)} submitLabel="Import as new version" pendingLabel="Importing…">
          <label className="flex flex-col gap-2 text-sm font-bold">Adventure ZIP
            <input type="file" name="file" accept=".zip,application/zip" required className="w-full rounded-control border border-line p-2 font-normal" />
          </label>
          <p className="text-xs text-muted">15 MB max, including images and sprites.</p>
        </ActionForm>
      </dialog>
    </>
  );
}

export function AdventureVersions({ adventureId }: { adventureId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const query = useSearchParams();
  const imported = query.get("importedVersion");
  type VersionData = Extract<Awaited<ReturnType<typeof getV3SavedVersions>>, { ok: true }>;
  const [data, setData] = useState<VersionData | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!dialog.current?.open) dialog.current?.showModal();
    setLoading(true); setMessage(""); setFailure(false);
    try {
      const result = await getV3SavedVersions(adventureId);
      if (!result.ok) { setFailure(true); setMessage(result.message); return; }
      setData(result); setSelected(result.latest);
    } catch { setFailure(true); setMessage("Could not load versions. Close this dialog and try again."); }
    finally { setLoading(false); }
  }, [adventureId]);
  useEffect(() => { if (imported) void load(); }, [imported, load]);
  const publish = (version: number) => {
    if (!data) return;
    setSelected(version); setMessage(""); setFailure(false);
    startTransition(async () => {
      try {
        const result = await publishSavedV3Version(adventureId, version, { version: data.latest, publishedVersion: data.publishedVersion });
        if (!result.ok) { setFailure(true); setMessage(result.message); return; }
        const refreshed = await getV3SavedVersions(adventureId);
        if (refreshed.ok) setData(refreshed);
        setMessage(`Version ${version} is live.`);
        router.refresh();
      } catch { setFailure(true); setMessage("Could not publish this version. Try again."); }
    });
  };
  const copy = async (version: number, linkKey: string) => {
    const url = new URL(`/v3/join/${encodeURIComponent(adventureId)}?release=${encodeURIComponent(linkKey)}`, window.location.origin).href;
    try { await navigator.clipboard.writeText(url); setCopied(version); }
    catch { setMessage(`Copy this link: ${url}`); setFailure(false); }
  };
  const live = data?.published ? data.publishedVersion : null;
  return (
    <>
      <button type="button" onClick={load} className="inline-flex items-center gap-1.5 text-muted underline underline-offset-4 hover:text-ink"><History className="size-4" aria-hidden />Versions</button>
      <dialog ref={dialog} aria-labelledby={`versions-title-${adventureId}`} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(52rem,calc(100vw-2rem))] overflow-y-auto rounded-surface border-2 border-ink bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/40 sm:p-6">
        <header className="flex items-start justify-between gap-5 border-b border-line pb-4">
          <h2 id={`versions-title-${adventureId}`} className="text-2xl font-extrabold">Adventure versions</h2>
          <button type="button" onClick={() => dialog.current?.close()} className={button.quiet} aria-label="Close versions">Close</button>
        </header>
        {loading ? <p role="status" className="py-8 text-sm text-muted">Loading saved versions…</p> : data ? (
          <div className="space-y-4 pt-4">
            {!live ? <p className="text-sm text-muted">Unpublished</p> : null}
            {imported && !message ? <p className="text-sm text-world">Version {imported} imported.</p> : null}
            <ul className="space-y-3" aria-label="Saved versions">
              {data.versions.map((row) => (
                <li key={row.version} className={`rounded-surface border bg-surface p-4 ${selected === row.version ? "border-ink ring-1 ring-ink" : "border-line"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button type="button" onClick={() => setSelected(row.version)} aria-pressed={selected === row.version} aria-label={`Select version ${row.version}`} className="min-w-0 text-left">
                      <span className="flex flex-wrap items-center gap-2"><span className="font-extrabold">Version {row.version}</span>{live === row.version ? <span className="rounded-full bg-world-wash px-2 py-0.5 text-xs font-bold text-world">Live</span> : null}{data.latest === row.version ? <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-bold text-muted">Latest</span> : null}</span>
                      <span className="mt-1 block font-semibold">{row.title}</span>
                      <time dateTime={row.createdAt} title={new Date(row.createdAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} className="mt-1 block text-xs text-muted">{new Date(row.createdAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                    </button>
                    {live !== row.version ? <button type="button" disabled={pending} onClick={() => publish(row.version)} className={button.primary}>{pending && selected === row.version ? "Publishing…" : `Publish v${row.version}`}</button> : null}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-3 text-sm">
                    <button type="button" disabled={!row.linkKey} title={!row.linkKey ? "Publish this version to create its student link." : undefined} onClick={() => row.linkKey && copy(row.version, row.linkKey)} className="inline-flex items-center gap-1.5 font-semibold text-muted hover:text-ink disabled:opacity-50"><Copy className="size-4" aria-hidden />{copied === row.version ? "Copied" : "Copy link"}</button>
                    <Link href={`/v3/teacher/${adventureId}/summary?version=${row.version}`} className="inline-flex items-center gap-1.5 font-semibold text-muted underline underline-offset-4 hover:text-ink"><ExternalLink className="size-4" aria-hidden />View attempts ({row.attempts})</Link>
                  </div>
                </li>
              ))}
            </ul>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <Link href={`/v3/teacher/${adventureId}/links`} className="text-sm text-muted underline underline-offset-4">Publication history</Link>
            </footer>
          </div>
        ) : null}
        {message ? <p role={failure ? "alert" : "status"} className={`mt-4 rounded-control px-3 py-2 text-sm ${failure ? "bg-danger-wash text-danger" : "bg-world-wash text-world"}`}>{message}</p> : null}
      </dialog>
    </>
  );
}
