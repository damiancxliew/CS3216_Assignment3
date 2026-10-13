"use client";

import { useState, useTransition } from "react";

import { setSysadmin, setUserAccess } from "./actions";
import { NO_SCHOOL } from "./constants";
import { Select } from "@/components/select";
import { ErrorText } from "@/components/ui";

type Role = "admin" | "teacher" | "student";
type Status = "active" | "removed";

export type AccessRowProps = {
  userId: string;
  email: string | null;
  name: string;
  schools: { id: string; name: string }[];
  membership: { organizationId: string; role: Role; status: Status } | null;
  isSysadmin: boolean;
  isSelf: boolean;
};

const ROLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Admin" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "removed", label: "Removed" },
];
const compactSelect = "!min-h-9 h-9 w-full rounded-control border border-line px-3 py-1.5 text-sm";

export function AccessRow({ userId, email, name, schools, membership, isSysadmin, isSelf }: AccessRowProps) {
  const initialSchool = membership?.organizationId ?? NO_SCHOOL;
  const initialRole = membership?.role ?? "student";
  const initialStatus = membership?.status ?? "active";
  const [school, setSchool] = useState(initialSchool);
  const [role, setRole] = useState<string>(initialRole);
  const [status, setStatus] = useState<string>(initialStatus);
  const [sysadmin, setSysadminValue] = useState(isSysadmin);
  const [message, setMessage] = useState<{ error?: string; notice?: string }>({});
  const [pending, startTransition] = useTransition();

  const label = email ?? name ?? "user";
  const schoolName = (id: string) => schools.find((item) => item.id === id)?.name ?? "their school";
  const dirty = school !== initialSchool || (school !== NO_SCHOOL && (role !== initialRole || status !== initialStatus || !membership));
  const hasSchool = school !== NO_SCHOOL;

  function save() {
    const leavingActive = membership?.status === "active" && membership.organizationId !== school;
    if (leavingActive && !hasSchool && !window.confirm(`Remove ${label} from ${schoolName(membership.organizationId)}?`)) return;
    if (leavingActive && hasSchool && status === "active"
      && !window.confirm(`Move ${label} from ${schoolName(membership.organizationId)} to ${schoolName(school)}?`)) return;

    setMessage({});
    startTransition(async () => {
      const formData = new FormData();
      formData.set("organization_id", school);
      formData.set("role", role);
      formData.set("status", status);
      setMessage(await setUserAccess(userId, {}, formData));
    });
  }

  function toggleSysadmin(next: boolean) {
    setSysadminValue(next);
    setMessage({});
    startTransition(async () => {
      const result = await setSysadmin(userId, next);
      if (result.error) setSysadminValue(!next);
      setMessage(result);
    });
  }

  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-3">
        <div className="font-semibold text-ink">{email ?? "—"}</div>
        {name ? <div className="text-muted">{name}</div> : null}
      </td>
      <td className="px-3 py-3">
        <Select
          label={`School for ${label}`}
          options={[{ value: NO_SCHOOL, label: "— No school —" }, ...schools.map((item) => ({ value: item.id, label: item.name }))]}
          value={school}
          onValueChange={setSchool}
          disabled={pending}
          className={compactSelect}
        />
      </td>
      <td className="px-3 py-3">
        <Select label={`Role for ${label}`} options={ROLE_OPTIONS} value={role} onValueChange={setRole}
          disabled={pending || !hasSchool} className={compactSelect} />
      </td>
      <td className="px-3 py-3">
        <Select label={`Status for ${label}`} options={STATUS_OPTIONS} value={status} onValueChange={setStatus}
          disabled={pending || !hasSchool} className={compactSelect} />
      </td>
      <td className="px-3 py-3">
        <label className="inline-flex min-h-9 items-center gap-2">
          <input
            type="checkbox"
            checked={sysadmin}
            disabled={pending || (isSelf && sysadmin)}
            onChange={(event) => toggleSysadmin(event.currentTarget.checked)}
            aria-label={`Sysadmin for ${label}`}
            className="h-4 w-4 accent-ink"
          />
          <span className="text-muted">{sysadmin ? "Yes" : "No"}</span>
        </label>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-signal px-4 py-1.5 text-sm font-extrabold text-on-signal disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {message.error ? (
            <div className="[&>p]:px-2 [&>p]:py-1 [&>p]:text-xs"><ErrorText>{message.error}</ErrorText></div>
          ) : message.notice ? <p className="text-xs text-muted" role="status">{message.notice}</p> : null}
        </div>
      </td>
    </tr>
  );
}
