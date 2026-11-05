import type { V3Publication } from "@/lib/play/v3/store";

/** Publication identity comes from the publish operation, never the draft author. */
export function PublicationAttribution({ publication }: {
  publication: Pick<V3Publication, "publishedBy" | "publisherName" | "lastPublishedAt">;
}) {
  const name = publication.publisherName?.trim();
  return <p className="mt-2 text-xs text-muted">
    {publication.publishedBy ? `Last published by ${name || "an unnamed account"}` : "Publisher not recorded"}
    {publication.lastPublishedAt ? <>
      {" · "}<time dateTime={publication.lastPublishedAt}>
        {new Date(publication.lastPublishedAt).toLocaleString("en-SG", {
          timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        })}
      </time>
    </> : null}
  </p>;
}
