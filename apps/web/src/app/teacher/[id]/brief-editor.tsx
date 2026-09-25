"use client";

import { useState } from "react";

import { Field, READING_BAND_LABELS, control } from "@/components/ui";
import type { ReadingLevel, StageOutline } from "@/lib/brief/schema";
import { advanceGeneration, generateFromSources } from "../actions";
import { StoryGeneration, type GenerationJob } from "./story-generation";

export function BriefEditor({ adventureId, brief, hasVersions, initialJob, blockedReason }: {
  adventureId: string;
  hasVersions: boolean;
  initialJob: GenerationJob | null;
  blockedReason: string | null;
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
    <details className="rounded-surface border border-line bg-surface px-4 py-3 sm:px-5" open>
      <summary className="cursor-pointer font-semibold text-ink">Edit brief and generate {hasVersions ? "a new version" : "the adventure"}</summary>
      <p className="mt-3 max-w-[60ch] text-base text-muted">Published versions and student attempts keep their existing story.</p>
      {blockedReason ? <p className="mt-3 text-sm text-muted">{blockedReason}</p> : null}
      <div className="mt-5 max-w-2xl">
        <StoryGeneration
          adventureId={adventureId}
          action={generateFromSources.bind(null, adventureId)}
          advance={advanceGeneration.bind(null, adventureId)}
          label={hasVersions ? "Save brief and generate new version" : "Save brief and generate adventure"}
          initialJob={initialJob}
          disabled={Boolean(blockedReason)}
        >
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
        </StoryGeneration>
      </div>
    </details>
  );
}
