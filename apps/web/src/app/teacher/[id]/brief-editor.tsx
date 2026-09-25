"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Field, READING_BAND_LABELS, control } from "@/components/ui";
import type { ReadingLevel, StageOutline } from "@/lib/brief/schema";
import { updateBrief } from "../actions";

export function BriefEditor({ adventureId, brief }: {
  adventureId: string;
  brief: {
    title: string;
    setting: string;
    studentRole: string;
    learningObjectives: string[];
    readingLevel: ReadingLevel;
    stageOutline: StageOutline[];
  };
}) {
  const [stageCount, setStageCount] = useState(brief.stageOutline.length || 1);

  return (
    <details className="rounded-surface border border-line bg-surface px-4 py-3 sm:px-5">
      <summary className="cursor-pointer font-semibold text-ink">Edit brief for the next version</summary>
      <p className="mt-3 max-w-[60ch] text-base text-muted">Save your changes before generating. Published versions and student attempts keep their existing story.</p>
      <ActionForm action={updateBrief.bind(null, adventureId)} submitLabel="Save brief" pendingLabel="Saving…" className="mt-5 flex max-w-2xl flex-col gap-4">
        <Field name="title" label="Title" defaultValue={brief.title} />
        <Field name="setting" label="Setting" defaultValue={brief.setting} />
        <Field name="student_role" label="Student plays" defaultValue={brief.studentRole} />
        <Field name="learning_objectives" label="Objectives" hint="One objective per line, up to six." defaultValue={brief.learningObjectives.join("\n")} multiline rows={4} />
        <label className="flex flex-col gap-1.5">
          <span className="text-base font-semibold text-ink">Reading level</span>
          <select name="band" defaultValue={brief.readingLevel.band} className={control}>
            {Object.entries(READING_BAND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="age_min" label="Youngest age" type="number" min={7} defaultValue={String(brief.readingLevel.ageMin)} />
          <Field name="age_max" label="Oldest age" type="number" min={7} defaultValue={String(brief.readingLevel.ageMax)} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-base font-semibold text-ink">Number of stages</span>
          <select name="stage_count" value={stageCount} onChange={(event) => setStageCount(Number(event.target.value))} className={control}>
            {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        {[0, 1, 2].map((index) => (
          <fieldset key={index} className={`${index >= stageCount ? "hidden" : "flex"} flex-col gap-3 rounded-surface border border-line p-4`}>
            <legend className="px-1 font-semibold text-ink">Stage {index + 1}</legend>
            <Field name={`stage_${index}_title`} label="Title" defaultValue={brief.stageOutline[index]?.title ?? ""} />
            <Field name={`stage_${index}_focus`} label="Situation and decision" defaultValue={brief.stageOutline[index]?.focus ?? ""} multiline rows={3} />
          </fieldset>
        ))}
      </ActionForm>
    </details>
  );
}
