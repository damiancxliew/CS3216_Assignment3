"use client";
import { useEffect, useRef } from "react";
import { CheckCircle2, Clock3, LoaderCircle, TriangleAlert, CircleX } from "lucide-react";
import type {
  PreparationGroup,
  ReadingQuestion,
  SpecDocument,
} from "@adventure/spec-v3";
import type { UpgradeReviewState, UpgradeSectionStatus } from "./upgrade-presentation";

const statuses = {
  done: { icon: CheckCircle2, label: 'Done', tone: 'text-world' },
  working: { icon: LoaderCircle, label: 'Preparing', tone: 'text-record' },
  waiting: { icon: Clock3, label: 'Not started', tone: 'text-muted' },
  warning: { icon: TriangleAlert, label: 'Needs changes', tone: 'text-ink' },
  error: { icon: CircleX, label: 'Failed', tone: 'text-danger' },
};
function ReviewSection({ section, latest, reviewed, onReviewed, children }: {
  section: UpgradeReviewState['sections'][number]; latest: boolean; reviewed: boolean;
  onReviewed(path: string, checked: boolean): void; children: React.ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const status = statuses[section.status];
  const Icon = status.icon;
  useEffect(() => {
    if (latest && section.status === 'done' && !reviewed && details.current) details.current.open = true;
  }, [latest, section.status, section.fingerprint, reviewed]);
  return <details ref={details} className="rounded-control border border-line p-3" data-upgrade-section={section.path}>
    <summary className="cursor-pointer font-semibold">
      <span className="ml-1 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 align-middle">
        <span>{section.title}</span>
        <span className={`inline-flex items-center gap-1 text-xs ${status.tone}`}><Icon size={15} aria-hidden className={section.status === 'working' ? 'animate-spin motion-reduce:animate-none' : ''} />{status.label}</span>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-normal" onClick={event => event.stopPropagation()}>
          <input type="checkbox" aria-label={`Reviewed: ${section.title}`} checked={reviewed} disabled={section.status !== 'done'} onChange={event => {
            onReviewed(section.path, event.target.checked);
            if (event.target.checked && details.current) details.current.open = false;
          }} />Reviewed
        </label>
      </span>
    </summary>
    {children}
  </details>;
}
function PendingSection({ status, kind }: { status: UpgradeSectionStatus; kind: string }) {
  return <p className="mt-2 text-muted">{status === 'working' ? `Preparing ${kind}…` : status === 'error' ? 'Could not finish this section. Retry the upgrade to continue.' : status === 'warning' ? 'This section needs changes. See the findings above.' : 'Not started yet.'}</p>;
}

function QuestionReview({ document, question, label }: {
  document: SpecDocument;
  question: ReadingQuestion;
  label: string;
}) {
  return (
    <section className="space-y-2 border-t border-line pt-3">
      <h4 className="font-semibold">{label}: {question.prompt}</h4>
      <ul className="list-disc pl-5">
        {question.options.map((option) => (
          <li key={option.id}>
            {option.text}{option.id === question.correctOptionId ? " (correct)" : ""}
          </li>
        ))}
      </ul>
      {question.support.map((span, index) => (
        <blockquote key={index} className="border-l-2 border-line-strong pl-3 font-record">
          {document.body.slice(span.start, span.end)}
        </blockquote>
      ))}
      <p>{question.explanation}</p>
    </section>
  );
}

function PreparationGroups({ groups, discovery }: {
  groups: PreparationGroup[];
  discovery(id: string): string;
}) {
  if (!groups.length) return <p>No preparation needed.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {groups.map((group, index) => (
        <li key={index}>
          Learn {group.minMet} of: {group.discoveryIds.map(discovery).join("; ")}
        </li>
      ))}
    </ul>
  );
}

export function UpgradeReview({ review, reviewed, onReviewed, latestPath }: {
  review: UpgradeReviewState; reviewed: ReadonlySet<string>; latestPath: string | null;
  onReviewed(path: string, checked: boolean): void;
}) {
  const { spec, sections } = review;
  const discovery = (id: string) => spec.discoveries.find((item) => item.id === id)?.text ?? id;
  const character = (id: string) => spec.characters.find((item) => item.id === id)?.name ?? id;
  return (
    <div className="space-y-4 text-sm" aria-label="Proposed upgrade changes">
      <h3 className="font-bold">Reading checks</h3>
      {spec.documents.map((document, index) => (
        <ReviewSection key={document.id} section={sections[index]!} latest={latestPath === sections[index]!.path} reviewed={reviewed.has(sections[index]!.path)} onReviewed={onReviewed}>
          {document.readingCheck ? (
            <div className="mt-3 space-y-4">
              {document.readingCheck.variants.map((question, index) => (
                <QuestionReview key={question.id} document={document} question={question} label={`Question ${index + 1}`} />
              ))}
              <p className="border-t border-line pt-3">After a wrong answer, students correct that question with a fresh supporting highlight before moving to the next question.</p>
            </div>
          ) : <PendingSection status={sections[index]!.status} kind="reading check" />}
        </ReviewSection>
      ))}
      <h3 className="font-bold">Stage requirements</h3>
      {spec.stages.map((stage, index) => (
        <ReviewSection key={stage.id} section={sections[spec.documents.length + index]!} latest={latestPath === sections[spec.documents.length + index]!.path} reviewed={reviewed.has(sections[spec.documents.length + index]!.path)} onReviewed={onReviewed}>
          {stage.preparation ? (
            <div className="mt-3 space-y-3">
              {Object.entries(stage.preparation.characters).map(([id, groups]) => (
                <section key={id}>
                  <h4 className="font-semibold">Before talking to {character(id)}</h4>
                  <PreparationGroups groups={groups} discovery={discovery} />
                </section>
              ))}
              <section>
                <h4 className="font-semibold">Before deciding</h4>
                <PreparationGroups groups={stage.preparation.decision} discovery={discovery} />
              </section>
              <section>
                <h4 className="font-semibold">Required conversations</h4>
                <ul className="list-disc pl-5">
                  {stage.preparation.essentialCharacters.map((person) => (
                    <li key={person.characterId}>
                      {character(person.characterId)}: {person.discoveryIds.map(discovery).join("; ")}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : <PendingSection status={sections[spec.documents.length + index]!.status} kind="stage requirements" />}
        </ReviewSection>
      ))}
    </div>
  );
}
