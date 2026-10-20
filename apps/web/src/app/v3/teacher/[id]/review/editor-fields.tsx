"use client";
import React from "react";
import { z } from "zod";
import { AdventureSpec, type AdventureSpec as Spec } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import {
  applyV3Edits,
  type CapturedSource,
  type V3Edit,
} from "@/lib/v3/edit/commands";
import { fieldLabel, template, unwrap } from "@/lib/v3/edit/form";
import { reviewAnchor, reviewSectionId, type ReviewTab } from "@/lib/v3/review";
import { EditField, EvidenceControls, Remove } from "./edit-form";
export function ReviewEditorFields({
  draft,
  sources,
  edit,
  tab,
  selected,
  detailsOnly = false,
}: {
  draft: Spec;
  sources: CapturedSource[];
  edit: (command: V3Edit) => void;
  tab: ReviewTab;
  selected: string;
  detailsOnly?: boolean;
}) {
  const field = (key: keyof Spec) => (
    <EditField
      key={key}
      spec={draft}
      schema={AdventureSpec.shape[key]}
      value={draft[key]}
      path={[key]}
      name={fieldLabel(key)}
      onEdit={edit}
    />
  );
  if (tab === "settings")
    return (
      <div className="space-y-4 rounded-surface border border-line bg-surface p-4">
        <p className="text-sm">
          Reading level and source policy do not rewrite existing prose or fetch
          new sources.
        </p>
        {(["title", "arc", "readingLevel", "timer", "role"] as const).map(
          field,
        )}
        <EditField
          spec={draft}
          schema={AdventureSpec.shape.authoring
            .unwrap()
            .shape.sourcePolicy.unwrap()}
          value={
            draft.authoring?.sourcePolicy ?? {
              allowAny: false,
              extraDomains: [],
            }
          }
          path={["sourcePolicy"]}
          name="Source policy"
          onEdit={(command) => {
            const policy = structuredClone(
              draft.authoring?.sourcePolicy ?? {
                allowAny: false,
                extraDomains: [],
              },
            );
            // Reuse the reducer on a small, schema-shaped settings wrapper.
            const holder = {
              ...draft,
              sourcePolicy: policy,
            } as unknown as Spec;
            const updated = applyV3Edits(
              holder,
              [command],
              [],
              true,
            ) as unknown as {
              sourcePolicy: NonNullable<
                NonNullable<Spec["authoring"]>["sourcePolicy"]
              >;
            };
            edit({ type: "sourcePolicy", value: updated.sourcePolicy });
          }}
        />
      </div>
    );
  if (tab === "reveal")
    return (
      <div className="space-y-4 rounded-surface border border-line bg-surface p-4">
        {field("reveal")}
        {field("teacherQuestions")}
      </div>
    );
  const index = draft[tab].findIndex((item) => item.id === selected);
  const list = draft[tab];
  const associated =
    tab === "stages"
      ? ([
          "discoveries",
          ...(detailsOnly ? [] : (["definingMoments"] as const)),
          "storyEvents",
          "openQuestions",
          "hintAngles",
        ] as const)
      : tab === "characters"
        ? (["triggers"] as const)
        : [];
  return (
    <div className="space-y-4 rounded-surface border border-line bg-surface p-4">
      {index >= 0 ? (
        <>
          {tab === "documents" ? (
            <EvidenceControls
              spec={draft}
              index={index}
              sources={sources}
              onEdit={edit}
            />
          ) : null}
          <EditField
            spec={draft}
            schema={
              detailsOnly && tab === "stages"
                ? AdventureSpec.shape.stages.element.omit({
                    definingMomentId: true,
                  })
                : (AdventureSpec.shape[tab].element as z.ZodType)
            }
            value={list[index]}
            path={[tab, index]}
            name={fieldLabel(tab)}
            onEdit={edit}
          />
          <div className="flex flex-wrap gap-2">
            <Remove
              spec={draft}
              value={list[index]}
              path={[tab, index]}
              onEdit={edit}
            />
            <button
              type="button"
              className={button.subtle}
              disabled={index === 0}
              onClick={() =>
                edit({
                  type: "move",
                  path: [tab],
                  from: index,
                  to: index - 1,
                })
              }
            >
              Move item up
            </button>
            <button
              type="button"
              className={button.subtle}
              disabled={index === list.length - 1}
              onClick={() =>
                edit({
                  type: "move",
                  path: [tab],
                  from: index,
                  to: index + 1,
                })
              }
            >
              Move item down
            </button>
          </div>
        </>
      ) : (
        <p>Select an item from the index.</p>
      )}

      <button
        type="button"
        className={button.quiet}
        onClick={() =>
          edit({
            type: "insert",
            path: [tab],
            index: list.length,
            value: template(AdventureSpec.shape[tab].element as z.ZodType),
          })
        }
      >
        Add {tab === "characters" ? "character" : tab.slice(0, -1)}
      </button>
      {associated.map((key) => {
        const schema = AdventureSpec.shape[key];
        const element = (unwrap(schema) as z.ZodArray<z.ZodType>).element;
        return (
          <section
            key={key}
            className="space-y-4"
            id={reviewAnchor(
              reviewSectionId(selected, key === "storyEvents" ? "events" : key),
            )}
            tabIndex={-1}
          >
            <h3 className="font-bold">{fieldLabel(key)}</h3>
            {draft[key].map((item, i) => {
              const belongs =
                "stageId" in item
                  ? item.stageId === selected
                  : "characterId" in item
                    ? item.characterId === selected
                    : "discoveryId" in item
                      ? draft.discoveries.find((d) => d.id === item.discoveryId)
                          ?.stageId === selected
                      : true;
              return belongs ? (
                <div key={item.id} className="space-y-2">
                  <EditField
                    spec={draft}
                    schema={element}
                    value={item}
                    path={[key, i]}
                    name={fieldLabel(key)}
                    onEdit={edit}
                  />
                  <Remove
                    spec={draft}
                    value={item}
                    path={[key, i]}
                    onEdit={edit}
                  />
                  <button
                    type="button"
                    className={button.subtle}
                    disabled={i === 0}
                    onClick={() =>
                      edit({ type: "move", path: [key], from: i, to: i - 1 })
                    }
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className={button.subtle}
                    disabled={i === draft[key].length - 1}
                    onClick={() =>
                      edit({ type: "move", path: [key], from: i, to: i + 1 })
                    }
                  >
                    Move down
                  </button>
                </div>
              ) : null;
            })}
            <button
              type="button"
              className={button.quiet}
              onClick={() => {
                const value = template(element) as Record<string, unknown>;
                if ("stageId" in value) value.stageId = selected;
                if (key === "triggers") value.characterId = selected;
                edit({
                  type: "insert",
                  path: [key],
                  index: draft[key].length,
                  value,
                });
              }}
            >
              Add {fieldLabel(key)}
            </button>
          </section>
        );
      })}
    </div>
  );
}
