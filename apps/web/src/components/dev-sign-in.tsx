"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { button, control, ErrorText, Pending } from "@/components/ui";
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
    <details className="text-base">
      <summary className="cursor-pointer text-muted hover:text-ink">Local dev sign-in (email/password)</summary>
      <form action={submit} className="flex max-w-sm flex-col gap-2 pt-3">
        <input name="email" type="email" required defaultValue="teacher@local.test" className={control} />
        <input name="password" type="password" required minLength={6} defaultValue="password123!" className={control} />
        <button type="submit" disabled={pending} className={`${button.quiet} w-fit`}>
          {pending ? <Pending>Signing in…</Pending> : "Sign in or create account"}
        </button>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <p className="text-sm text-muted">Only rendered in `next dev`. Unknown emails are created on the spot.</p>
      </form>
    </details>
  );
}
