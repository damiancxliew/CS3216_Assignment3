"use client";
import {
  decodeStoredSpec,
  type AdventureSpec,
  type PreparationGroup,
  type ReadingQuestion,
  type SpecDocument,
} from "@adventure/spec-v3";
import type { UpgradeRun } from "@/lib/v3/upgrades/types";

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
  if (!groups.length) return <p>No document preparation required.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {groups.map((group, index) => (
        <li key={index}>
          Read {group.minMet} of: {group.discoveryIds.map(discovery).join("; ")}
        </li>
      ))}
    </ul>
  );
}

export function UpgradeReview({ run }: { run: UpgradeRun }) {
  const decoded = decodeStoredSpec(run.candidate);
  if (!decoded.ok) return null;
  const spec: AdventureSpec = decoded.spec;
  const discovery = (id: string) => spec.discoveries.find((item) => item.id === id)?.text ?? id;
  const character = (id: string) => spec.characters.find((item) => item.id === id)?.name ?? id;
  return (
    <div className="space-y-4 text-sm" aria-label="Proposed upgrade changes">
      <h3 className="font-bold">Reading questions and supporting passages</h3>
      {spec.documents.map((document) => (
        <details key={document.id} className="rounded-control border border-line p-3">
          <summary className="cursor-pointer font-semibold">{document.title}</summary>
          {document.readingCheck ? (
            <div className="mt-3 space-y-4">
              {document.readingCheck.variants.map((question, index) => (
                <QuestionReview key={question.id} document={document} question={question} label={`Question ${index + 1}`} />
              ))}
              <QuestionReview document={document} question={document.readingCheck.recovery} label="Guided correction" />
            </div>
          ) : <p className="mt-2">No reading check proposed.</p>}
        </details>
      ))}
      <h3 className="font-bold">Preparation and essential conversations</h3>
      {spec.stages.map((stage) => (
        <details key={stage.id} className="rounded-control border border-line p-3">
          <summary className="cursor-pointer font-semibold">{stage.title}</summary>
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
          ) : <p className="mt-2">No preparation proposed.</p>}
        </details>
      ))}
    </div>
  );
}
