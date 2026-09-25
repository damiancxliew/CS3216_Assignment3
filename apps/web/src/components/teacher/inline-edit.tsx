"use client";

import { useState } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { ActionForm } from "@/components/action-form";
import { Select } from "@/components/select";
import { button, Field } from "@/components/ui";

export type EditField = {
  name: string;
  label: string;
  defaultValue: string;
  multiline?: boolean;
  rows?: number;
  optional?: boolean;
  hint?: string;
  options?: readonly { value: string; label: string }[];
};

/**
 * A pencil that swaps the read-only dossier card for the matching form in
 * place. The pencil sits beside the content rather than over it, so a
 * one-line card (an objective, a position) is never covered. Published
 * versions render it disabled: frozen specs are refused server-side anyway
 * (P4), this just explains why upfront.
 */
export function InlineEdit({
  action,
  fields,
  label,
  buttonText,
  editable = true,
  hiddenInputs,
  children,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  fields: EditField[];
  /** Accessible name for the pencil, e.g. "Edit stage 1". */
  label: string;
  buttonText?: string;
  editable?: boolean;
  /** Static form values the action needs but the teacher doesn't edit (e.g. option ids). */
  hiddenInputs?: Record<string, string[]>;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <ActionForm action={action} submitLabel="Save" pendingLabel="Saving…">
          {Object.entries(hiddenInputs ?? {}).flatMap(([name, values]) =>
            values.map((value, i) => <input key={`${name}-${i}`} type="hidden" name={name} value={value} />),
          )}
          {fields.map((field) => field.options ? (
            <label key={field.name} className="flex flex-col gap-1 text-sm font-semibold text-ink">
              {field.label}
              <Select name={field.name} label={field.label} defaultValue={field.defaultValue} options={field.options} />
              {field.hint ? <span className="text-sm font-normal text-muted">{field.hint}</span> : null}
            </label>
          ) : (
            <Field
              key={field.name}
              name={field.name}
              label={field.label}
              defaultValue={field.defaultValue}
              multiline={field.multiline}
              rows={field.rows}
              optional={field.optional}
              hint={field.hint}
            />
          ))}
          <button type="button" onClick={() => setEditing(false)} className={`${button.subtle} w-fit`}>
            Cancel
          </button>
        </ActionForm>
      </div>
    );
  }

  return (
    <div className="flex w-full items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      <button
        type="button"
        aria-label={label}
        title={editable ? label : `Published and frozen — choose “Create a new version”`}
        disabled={!editable}
        onClick={() => setEditing(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line bg-surface p-1.5 text-sm text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M17 3a2.8 2.8 0 1 1 4 4L8 20l-5 1 1-5Z" />
        </svg>
        {buttonText}
      </button>
    </div>
  );
}
