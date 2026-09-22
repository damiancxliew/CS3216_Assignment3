"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Email/password sign-in for local development only, where Google is not
 * enabled in the Supabase stack (`[auth.external.google] enabled = false`).
 * Local auth has confirmations off, so an unknown email is simply signed up.
 * `NODE_ENV` is inlined at build time, so this never reaches a production bundle.
 */
export function DevSignIn({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (process.env.NODE_ENV !== "development") return null;

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    let { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error?.message === "Invalid login credentials") {
      ({ error } = await supabase.auth.signUp({ email, password }));
    }
    if (error) {
      setError(error.message);
      setPending(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer opacity-60">Local dev sign-in (email/password)</summary>
      <form action={submit} className="flex flex-col gap-2 pt-3">
        <input
          name="email"
          type="email"
          required
          defaultValue="teacher@local.test"
          className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground dark:border-white/20"
        />
        <input
          name="password"
          type="password"
          required
          minLength={6}
          defaultValue="password123!"
          className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground dark:border-white/20"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-fit items-center rounded-full border border-black/15 px-4 py-1.5 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          {pending ? "Signing in…" : "Sign in or create account"}
        </button>
        {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : null}
        <p className="text-xs opacity-50">Only rendered in `next dev`. Unknown emails are created on the spot.</p>
      </form>
    </details>
  );
}
