"use client";
import { AdventureSpec, type AdventureSpec as Spec } from "@adventure/spec-v3";
import type { EditablePass } from "@/lib/v3/generation/service";
import type { CapturedSource, V3Edit } from "@/lib/v3/edit/commands";
import { ReviewEditorFields } from "./editor-fields";
import { EditField } from "./edit-form";
import { ReviewCard } from "./review-card";

export function PauseContentCards({
  pass,
  draft,
  sources,
  edit,
}: {
  pass: EditablePass;
  draft: Spec;
  sources: CapturedSource[];
  edit: (command: V3Edit) => void;
}) {
  if (pass === "reveal")
    return (
      <ReviewCard
        title="Reveal and questions"
        preview={
          <div className="space-y-4">
            <p className="whitespace-pre-wrap">{draft.reveal?.whatHappened}</p>
            <h4 className="font-semibold">Teacher questions</h4>
            <ol className="list-decimal space-y-2 pl-5">
              {draft.teacherQuestions.map((question, i) => (
                <li key={i}>{question}</li>
              ))}
            </ol>
          </div>
        }
      >
        <ReviewEditorFields
          draft={draft}
          sources={sources}
          edit={edit}
          tab="reveal"
          selected="reveal"
        />
      </ReviewCard>
    );
  if (pass === "endings")
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-bold">Decisions and endings</h2>
        {draft.stages.map((stage) => (
          <div key={stage.id} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted">{stage.title}</h3>
            {draft.definingMoments.map((moment, index) =>
              moment.stageId === stage.id ? (
                <ReviewCard
                  key={moment.id}
                  title={moment.scene || "Decision"}
                  subtitle="Decision"
                  preview={
                    <div className="space-y-3">
                      <ul className="list-disc space-y-1 pl-5">
                        {moment.acts.map((act) => (
                          <li key={act.id}>{act.text}</li>
                        ))}
                      </ul>
                      <h4 className="font-semibold">Endings produced</h4>
                      <ul className="space-y-1">
                        {[
                          ...new Set(
                            moment.outcomes
                              .map((outcome) => outcome.endingId)
                              .filter(Boolean),
                          ),
                        ].map((id) => (
                          <li key={id}>
                            {draft.endings.find((ending) => ending.id === id)
                              ?.title ?? id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  }
                >
                  <EditField
                    spec={draft}
                    schema={AdventureSpec.shape.definingMoments.element}
                    value={moment}
                    path={["definingMoments", index]}
                    name="Decision"
                    onEdit={edit}
                  />
                </ReviewCard>
              ) : null,
            )}
          </div>
        ))}
        {draft.endings.map((ending) => (
          <ReviewCard
            key={ending.id}
            title={ending.title || "Untitled ending"}
            subtitle={`${ending.type[0].toUpperCase() + ending.type.slice(1)} ending`}
            preview={<p>{ending.summary}</p>}
          >
            <ReviewEditorFields
              draft={draft}
              sources={sources}
              edit={edit}
              tab="endings"
              selected={ending.id}
            />
          </ReviewCard>
        ))}
      </div>
    );
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold">Stages</h2>
      {draft.stages.map((stage) => (
        <ReviewCard
          key={stage.id}
          title={stage.title || "Untitled stage"}
          subtitle={stage.timePlace}
          preview={
            <div className="space-y-3">
              <p className="font-medium">{stage.centralQuestion}</p>
              <p>{stage.openingNarration}</p>
              <p className="text-xs text-muted">
                {stage.rooms.length} places ·{" "}
                {
                  draft.discoveries.filter((item) => item.stageId === stage.id)
                    .length
                }{" "}
                discoveries
              </p>
            </div>
          }
        >
          <ReviewEditorFields
            draft={draft}
            sources={sources}
            edit={edit}
            tab="stages"
            selected={stage.id}
            detailsOnly
          />
        </ReviewCard>
      ))}
      <h2 className="text-lg font-bold">Characters</h2>
      {draft.characters.map((character) => (
        <ReviewCard
          key={character.id}
          title={character.name || "Untitled character"}
          subtitle={character.title}
          preview={<p>{character.persona.publicPosition}</p>}
        >
          <ReviewEditorFields
            draft={draft}
            sources={sources}
            edit={edit}
            tab="characters"
            selected={character.id}
            detailsOnly
          />
        </ReviewCard>
      ))}
      <h2 className="text-lg font-bold">Documents</h2>
      {draft.documents.map((document) => (
        <ReviewCard
          key={document.id}
          title={document.title || "Untitled document"}
          subtitle={document.real ? "Historical document" : "Invented document"}
          preview={
            <p className="line-clamp-5 whitespace-pre-wrap">{document.body}</p>
          }
        >
          <ReviewEditorFields
            draft={draft}
            sources={sources}
            edit={edit}
            tab="documents"
            selected={document.id}
            detailsOnly
          />
        </ReviewCard>
      ))}
    </div>
  );
}
