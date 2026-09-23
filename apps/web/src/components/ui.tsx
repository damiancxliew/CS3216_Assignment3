/**
 * Shared furniture. Two registers run through the whole product: the record
 * (serif, ink-blue, always cited) and the simulation (sans, moss). Everything
 * here is the neutral chrome around them, plus the two register primitives
 * and the three states every screen needs: waiting, empty, failed.
 */
import Link from "next/link";

/** Teacher-facing names for the Spec v2 reading bands. */
export { READING_BAND_LABELS } from "@/lib/brief/schema";

export const button = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-ink px-4 py-2 text-base font-semibold text-paper transition-colors hover:bg-record disabled:cursor-not-allowed disabled:opacity-60",
  quiet:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-strong bg-transparent px-4 py-2 text-base font-semibold text-ink transition-colors hover:border-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60",
  subtle:
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-line-strong bg-transparent px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-60",
};

export const control =
  "w-full rounded-control border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted transition-colors focus:border-record focus:outline-none disabled:opacity-60";

/** A button label while its action runs: the spinner plus what is happening. */
export function Pending({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Spinner />
      {children}
    </>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} shrink-0 animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Someone (a stakeholder, the planner) is composing a reply. */
export function Thinking({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-base text-muted" role="status" aria-live="polite">
      <span className="inline-flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-thinking rounded-full bg-current" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </span>
      {label}
    </span>
  );
}

/** A placeholder shaped like the content that is on its way. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-control bg-sunken ${className}`} />;
}

/** Nothing here yet, and what to do about it. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-surface border border-line bg-surface px-6 py-7">
      <p className="font-serif text-xl text-ink">{title}</p>
      {children ? <div className="max-w-[56ch] text-base text-muted">{children}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export function StatusBadge({
  status,
  version,
}: {
  status: string;
  version: number | null;
}) {
  const label =
    status === "published" && version !== null
      ? `Published, version ${version}`
      : status === "published"
        ? "Published"
        : status === "archived"
          ? "Archived"
          : "Draft";
  const tone =
    status === "published"
      ? "border-world/40 bg-world-wash text-world"
      : "border-line-strong text-muted";
  return (
    <span className={`whitespace-nowrap rounded-control border px-2.5 py-1 text-sm font-semibold ${tone}`}>
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
  hint,
}: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  optional?: boolean;
  multiline?: boolean;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel optional={optional}>{label}</FieldLabel>
      {multiline ? (
        <textarea name={name} rows={rows} placeholder={placeholder} defaultValue={defaultValue} className={control} />
      ) : (
        <input name={name} placeholder={placeholder} defaultValue={defaultValue} className={control} />
      )}
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </label>
  );
}

export function FileField({
  name,
  label,
  accept,
  hint,
}: {
  name: string;
  label: string;
  accept: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="file"
        name={name}
        accept={accept}
        className={`${control} file:mr-3 file:rounded-control file:border-0 file:bg-ink file:px-3 file:py-1 file:text-sm file:font-semibold file:text-paper`}
      />
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
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
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <select name={name} defaultValue={defaultValue} className={control}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="text-base font-semibold text-ink">
      {children}
      {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
    </span>
  );
}

export function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-serif text-2xl text-ink">{title}</h2>
        {lede ? <p className="max-w-[60ch] text-base text-muted">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The frame every non-play page shares: a wordmark home link and a serif title. */
export function Page({
  kicker,
  title,
  lede,
  width = "narrow",
  fill,
  children,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  width?: "narrow" | "wide";
  /** Fill the viewport on large screens so children can scroll inside the page. */
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className={`mx-auto flex min-h-screen w-full flex-col gap-10 px-6 py-10 sm:py-14 ${width === "wide" ? "max-w-5xl" : "max-w-3xl"}${fill ? " lg:h-dvh lg:min-h-0 lg:overflow-hidden" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <Wordmark />
        {kicker ? <div className="text-base text-muted">{kicker}</div> : null}
      </div>
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl text-ink sm:text-5xl">{title}</h1>
        {lede ? <div className="max-w-[62ch] text-lg text-muted">{lede}</div> : null}
      </header>
      {children}
    </main>
  );
}

/**
 * The mark: an H whose left stem is set in the record's register (a slab
 * serif, ink-blue) and whose right stem is set in the simulation's (a plain
 * sans stem, moss), joined by a crossbar that changes colour at the centre.
 * The two registers, side by side, reconciled in the middle: the debrief.
 * Geometry is shared with app/icon.svg; change both together.
 */
export const MARK_PATHS = {
  record: "M5 5h10v2h-3v7h5.5v3H12v8h3v2H5v-2h3V7H5z",
  world: "M23 5h4v22h-4V17h-5.5v-3H23z",
} as const;

export function Mark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${className} shrink-0`} aria-hidden>
      <path d={MARK_PATHS.record} className="fill-record" />
      <path d={MARK_PATHS.world} className="fill-world" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 font-serif text-lg text-ink hover:text-record ${className}`}>
      <Mark />
      Historical Adventures
    </Link>
  );
}

/**
 * The record register: a claim that comes from a source, set in the serif with
 * the ink-blue rule and its provenance underneath. Never rendered without one.
 */
export function RecordEntry({
  quote,
  source,
  children,
}: {
  quote?: string;
  source: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-l-[3px] border-record pl-4">
      {quote ? <p className="font-serif text-xl italic leading-[1.6] text-ink">“{quote}”</p> : null}
      {children ? <div className="font-serif text-xl leading-[1.6] text-ink">{children}</div> : null}
      <p className="text-base font-semibold text-record">{source}</p>
    </div>
  );
}

/** The simulation register: what the game did or assumed. The sans, marked in moss. */
export function WorldEntry({
  label,
  children,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-l-[3px] border-world pl-4">
      {label ? <p className="text-base font-semibold text-world">{label}</p> : null}
      <div className="text-lg leading-[1.55] text-ink">{children}</div>
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-control border border-danger/50 bg-danger-wash px-3.5 py-2.5 text-base text-ink">
      {children}
    </p>
  );
}
