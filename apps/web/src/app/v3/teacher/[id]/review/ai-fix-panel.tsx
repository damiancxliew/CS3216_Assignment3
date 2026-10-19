"use client";
import { useEffect, useRef, useState } from "react";
import { compactButton as button } from "@/components/ui";

type Proposal<T> = { ok: true; notes: string } & T;
/** A proposal is tied to the exact edits it was requested for. */
export function AiFixPanel<T>({
  revision,
  request,
  apply,
  disabled = false,
}: {
  revision: string;
  request: () => Promise<
    Proposal<T> | { ok: false; message: string } | { error: string }
  >;
  apply: (proposal: Proposal<T>) => void;
  disabled?: boolean;
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
  }, [revision]);
  const current = proposal?.revision === revision ? proposal.value : null;
  return (
    <section
      className="space-y-3 rounded-surface border border-line bg-surface p-4"
      aria-label="Fix with AI"
      aria-busy={pending}
    >
      <button
        type="button"
        className={button.quiet}
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
                "Could not request a fix. Your edits are still here. Try Fix with AI again.",
              );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Preparing suggestion…" : "Fix with AI"}
      </button>
      {current ? (
        <div className="space-y-3">
          <p role="status">{current.notes}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button.primary}
              disabled={disabled}
              onClick={() => {
                apply(current);
                setProposal(null);
                setMessage(
                  "Suggestion applied. Review your edits before continuing.",
                );
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
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
