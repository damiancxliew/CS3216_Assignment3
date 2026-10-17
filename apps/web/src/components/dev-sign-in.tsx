"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { button, control, ErrorText, Pending } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/**
 * Email/password sign-in for local testing, where Google is not enabled.
 * Standalone builds can expose it with NEXT_PUBLIC_DEV_SIGN_IN=true.
 */
export function DevSignIn({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (process.env.NODE_ENV !== "development" && process.env.NEXT_PUBLIC_DEV_SIGN_IN !== "true") return null;

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
      console.error("Local sign-in failed:", error);
      setError("Could not sign in. Check the details and try again.");
      setPending(false);
      return;
    }
    if (process.env.NEXT_PUBLIC_DATA_URL) {
      const { error: syncError } = await supabase.rpc("sync_auth_user");
      if (syncError) {
        console.error("Local auth user sync failed:", syncError);
        setError("Could not sign in. Check the details and try again.");
        setPending(false);
        return;
      }
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
        <p className="text-sm text-muted">For local testing. New email addresses create an account.</p>
      </form>
    </details>
  );
}
