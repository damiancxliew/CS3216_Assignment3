import { it } from "vitest";

import { serviceClient } from "../tests/db/helpers";

it("grants or revokes platform administrator access", async () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("ADMIN_EMAIL is required");

  const admin = serviceClient();
  let page = 1;
  let user: { id: string; email?: string } | undefined;
  while (!user) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user || data.users.length < 1000) break;
    page += 1;
  }

  if (!user) throw new Error(`No auth user found for ${email}`);

  if (process.env.ADMIN_REVOKE === "1") {
    const { error } = await admin.from("platform_admin").delete().eq("user_id", user.id);
    if (error) throw error;
    console.log(`Revoked platform administrator access for ${email}.`);
    return;
  }

  const { error } = await admin.from("platform_admin").upsert({ user_id: user.id });
  if (error) throw error;
  console.log(`Granted platform administrator access to ${email}.`);
});
