"use client";

import { ActionForm } from "@/components/action-form";
import { importAdventureJson } from "./import-actions";

export function ImportAdventureJson() {
  return (
    <details className="rounded-surface border border-line bg-surface p-4">
      <summary className="cursor-pointer font-bold">Import JSON</summary>
      <p id="import-json-help" className="my-3 text-sm text-muted">Import a v3 adventure as a new draft. Choose an exported JSON file or a raw game spec, up to 10 MB. Image links must remain available.</p>
      <ActionForm action={importAdventureJson} submitLabel="Import adventure" pendingLabel="Importing…">
        <label className="flex flex-col gap-2 text-sm font-bold">
          Adventure JSON
          <input type="file" name="file" accept=".json,application/json" required aria-describedby="import-json-help" className="max-w-full rounded-control border border-line p-2 font-normal" />
        </label>
      </ActionForm>
    </details>
  );
}
