"use client";
import React, { useState } from "react";
import { Select } from "@/components/select";
import { z } from "zod";
import { AdventureSpec, type AdventureSpec as Spec } from "@adventure/spec-v3";
import { compactButton as button } from "@/components/ui";
import {
  unwrap,
  template,
  references,
  referenceContext,
  dependentPaths,
  fieldLabel,
} from "@/lib/v3/edit/form";
import type { V3Edit, EditPath, CapturedSource } from "@/lib/v3/edit/commands";
import { Citations } from "./review-screen";
import { reviewAnchor, reviewSectionId, reviewStanceId } from "@/lib/v3/review";

const input =
  "w-full min-w-0 rounded-lg border border-line bg-paper p-2 text-sm text-ink";
type Props = {
  spec: Spec;
  value: unknown;
  schema: z.ZodType;
  path: EditPath;
  name: string;
  onEdit: (edit: V3Edit) => void;
};
export function Remove({
  value,
  path,
  spec,
  onEdit,
}: Pick<Props, "value" | "path" | "spec" | "onEdit">) {
  const [confirm, setConfirm] = useState(false);
  const ids: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "id" && typeof x === "string") ids.push(x);
      else walk(x);
    }
  };
  walk(value);
  const dependents = [
    ...new Set(ids.flatMap((id) => dependentPaths(spec, id))),
  ].filter((p) => !p.startsWith(path.join(".") + "."));
  return (
    <>
      <button
        type="button"
        className={button.subtle}
        onClick={() => setConfirm(true)}
      >
        Remove
      </button>
      {confirm ? (
        <div
          role="alert"
          className="w-full rounded-lg border border-danger p-3 text-sm"
        >
          <p>
            {dependents.length
              ? "These references will need repair after removal:"
              : "Remove this item?"}
          </p>
          <ul className="list-disc pl-5">
            {dependents.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button
            type="button"
            className={button.quiet}
            onClick={() => onEdit({ type: "remove", path })}
          >
            Confirm removal
          </button>
          <button
            type="button"
            className={button.subtle}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}

/** The schema drives field coverage, optional fields and recursive condition variants. */
export function EditField({ spec, value, schema, path, name, onEdit }: Props) {
  const id = `edit-${path.join("-")}`;
  const key = String(path.at(-1));
  const set = (value: unknown) => onEdit({ type: "set", path, value });
  const unwrapped = unwrap(schema);
  const kind = unwrapped._zod.def.type;
  const optional = schema._zod.def.type === "optional";
  if (key === "id") return null;
  if (key === "citations")
    return (
      <Citations
        citations={value as Spec["documents"][number]["citations"]}
        sources={spec.sources}
      />
    );
  if (value === undefined || value === null)
    return (
      <div className="space-y-2">
        <span className="text-sm font-bold">{name}</span>{" "}
        <button
          type="button"
          className={button.subtle}
          onClick={() => set(template(unwrapped))}
        >
          Add {name}
        </button>
      </div>
    );
  if (
    ["sourceLabel"].includes(key) ||
    (key === "real" && path[0] === "documents")
  )
    return (
      <div className="text-sm text-muted">
        <span className="font-bold">{name}: </span>
        {typeof value === "string" || typeof value === "boolean" ? (
          String(value)
        ) : (
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    );
  if (kind === "union") {
    const options = (unwrapped as z.ZodUnion).options as z.ZodType[];
    // Shape keys choose object unions even while required fields are temporarily empty.
    const optionIndex = Math.max(
      0,
      options.findIndex((o) => {
        const option = unwrap(o);
        if (option._zod.def.type !== "object")
          return o.safeParse(value).success;
        const shape = (option as z.ZodObject).shape;
        return (
          typeof value === "object" &&
          value !== null &&
          Object.keys(value).every((k) => k in shape) &&
          Object.entries(shape).every(
            ([k, s]) => (s as z.ZodType).isOptional() || k in value,
          )
        );
      }),
    );
    return (
      <fieldset className="min-w-0 space-y-3 rounded-lg border border-line p-3">
        <legend className="px-1 font-bold">{name}</legend>
        <label className="block text-sm">
          Form
          <select
            aria-label={`${name} form`}
            className={input}
            value={optionIndex}
            onChange={(e) => set(template(options[Number(e.target.value)]))}
          >
            {options.map((o, i) => {
              const option = unwrap(o);
              return (
                <option key={i} value={i}>
                  {option._zod.def.type === "object"
                    ? Object.keys((option as z.ZodObject).shape)
                        .map(fieldLabel)
                        .join(", ")
                    : option._zod.def.type === "literal"
                      ? [...(option as z.ZodLiteral).values].join(" / ")
                      : option._zod.def.type}
                </option>
              );
            })}
          </select>
        </label>
        <EditField
          {...{ spec, value, path, name, onEdit }}
          schema={options[optionIndex]}
        />
      </fieldset>
    );
  }
  if (kind === "object") {
    const obj = value as Record<string, unknown>;
    const entityId =
      typeof obj.id === "string"
        ? path[0] === "characters" && path[2] === "stances"
          ? reviewStanceId(spec.characters[Number(path[1])].id, obj.id)
          : obj.id
        : undefined;
    return (
      <fieldset
        id={entityId ? reviewAnchor(entityId) : undefined}
        tabIndex={typeof obj.id === "string" ? -1 : undefined}
        className="min-w-0 space-y-4 rounded-lg border border-line p-3"
      >
        <legend className="px-1 font-bold">{name}</legend>
        {Object.entries((unwrapped as z.ZodObject).shape).map(
          ([field, shape]) => (
            <div
              key={field}
              id={
                typeof obj.id === "string"
                  ? reviewAnchor(
                      reviewSectionId(
                        entityId ?? obj.id,
                        (
                          {
                            acts: "choices",
                            body: "text",
                            keyPassages: "passages",
                            trustNotice: "reactions",
                          } as Record<string, string>
                        )[field] ?? field,
                      ),
                    )
                  : undefined
              }
              tabIndex={typeof obj.id === "string" ? -1 : undefined}
            >
              <EditField
                spec={spec}
                value={obj[field]}
                schema={shape as z.ZodType}
                path={[...path, field]}
                name={fieldLabel(field)}
                onEdit={onEdit}
              />
            </div>
          ),
        )}
        {optional ? <Remove {...{ value, path, spec, onEdit }} /> : null}
      </fieldset>
    );
  }
  if (kind === "array") {
    const list = value as unknown[];
    const element = (unwrapped as z.ZodArray).element as z.ZodType;
    return (
      <fieldset className="min-w-0 space-y-3 rounded-lg border border-line p-3">
        <legend className="px-1 font-bold">{name}</legend>
        {list.map((item, i) => (
          <div
            key={
              item && typeof item === "object" && "id" in item
                ? String(item.id)
                : i
            }
            className="min-w-0 space-y-2 border-b border-line pb-3"
          >
            <EditField
              spec={spec}
              value={item}
              schema={element}
              path={[...path, i]}
              name={`${name} ${i + 1}`}
              onEdit={onEdit}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={button.subtle}
                disabled={i === 0}
                aria-label={`Move ${name} ${i + 1} up`}
                onClick={() =>
                  onEdit({ type: "move", path, from: i, to: i - 1 })
                }
              >
                Move up
              </button>
              <button
                type="button"
                className={button.subtle}
                disabled={i === list.length - 1}
                aria-label={`Move ${name} ${i + 1} down`}
                onClick={() =>
                  onEdit({ type: "move", path, from: i, to: i + 1 })
                }
              >
                Move down
              </button>
              <Remove
                spec={spec}
                value={item}
                path={[...path, i]}
                onEdit={onEdit}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          className={button.quiet}
          onClick={() =>
            onEdit({
              type: "insert",
              path,
              index: list.length,
              value: template(element),
            })
          }
        >
          Add {name}
        </button>
      </fieldset>
    );
  }
  if (kind === "record")
    return (
      <RecordField
        {...{ spec, value, schema: unwrapped, path, name, onEdit }}
      />
    );
  let choices: { value: string; label: string }[] | undefined;
  if (kind === "enum")
    choices = (unwrapped as z.ZodEnum).options.map((x) => ({
      value: String(x),
      label: fieldLabel(String(x)),
    }));
  else if (typeof value === "string")
    choices = references(
      spec,
      typeof path.at(-1) === "number"
        ? String(path.at(-2))
        : ["placement", "documentPlacement", "stances"].includes(
              String(path.at(-2)),
            )
          ? String(path.at(-2))
          : key,
      referenceContext(spec, path),
    );
  if (choices) {
    const unique = [...new Map(choices.map((c) => [c.value, c])).values()];
    const options = unique.some((c) => c.value === value)
      ? unique
      : [
          {
            value: String(value) || "__unresolved__",
            label: `Unresolved: ${String(value) || "Choose an item"}`,
          },
          ...unique,
        ];
    return (
      <div className="space-y-1 text-sm font-bold">
        <span>{name}</span>
        <Select
          label={name}
          value={String(value) || "__unresolved__"}
          options={options}
          wrapLabel
          className={input}
          onValueChange={set}
        />
      </div>
    );
  }

  if (kind === "literal")
    return (
      <p className="text-sm">
        {name}: {String(value)}
      </p>
    );
  if (typeof value === "boolean")
    return (
      <label className="flex items-center gap-2 text-sm font-bold">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => set(e.target.checked)}
        />
        {name}
      </label>
    );
  if (typeof value === "number")
    return (
      <label htmlFor={id} className="block space-y-1 text-sm font-bold">
        {name}
        <input
          id={id}
          type="number"
          className={input}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
        />
      </label>
    );
  const realBody =
    key === "body" &&
    path[0] === "documents" &&
    spec.documents[Number(path[1])]?.real;
  return (
    <label htmlFor={id} className="block space-y-1 text-sm font-bold">
      {name}
      {realBody ? " (captured evidence, read-only)" : ""}
      <textarea
        id={id}
        className={input}
        rows={Math.min(8, Math.max(2, Math.ceil(String(value).length / 90)))}
        value={String(value)}
        readOnly={!!realBody}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function RecordField(props: Props) {
  const { spec, value, schema, path, name, onEdit } = props;
  const [newKey, setNewKey] = useState("");
  const key = String(path.at(-1));
  const obj = value as Record<string, unknown>;
  const options =
    key === "documentPlacement" ? spec.documents : spec.characters;
  const valueSchema = (schema as z.ZodRecord).valueType as z.ZodType;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 font-bold">{name}</legend>
      {Object.entries(obj).map(([id, item]) => (
        <div key={id} className="space-y-2">
          <EditField
            spec={spec}
            value={item}
            schema={valueSchema}
            path={[...path, id]}
            name={
              options.find((x) => x.id === id)?.["id"] === id
                ? "name" in options.find((x) => x.id === id)!
                  ? (
                      options.find(
                        (x) => x.id === id,
                      ) as Spec["characters"][number]
                    ).name
                  : (
                      options.find(
                        (x) => x.id === id,
                      ) as Spec["documents"][number]
                    ).title
                : `Unresolved: ${id}`
            }
            onEdit={(edit) => {
              if (edit.type === "set")
                onEdit({
                  type: "set",
                  path,
                  value: { ...obj, [id]: edit.value },
                });
              else onEdit(edit);
            }}
          />
          <Remove {...{ spec, path: [...path, id], value: item, onEdit }} />
        </div>
      ))}
      <label className="block text-sm">
        Add placement or stance
        <select
          aria-label={`Add ${name} reference`}
          className={input}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        >
          <option value="">Choose an item</option>
          {options
            .filter((o) => !(o.id in obj))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {"name" in o ? o.name : o.title}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        className={button.subtle}
        disabled={!newKey}
        onClick={() => {
          onEdit({ type: "set", path, value: { ...obj, [newKey]: "" } });
          setNewKey("");
        }}
      >
        Add reference
      </button>
    </fieldset>
  );
}

export function EvidenceControls({
  spec,
  index,
  sources,
  onEdit,
}: {
  spec: Spec;
  index: number;
  sources: CapturedSource[];
  onEdit: (e: V3Edit) => void;
}) {
  const [sourceId, select] = useState(sources[0]?.id ?? "");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const source = sources.find((s) => s.id === sourceId);
  const doc = spec.documents[index];
  return (
    <section className="space-y-3 rounded-lg border border-line p-4">
      <h3 className="font-bold">Document evidence</h3>
      {doc.real ? (
        <button
          type="button"
          className={button.quiet}
          onClick={() =>
            onEdit({ type: "convertDocument", documentId: doc.id })
          }
        >
          Convert to invented document
        </button>
      ) : (
        <p className="text-sm">
          Invented document. Free text editing is available.
        </p>
      )}
      <label className="block text-sm">
        Captured source
        <select
          className={input}
          value={sourceId}
          onChange={(e) => {
            select(e.target.value);
            setSelection({ start: 0, end: 0 });
          }}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      {source ? (
        <label className="block text-sm">
          Select the replacement excerpt
          <textarea
            readOnly
            className={input}
            rows={8}
            value={source.text}
            onSelect={(e) =>
              setSelection({
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              })
            }
          />
        </label>
      ) : (
        <p>No captured source is available.</p>
      )}
      <p className="text-sm">
        Replacement clears old key passages. Repair their discovery links before
        publishing.
      </p>
      <button
        type="button"
        className={button.quiet}
        disabled={!source || selection.end <= selection.start}
        onClick={() =>
          onEdit({
            type: "replaceExcerpt",
            documentId: doc.id,
            sourceId,
            ...selection,
          })
        }
      >
        Replace with selected excerpt
      </button>
    </section>
  );
}
export { AdventureSpec };
