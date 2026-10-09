"use client";

import { useState } from "react";

import { createSchool } from "./actions";
import { ActionForm } from "@/components/action-form";
import { control } from "@/components/ui";

function toSlug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function CreateSchoolForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <ActionForm action={createSchool} submitLabel="Create school" pendingLabel="Creating school…" className="grid max-w-3xl gap-4 rounded-surface border border-line bg-surface p-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-base font-semibold text-ink">School name</span>
        <input
          name="name"
          value={name}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setName(value);
            if (!slugEdited) setSlug(toSlug(value));
          }}
          className={control}
          required
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-base font-semibold text-ink">Slug</span>
        <input
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.currentTarget.value);
          }}
          className={control}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
        />
        <span className="text-sm text-muted">Lowercase letters, numbers, and single hyphens; editable before creating.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-base font-semibold text-ink">First admin email</span>
        <input name="admin_email" type="email" className={control} required />
      </label>
    </ActionForm>
  );
}
