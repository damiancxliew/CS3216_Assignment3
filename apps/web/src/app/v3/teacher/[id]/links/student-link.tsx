"use client";
import { Check, Copy } from "lucide-react";
import { createPortal } from "react-dom";
import { useId, useState } from "react";
import { button } from "@/components/ui";
export function CopyStudentLink({ path }: { path: string }) {
  const [message, setMessage] = useState("");
  return (
    <div>
      <button
        type="button"
        className={button.subtle + " !h-9 !w-9 !min-w-0 !p-0"}
        aria-label={message === "Copied" ? "Copied" : "Copy link"}
        title={message === "Copied" ? "Copied" : "Copy link"}
        onClick={async () => {
          const url = new URL(path, window.location.origin).href;
          try {
            await navigator.clipboard.writeText(url);
            setMessage("Copied");
          } catch {
            setMessage("Could not copy. Use Open link.");
          }
        }}
      >
        {message === "Copied" ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
      </button>
      <span
        role="status"
        className={message === "Copied" ? "sr-only" : "text-sm text-muted"}
      >
        {message}
      </span>
    </div>
  );
}

/** Keep long release URLs out of the layout, available on hover and focus. */
export function ReleaseLink({ path, url }: { path: string; url: string }) {
  const id = useId();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const show = (element: HTMLAnchorElement) => {
    const rect = element.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
    });
  };
  return (
    <>
      <a
        href={path}
        aria-describedby={position ? id : undefined}
        className="whitespace-nowrap text-sm underline underline-offset-4"
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => setPosition(null)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setPosition(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setPosition(null);
        }}
      >
        Open link
      </a>
      {position
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              style={position}
              className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-1rem)] break-all rounded-lg border border-line bg-surface p-3 text-xs text-ink shadow-lg"
            >
              {url}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
