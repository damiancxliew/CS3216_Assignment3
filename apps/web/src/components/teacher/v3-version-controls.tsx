"use client";

import { useRef } from "react";
import { ArrowDownUp, Download, Upload } from "lucide-react";
import { compactButton as button } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { updateAdventureFromFile } from "@/app/v3/teacher/import-actions";

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
        <ActionForm action={updateAdventureFromFile.bind(null, adventureId, version, publishedVersion)} submitLabel="Import as new version" pendingLabel="Importing…">
          <label className="flex flex-col gap-2 text-sm font-bold">Adventure ZIP or JSON
            <input type="file" name="file" accept=".zip,.json,application/zip,application/json" required className="w-full rounded-control border border-line p-2 font-normal" />
          </label>
          <p className="text-xs text-muted">ZIP: 15 MB max, including images and sprites. JSON: 10 MB max, keeping media links.</p>
        </ActionForm>
      </dialog>
    </>
  );
}
