import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Page, button } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";
import { v3PublishDeps } from "@/lib/play/v3/http";
import { loadPublicationHistory } from "@/lib/play/v3/publication-history";
import { CopyStudentLink, ReleaseLink } from "./student-link";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Version history",
  robots: { index: false },
};

export default async function StudentLinkHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!v3Enabled()) notFound();
  const { id } = await params;
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) redirect("/");
  const history = await loadPublicationHistory(v3PublishDeps(), user.id, id);
  if (!history) notFound();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const live = history.rows.find((row) => row.live);
  const path = `/v3/join/${encodeURIComponent(id)}${live?.linkKey ? `?release=${encodeURIComponent(live.linkKey)}` : ""}`;
  const url = host ? `${protocol}://${host}${path}` : path;
  return (
    <Page title="Version history" width="wide">
      <Link href={`/v3/teacher/${id}`} className={button.subtle}>
        Back to adventure
      </Link>
      <section className="my-6 flex flex-wrap items-center justify-between gap-4 rounded-surface border border-line bg-surface p-5">
        <div>
          <h2 className="font-bold">
            {live ? `Live · Version ${live.version}` : "Unpublished"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {live
              ? "Each link stays with its version."
              : "Links are closed to new starts."}
          </p>
        </div>
        {live ? (
          <div className="flex items-center gap-4">
            <ReleaseLink path={path} url={url} />
            <CopyStudentLink path={path} />
          </div>
        ) : null}
      </section>
      {history.rows.length ? (
        <div className="overflow-x-auto rounded-surface border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Published versions and completion stats
            </caption>
            <thead>
              <tr>
                {[
                  "Version",
                  "Student link",
                  "Publication",
                  "Started",
                  "In progress",
                  "Completed",
                  "Results",
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="border-b border-line p-3"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => {
                const releasePath = `/v3/join/${encodeURIComponent(id)}?release=${encodeURIComponent(row.linkKey)}`;
                const releaseUrl = host
                  ? `${protocol}://${host}${releasePath}`
                  : releasePath;
                return (
                  <tr key={row.version}>
                    <th scope="row" className="border-b border-line p-3">
                      <p>
                        Version {row.version}
                        {row.live ? " · Live" : ""}
                      </p>
                      <p className="font-normal">{row.title}</p>
                    </th>
                    <td className="border-b border-line p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <ReleaseLink path={releasePath} url={releaseUrl} />
                        <CopyStudentLink path={releasePath} />
                      </div>
                    </td>
                    <td className="border-b border-line p-3">
                      {row.firstPublishedAt ? (
                        <time dateTime={row.firstPublishedAt}>
                          {new Date(row.firstPublishedAt).toLocaleString(
                            "en-SG",
                            { timeZone: "Asia/Singapore" },
                          )}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="border-b border-line p-3">{row.started}</td>
                    <td className="border-b border-line p-3">
                      {row.inProgress}
                    </td>
                    <td
                      className="border-b border-line p-3"
                      title="Reached the reveal, as a share of started attempts"
                    >
                      {row.completed}
                      {row.started ? (
                        <span className="ml-2 text-muted">
                          ({Math.round((row.completed / row.started) * 100)}%)
                        </span>
                      ) : null}
                    </td>
                    <td className="border-b border-line p-3">
                      <Link
                        href={`/v3/teacher/${id}/summary?version=${row.version}`}
                        className="underline"
                      >
                        View results
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No versions have been published yet.</p>
      )}
    </Page>
  );
}
