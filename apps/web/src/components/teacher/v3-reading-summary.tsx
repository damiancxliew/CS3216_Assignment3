import type { ClassSummary } from "@adventure/play-contract";

export function V3ReadingSummary({ checks }: { checks: NonNullable<ClassSummary["readingChecks"]> }) {
  if (!checks.length) return null;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="pb-3 text-left font-bold text-ink">Reading checks</caption>
        <thead><tr className="border-b border-line text-muted">
          <th scope="col" className="py-2 pr-4">Scroll</th>
          <th scope="col" className="py-2 pr-4">Attempted</th>
          <th scope="col" className="py-2 pr-4">Passed first time</th>
          <th scope="col" className="py-2 pr-4">Completed</th>
          <th scope="col" className="py-2">Completed after correction</th>
        </tr></thead>
        <tbody>{checks.map(check => (
          <tr key={check.documentId} className="border-b border-line">
            <th scope="row" className="py-3 pr-4 font-semibold">{check.title}</th>
            <td className="py-3 pr-4">{check.attempted}</td>
            <td className="py-3 pr-4">{check.firstAttemptCorrect}</td>
            <td className="py-3 pr-4">{check.completed}</td>
            <td className="py-3">{check.recovered}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-3 text-sm text-muted">Counts are per play attempt. Later corrections preserve the first response.</p>
    </div>
  );
}
