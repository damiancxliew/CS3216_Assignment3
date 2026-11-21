import { validateSkeleton, validateSpec } from "@adventure/spec-v3";
import type { JobStep } from "@adventure/jobs";
import type { ExtractedDocument } from "@adventure/generation";
import { V3Edit } from "@/lib/v3/edit/commands";
import { applyTeacherEdits, capturedSources } from "@/lib/v3/edit/apply";
import type { GuidedPass } from "@/lib/v3/generation/service";
import { GenerationSection } from "./generation-section";
import { OutlineSummary } from "./outline-summary";
import { PauseContentCards } from "./review/pause-content-cards";

const order = ["skeleton", "details", "endings", "reveal"] as const;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Completed passes stay on the page, read-only, with the same cards the
 * teacher reviewed them in, so approving a step doesn't reshape it.
 */
export function GenerationHistory({
  steps,
  documents,
  current,
  focus,
}: {
  steps: JobStep[];
  documents: ExtractedDocument[];
  current?: GuidedPass;
  /** The step that just finished without a pause: the teacher reads it next. */
  focus?: GuidedPass;
}) {
  const output = (name: string) => record(steps.find((step) => step.name === name)?.output);
  const input = (name: string) => record(steps.find((step) => step.name === name)?.input);
  const completed = order.filter((pass) => pass !== current &&
    steps.some((step) => step.name === pass && step.status === "succeeded"));
  return completed.map((pass) => {
    if (pass === "skeleton") {
      // The teacher's approved edits travel in the details step's input.
      const parsed = validateSkeleton(input("details").skeleton ?? output("skeleton").skeleton);
      return parsed.ok ? (
        <GenerationSection key={pass} pass={pass} current={pass === focus}>
          <OutlineSummary skeleton={parsed.spec} />
        </GenerationSection>
      ) : null;
    }
    const parsed = validateSpec(pass === "details" ? output(pass).draft : output(pass).spec);
    if (!parsed.ok) return null;
    const next = pass === "details" ? "endings" : pass === "endings" ? "reveal" : "check";
    const edits = record(input(next).teacherEdits)[pass];
    const spec = Array.isArray(edits)
      ? applyTeacherEdits(parsed.spec, edits.map((edit) => V3Edit.parse(edit)), capturedSources(documents))
      : parsed.spec;
    return (
      <GenerationSection key={pass} pass={pass} current={pass === focus}>
        <PauseContentCards pass={pass} draft={spec} sources={[]} />
      </GenerationSection>
    );
  });
}
