"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the server-rendered asset rows fresh while artwork is in flight:
 * re-renders the page every few seconds until nothing is `pending` any more.
 * Renders nothing itself.
 */
export function ArtworkPoller({ pending }: { pending: number; generated: number }) {
  const router = useRouter();
  useEffect(() => {
    if (pending <= 0) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
