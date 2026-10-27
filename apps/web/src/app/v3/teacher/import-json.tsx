"use client";

import { ActionForm } from "@/components/action-form";
import { importAdventureJson } from "./import-actions";

export function ImportAdventureJson() {
  return (
    <details className="rounded-surface border border-line bg-surface p-4">
      <summary className="cursor-pointer font-bold">Import adventure</summary>
      <p id="import-json-help" className="my-3 text-sm text-muted">Create a new draft from a ZIP with its images and custom sprites (up to 15 MB), or JSON with image links (up to 10 MB).</p>
      <ActionForm action={importAdventureJson} submitLabel="Import adventure" pendingLabel="Importing…">
        <label className="flex flex-col gap-2 text-sm font-bold">
          ZIP or JSON file
          <input type="file" name="file" accept=".zip,.json,application/zip,application/json" required aria-describedby="import-json-help" className="max-w-full rounded-control border border-line p-2 font-normal" />
        </label>
      </ActionForm>
    </details>
  );
}
