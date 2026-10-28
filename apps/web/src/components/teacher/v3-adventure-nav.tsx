import Link from "next/link";
import { History } from "lucide-react";

/** Consistent navigation for the adventure workspace and its teacher pages. */
export function V3AdventureNav({
  adventureId,
  page,
}: {
  adventureId: string;
  page: "adventure" | "history" | "summary";
}) {
  const href = `/v3/teacher/${adventureId}`;
  const secondary =
    page === "adventure"
      ? [
          { href: `${href}/summary`, label: "Class summary" },
        ]
      : page === "summary"
        ? [
            { href: `${href}/preview`, label: "Preview" },
          ]
        : [{ href: `${href}/summary`, label: "Class summary" }];
  return (
    <nav
      aria-label="Adventure navigation"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-3 text-sm"
    >
      <Link
        href={page === "adventure" ? "/teacher" : href}
        className="inline-flex items-center text-muted hover:text-ink"
      >
        ← Back to {page === "adventure" ? "adventures" : "adventure"}
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        {page !== "history" ? <Link href={`${href}/links`} className="inline-flex items-center gap-1.5 text-muted underline underline-offset-4 hover:text-ink"><History className="size-4" aria-hidden />Version history</Link> : null}
        {secondary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-muted underline underline-offset-4 hover:text-ink"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
