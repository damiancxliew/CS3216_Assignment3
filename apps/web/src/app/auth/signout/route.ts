import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/auth/request-origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", requestOrigin(request)), {
    status: 303,
  });
}
