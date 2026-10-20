"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { compactButton as button } from "@/components/ui";
import { reviewPrimary } from "../creation-styles";

type Proposal<T> = { ok: true; notes: string } & T;
/** A proposal is tied to the exact edits it was requested for. */
export function AiFixPanel<T>({
  revision,
  request,
  apply,
  disabled = false,
  floating = true,
}: {
  revision: string;
  request: () => Promise<
    Proposal<T> | { ok: false; message: string } | { error: string }
  >;
  apply: (proposal: Proposal<T>) => void;
  disabled?: boolean;
  floating?: boolean;
}) {
  const [proposal, setProposal] = useState<{
    revision: string;
    value: Proposal<T>;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setProposal(null);
    setMessage("");
  }, [revision]);
  const current = proposal?.revision === revision ? proposal.value : null;
  return (
    <section
      className={
        floating
          ? "fixed bottom-5 right-4 z-40 flex w-fit max-w-[calc(100vw-2rem)] flex-col-reverse items-end gap-3 sm:right-6"
          : "space-y-3"
      }
      aria-label="Issue suggestions"
      aria-busy={pending}
    >
      <button
        type="button"
        className={
          floating
            ? "inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-ink px-4 py-3 text-sm font-semibold text-paper shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
            : button.quiet
        }
        disabled={disabled || pending}
        onClick={async () => {
          const requested = generation.current;
          setPending(true);
          setProposal(null);
          setMessage("");
          try {
            const result = await request();
            if (generation.current !== requested) return;
            if ("ok" in result && result.ok)
              setProposal({ revision, value: result });
            else setMessage("error" in result ? result.error : result.message);
          } catch {
            if (generation.current === requested)
              setMessage(
                "Could not prepare a suggestion. Your edits are still here. Try Resolve issues again.",
              );
          } finally {
            setPending(false);
          }
        }}
      >
        <Sparkles
          size={16}
          aria-hidden
          className={pending ? "motion-safe:animate-pulse" : ""}
        />
        {pending ? "Reviewing…" : "Resolve issues"}
      </button>
      {current || message ? (
        <div
          className="w-80 max-w-full space-y-3 rounded-surface border border-line-strong bg-surface p-4 text-ink shadow-lg"
          aria-label="Suggested correction"
        >
          {current ? (
            <div className="space-y-3">
              <p role="status">{current.notes}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={reviewPrimary}
                  disabled={disabled}
                  onClick={() => {
                    apply(current);
                    setProposal(null);
                    setMessage("Applied to the cards.");
                  }}
                >
                  Apply suggested fix
                </button>
                <button
                  type="button"
                  className={button.subtle}
                  onClick={() => {
                    setProposal(null);
                    setMessage("");
                  }}
                >
                  Keep my edits
                </button>
              </div>
            </div>
          ) : null}
          {message ? (
            <div className="flex items-start gap-3">
              <p role="status" className="text-sm">
                {message}
              </p>
              <button
                type="button"
                aria-label="Dismiss suggestion"
                className="shrink-0 rounded p-1 hover:bg-sunken"
                onClick={() => setMessage("")}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
