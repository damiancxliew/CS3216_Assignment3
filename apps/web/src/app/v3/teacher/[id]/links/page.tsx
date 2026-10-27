import Link from "next/link";
import { PublicationAttribution } from "@/components/teacher/v3-publication-attribution";
import { V3AdventureNav } from "@/components/teacher/v3-adventure-nav";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Page } from "@/components/ui";
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
  return (
    <Page title="Version history" width="wide">
      <V3AdventureNav adventureId={id} page="history" />
      {history.adventure.status !== "published" ? (
        <p className="text-sm text-muted">
          Unpublished · Links are closed to new starts.
        </p>
      ) : null}
      {history.rows.length ? (
        <>
          <div className="space-y-4 md:hidden">
            {history.rows.map((row) => {
              const path = `/v3/join/${encodeURIComponent(row.id)}`;
              const url = host ? `${protocol}://${host}${path}` : path;
              return (
                <article
                  key={row.version}
                  className="space-y-4 rounded-surface border border-line bg-surface p-4"
                >
                  <div>
                    <h2 className="flex items-center gap-2 font-bold">
                      Version {row.version} {row.live ? <LiveBadge /> : null}
                    </h2>
                    <p className="mt-1 text-sm text-muted">{row.title}</p>
                    <PublicationAttribution publication={row} />
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">Started</dt>
                      <dd className="mt-1 font-bold">{row.started}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">In progress</dt>
                      <dd className="mt-1 font-bold">{row.inProgress}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Completed</dt>
                      <dd className="mt-1 font-bold">
                        {row.completed}
                        {row.started ? (
                          <span className="ml-1 font-normal text-muted">
                            ({Math.round((row.completed / row.started) * 100)}%)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
                    <div className="flex items-center gap-3">
                      <ReleaseLink path={path} url={url} />
                      <CopyStudentLink path={path} />
                    </div>
                    <Link
                      href={`/v3/teacher/${id}/summary?version=${row.version}`}
                      className="text-sm underline underline-offset-4"
                    >
                      View results
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto rounded-surface border border-line bg-surface md:block">
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
                  const releasePath = `/v3/join/${encodeURIComponent(row.id)}`;
                  const releaseUrl = host
                    ? `${protocol}://${host}${releasePath}`
                    : releasePath;
                  return (
                    <tr key={row.version}>
                      <th scope="row" className="border-b border-line p-3">
                        <p className="flex items-center gap-2">
                          Version {row.version}
                          {row.live ? <LiveBadge /> : null}
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
                        <PublicationAttribution publication={row} />
                        {row.firstPublishedAt && row.firstPublishedAt !== row.lastPublishedAt ? (
                          <p className="mt-1 text-xs text-muted">First published {" "}
                            <time dateTime={row.firstPublishedAt}>
                              {new Date(row.firstPublishedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}
                            </time>
                          </p>
                        ) : null}
                      </td>
                      <td className="border-b border-line p-3">
                        {row.started}
                      </td>
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
        </>
      ) : (
        <p>No versions have been published yet.</p>
      )}
    </Page>
  );
}

function LiveBadge() {
  return (
    <span className="inline-flex rounded-full bg-world-wash px-2 py-0.5 text-xs font-semibold text-world">
      Live
    </span>
  );
}
