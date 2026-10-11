"use client";

import { useState, useTransition } from "react";

import type { ActionResult } from "@/app/teacher/actions";
import { Select } from "@/components/select";
import { ErrorText } from "@/components/ui";

type StaffRole = "admin" | "teacher";
type StaffRoleAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

export function StaffRoleSelect({
  action,
  email,
  defaultValue,
}: {
  action: StaffRoleAction;
  email: string | null;
  defaultValue: StaffRole;
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeRole(next: string) {
    const previous = value;
    setValue(next as StaffRole);
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("role", next);
      const result = await action({}, formData);
      if (result.error) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        label={`Role for ${email ?? "staff member"}`}
        options={[{ value: "teacher", label: "Teacher" }, { value: "admin", label: "Admin" }]}
        value={value}
        onValueChange={changeRole}
        disabled={pending}
        className="!min-h-9 h-9 w-32 rounded-control border border-line px-3 py-1.5 text-sm"
      />
      {error ? (
        <div className="[&>p]:px-2 [&>p]:py-1 [&>p]:text-xs">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </div>
  );
}
