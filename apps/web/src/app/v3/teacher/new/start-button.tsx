"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { button, ErrorText, Pending } from "@/components/ui";

import { startV3Brief } from "../actions";

/** Start on navigation, never on a server render or a prefetched link. */
export function StartBriefRedirect() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<ReturnType<typeof startV3Brief> | null>(null);
  useEffect(() => {
    let cancelled = false;
    // React's development effect replay must subscribe to the same request.
    request.current ??= startV3Brief();
    void request.current.then((result) => {
      if (cancelled) return;
      if ("adventureId" in result) router.replace(`/v3/teacher/${result.adventureId}`);
      else setError("Couldn’t open the workspace. Please try again.");
    }).catch(() => {
      if (!cancelled) setError("Couldn’t open the workspace. Check your connection and try again.");
    });
    return () => { cancelled = true; };
  }, [attempt, router]);
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center gap-4 p-5">
      {error ? <>
        <ErrorText>{error}</ErrorText>
        <button type="button" className={button.primary} onClick={() => {
          request.current = null;
          setError(null);
          setAttempt(value => value + 1);
        }}>Try again</button>
      </> : <p role="status"><Pending>Opening workspace…</Pending></p>}
    </main>
  );
}
