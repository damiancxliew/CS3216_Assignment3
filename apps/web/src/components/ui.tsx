/** Small shared pieces of the teacher console's form and list furniture. */

export function StatusBadge({
  status,
  version,
}: {
  status: string;
  version: number | null;
}) {
  const label =
    status === "published" && version !== null
      ? `Published · v${version}`
      : status === "published"
        ? "Published"
        : status === "archived"
          ? "Archived"
          : "Draft";
  return (
    <span className="whitespace-nowrap rounded-full border border-black/15 px-3 py-1 text-xs opacity-70 dark:border-white/20">
      {label}
    </span>
  );
}

export function Field({
  name,
  label,
  placeholder,
  defaultValue,
  optional,
  multiline,
  rows = 4,
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  optional?: boolean;
  multiline?: boolean;
  rows?: number;
}) {
  const className =
    "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground dark:border-white/20";
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="opacity-70">
        {label}
        {optional ? " (optional)" : ""}
      </span>
      {multiline ? (
        <textarea
          name={name}
          rows={rows}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={className}
        />
      ) : (
        <input
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={className}
        />
      )}
    </label>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="opacity-70">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground dark:border-white/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}
