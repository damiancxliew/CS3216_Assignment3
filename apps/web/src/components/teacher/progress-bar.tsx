/**
 * The game's progress bar: a thick-inked track, a world-to-signal gradient
 * fill, barber-pole stripes in motion, and a glowing leading edge. The
 * indeterminate variant sweeps a single pill back and forth.
 */
export function ProgressBar({
  value,
  max,
  label,
  indeterminate = false,
}: {
  value?: number;
  max?: number;
  label: string;
  indeterminate?: boolean;
}) {
  const pct = !indeterminate && max ? Math.min(100, Math.max(0, ((value ?? 0) / max) * 100)) : 0;
  const stripes = (
    <div
      className="animate-progress-stripes absolute inset-0"
      style={{
        backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.28) 0 8px, transparent 8px 16px)",
        backgroundSize: "32px 32px",
      }}
    />
  );
  return (
    <div
      role="progressbar"
      aria-label={label}
      {...(indeterminate ? {} : { "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": value ?? 0 })}
      className="relative h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-sunken shadow-[inset_0_2px_0_color-mix(in_srgb,var(--ink)_12%,transparent)]"
    >
      {indeterminate ? (
        <div
          aria-hidden
          className="animate-progress-sweep absolute inset-y-0 w-2/5 overflow-hidden rounded-full"
          style={{ background: "linear-gradient(90deg, var(--world), var(--signal))" }}
        >
          {stripes}
        </div>
      ) : (
        <div
          aria-hidden
          className="relative h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--world), var(--signal))" }}
        >
          {stripes}
          <div className="absolute right-0 top-0 h-full w-6 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--paper)_70%,transparent))]" />
        </div>
      )}
    </div>
  );
}
