import {
  validateSkeleton,
  validateSpec,
  type AdventureSpec,
} from "@adventure/spec-v3";
import type { JobStep } from "@adventure/jobs";
import type { ExtractedDocument } from "@adventure/generation";
import { V3Edit } from "@/lib/v3/edit/commands";
import { applyTeacherEdits, capturedSources } from "@/lib/v3/edit/apply";
import type { GuidedPass } from "@/lib/v3/generation/service";

const names: Record<GuidedPass, string> = {
  sources: "Sources",
  skeleton: "Adventure plan",
  details: "Stages, characters and documents",
  endings: "Decisions and endings",
  reveal: "Reveal and questions",
};
const order: GuidedPass[] = [
  "sources",
  "skeleton",
  "details",
  "endings",
  "reveal",
];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Completed content remains available while subsequent passes run. */
export function GenerationHistory({
  steps,
  documents,
  current,
  finalSpec,
}: {
  steps: JobStep[];
  documents: ExtractedDocument[];
  current?: GuidedPass;
  finalSpec?: AdventureSpec;
}) {
  return (
    <div className="space-y-3" aria-label="Generated so far">
      {order
        .filter(
          (pass) =>
            pass !== current &&
            steps.some(
              (step) => step.name === pass && step.status === "succeeded",
            ),
        )
        .map((pass) => {
          if (pass === "sources")
            return (
              <HistoryCard
                key={pass}
                title={names[pass]}
                detail={`${documents.length} included`}
              >
                <ul className="space-y-1">
                  {documents.map((doc) => (
                    <li key={doc.id}>{doc.title}</li>
                  ))}
                </ul>
              </HistoryCard>
            );
          const output = record(
            steps.find((step) => step.name === pass)?.output,
          );
          if (pass === "skeleton") {
            const approved = record(
              steps.find((step) => step.name === "details")?.input,
            ).skeleton;
            const parsed = validateSkeleton(approved ?? output.skeleton);
            if (!parsed.ok) return null;
            return (
              <HistoryCard
                key={pass}
                title={names[pass]}
                detail={parsed.spec.title}
              >
                <p className="mb-3">{parsed.spec.arc}</p>
                <ol className="list-decimal space-y-2 pl-5">
                  {parsed.spec.stages.map((stage) => (
                    <li key={stage.id}>
                      <span className="font-semibold">{stage.title}</span>
                      <p>{stage.centralQuestion}</p>
                    </li>
                  ))}
                </ol>
              </HistoryCard>
            );
          }
          const parsed = validateSpec(
            pass === "details" ? output.draft : output.spec,
          );
          if (!parsed.ok) return null;
          const next =
            pass === "details"
              ? "endings"
              : pass === "endings"
                ? "reveal"
                : "check";
          const edits = record(
            record(steps.find((step) => step.name === next)?.input)
              .teacherEdits,
          )[pass];
          const spec =
            finalSpec ??
            (Array.isArray(edits)
              ? applyTeacherEdits(
                  parsed.spec,
                  edits.map((edit) => V3Edit.parse(edit)),
                  capturedSources(documents),
                )
              : parsed.spec);
          return (
            <HistoryCard
              key={pass}
              title={names[pass]}
              detail={
                pass === "details"
                  ? `${spec.stages.length} stages · ${spec.characters.length} characters · ${spec.documents.length} documents`
                  : pass === "endings"
                    ? `${spec.endings.length} endings`
                    : `${spec.teacherQuestions.length} teacher questions`
              }
            >
              {pass === "details" ? (
                <div className="space-y-4">
                  {spec.stages.map((stage) => (
                    <section key={stage.id}>
                      <h3 className="font-semibold">{stage.title}</h3>
                      <p>{stage.openingNarration}</p>
                    </section>
                  ))}
                  <h3 className="font-semibold">Characters</h3>
                  {spec.characters.map((character) => (
                    <p key={character.id}>
                      <strong>{character.name}</strong> ·{" "}
                      {character.persona.publicPosition}
                    </p>
                  ))}
                  <h3 className="font-semibold">Documents</h3>
                  {spec.documents.map((doc) => (
                    <details key={doc.id}>
                      <summary className="cursor-pointer">{doc.title}</summary>
                      <p className="mt-2 whitespace-pre-wrap">{doc.body}</p>
                    </details>
                  ))}
                </div>
              ) : pass === "endings" ? (
                <div className="space-y-4">
                  {spec.endings.map((ending) => (
                    <section key={ending.id}>
                      <h3 className="font-semibold">{ending.title}</h3>
                      <p>{ending.summary}</p>
                      <p className="mt-2">{ending.epilogue}</p>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <p>{spec.reveal?.whatHappened}</p>
                  <ol className="list-decimal space-y-2 pl-5">
                    {spec.teacherQuestions.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ol>
                </div>
              )}
            </HistoryCard>
          );
        })}
    </div>
  );
}
function HistoryCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <details
      className="rounded-surface border border-line bg-surface p-4"
      data-generation-history-card
    >
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        {title}
        <span className="mt-1 block pl-4 text-xs font-normal text-muted">
          {detail}
        </span>
      </summary>
      <div className="mt-4 text-sm leading-relaxed">{children}</div>
    </details>
  );
}
