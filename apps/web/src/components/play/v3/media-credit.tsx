import type { MediaSnapshot } from "@adventure/spec-v3";
export function MediaCredit({
  media,
  caption = false,
}: {
  media: MediaSnapshot | undefined;
  caption?: boolean;
}) {
  if (!media) return null;
  return (
    <span className="block text-xs [overflow-wrap:anywhere]">
      {caption ? <span className="block">{media.caption}</span> : null}
      {media.origin === "ai" ? "AI-generated illustration" : media.credit}
      {media.sourceUrl ? (
        <>
          {" "}
          ·{" "}
          <a
            className="underline"
            href={media.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Source
          </a>
        </>
      ) : null}
      {media.licence ? (
        <>
          {" "}
          ·{" "}
          {media.licence.url ? (
            <a
              className="underline"
              href={media.licence.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {media.licence.label}
            </a>
          ) : (
            media.licence.label
          )}
        </>
      ) : null}
    </span>
  );
}
