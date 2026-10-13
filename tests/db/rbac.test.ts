import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  addMember,
  createOrganization,
  createUserClient,
  serviceClient,
  uniqueEmail,
} from "./helpers";

const admin = serviceClient();
const PASSWORD = "password123!";

type User = { client: SupabaseClient; userId: string; email: string };
type Adventure = { id: string; shareToken: string };

async function createMember(organizationId: string, role: "admin" | "teacher" | "student"): Promise<User> {
  const email = uniqueEmail(`rbac-${role}`);
  const user = await createUserClient(email, PASSWORD);
  await addMember(organizationId, user.userId, role);
  return { ...user, email };
}

async function createPublishedAdventure(
  ownerId: string,
  organizationId: string,
  title = "School adventure",
): Promise<Adventure> {
  const { data: adventure, error } = await admin
    .from("adventure")
    .insert({
      owner_id: ownerId,
      organization_id: organizationId,
      title,
      status: "draft",
      allow_retries: true,
    })
    .select("id, share_token")
    .single();
  if (error) throw error;

  const { error: versionError } = await admin
    .from("spec_version")
    .insert({ adventure_id: adventure.id, version: 1, json: {}, generator_version: "rbac-test" })
    .select("id");
  if (versionError) throw versionError;

  const { error: publishError } = await admin
    .from("adventure")
    .update({ status: "published", published_version: 1 })
    .eq("id", adventure.id);
  if (publishError) throw publishError;

  return { id: adventure.id, shareToken: adventure.share_token };
}

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let orgA: string;
let orgB: string;
let adminA: User;
let teacherA: User;
let secondTeacherA: User;
let studentA: User;
let adminB: User;
let teacherB: User;

beforeAll(async () => {
  orgA = await createOrganization("RBAC School A");
  orgB = await createOrganization("RBAC School B");
  adminA = await createMember(orgA, "admin");
  teacherA = await createMember(orgA, "teacher");
  secondTeacherA = await createMember(orgA, "teacher");
  studentA = await createMember(orgA, "student");
  adminB = await createMember(orgB, "admin");
  teacherB = await createMember(orgB, "teacher");
});

describe("adventure authoring", () => {
  it("requires staff membership and defaults the adventure to the owner's school", async () => {
    const unassigned = await createUserClient(uniqueEmail("rbac-unassigned"), PASSWORD);
    const denied = await unassigned.client.from("adventure")
      .insert({ owner_id: unassigned.userId, title: "No school" });
    expect(denied.error?.code).toBe("42501");

    const { data, error } = await teacherA.client
      .from("adventure")
      .insert({ owner_id: teacherA.userId, title: "Default school" })
      .select("organization_id")
      .single();
    expect(error).toBeNull();
    expect(data?.organization_id).toBe(orgA);

    const student = await createMember(orgA, "student");
    const studentInsert = await student.client
      .from("adventure")
      .insert({ owner_id: student.userId, title: "Student-authored" });
    expect(studentInsert.error?.code).toBe("42501");
  });

  it("does not let a teacher author into another organization", async () => {
    const { error } = await teacherA.client
      .from("adventure")
      .insert({ owner_id: teacherA.userId, organization_id: orgB, title: "Wrong school" });
    expect(error?.code).toBe("42501");
  });

  it("denies an unaffiliated user from inserting into a school", async () => {
    const outsider = await createUserClient(uniqueEmail("rbac-no-school"), PASSWORD);
    const { error } = await outsider.client.from("adventure")
      .insert({ owner_id: outsider.userId, organization_id: orgA, title: "Outsider adventure" });
    expect(error?.code).toBe("42501");
  });

  it("does not let students manage staff", async () => {
    expect((await studentA.client.rpc("invite_staff", {
      p_org: orgA,
      p_email: uniqueEmail("blocked-invite"),
      p_role: "teacher",
    })).error?.code).toBe("42501");
    expect((await studentA.client.rpc("set_member_role", {
      p_org: orgA,
      p_user: teacherA.userId,
      p_role: "admin",
    })).error?.code).toBe("42501");
  });
});

describe("authorization fails closed without school membership", () => {
  it("denies strangers and staff from another school across school-management RPCs", async () => {
    const outsiderEmail = uniqueEmail("rbac-unaffiliated");
    const outsider = await createUserClient(outsiderEmail, PASSWORD);
    const { data: linkRows, error: linkError } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    expect(linkError).toBeNull();
    const link = (linkRows as { id: string }[])[0]!;
    const callers = [
      { user: outsider, email: outsiderEmail },
      { user: teacherB, email: teacherB.email },
      { user: adminB, email: adminB.email },
    ];

    for (const { user, email } of callers) {
      expect((await user.client.rpc("create_school_join_link", {
        p_org: orgA,
        p_ttl_seconds: 3600,
      })).error?.code).toBe("42501");
      expect((await user.client.rpc("revoke_school_join_link", {
        p_link_id: link.id,
      })).error?.code).toBe("42501");
      expect((await user.client.rpc("remove_student", {
        p_org: orgA,
        p_user: studentA.userId,
      })).error?.code).toBe("42501");
      expect((await user.client.rpc("restore_student", {
        p_org: orgA,
        p_user: studentA.userId,
      })).error?.code).toBe("42501");
      expect((await user.client.rpc("invite_staff", {
        p_org: orgA,
        p_email: email,
        p_role: "admin",
      })).error?.code).toBe("42501");
      expect((await user.client.rpc("set_member_role", {
        p_org: orgA,
        p_user: studentA.userId,
        p_role: "admin",
      })).error?.code).toBe("42501");
      expect((await user.client.rpc("remove_staff_member", {
        p_org: orgA,
        p_user: teacherA.userId,
      })).error?.code).toBe("42501");
    }

    const { data: outsiderMemberships, error: membershipError } = await admin.from("organization_member")
      .select("user_id")
      .eq("user_id", outsider.userId);
    expect(membershipError).toBeNull();
    expect(outsiderMemberships).toEqual([]);
  });
});

describe("school links and enrollment", () => {
  it("allows staff to create bounded-TTL links, and exposes previews without enrolling", async () => {
    const { data, error } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    expect(error).toBeNull();
    const link = (data as { id: string; token: string; expires_at: string }[])[0]!;
    expect(link.id).toBeTruthy();

    for (const ttl of [299, 2592001]) {
      const invalid = await teacherA.client.rpc("create_school_join_link", {
        p_org: orgA,
        p_ttl_seconds: ttl,
      });
      expect(invalid.error?.code).toBe("22023");
    }
    expect((await studentA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    })).error?.code).toBe("42501");

    const { data: preview, error: previewError } = await anonClient()
      .rpc("school_link_preview", { p_token: link.token })
      .single();
    expect(previewError).toBeNull();
    expect(preview).toMatchObject({ organization_id: orgA, name: "RBAC School A" });
  });

  it("normalizes, renames, and clears staff-only link names", async () => {
    const { data: namedRows, error: namedError } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
      p_name: "  3B History  ",
    });
    expect(namedError).toBeNull();
    const named = (namedRows as { id: string; name: string }[])[0]!;
    expect(named.name).toBe("3B History");

    const { data: unnamedRows, error: unnamedError } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    expect(unnamedError).toBeNull();
    expect((unnamedRows as { name: string | null }[])[0]!.name).toBeNull();

    const { data: blankRows, error: blankError } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
      p_name: "   ",
    });
    expect(blankError).toBeNull();
    expect((blankRows as { name: string | null }[])[0]!.name).toBeNull();

    const renamed = await teacherA.client.rpc("rename_school_join_link", {
      p_link_id: named.id,
      p_name: "  World History  ",
    });
    expect(renamed.error).toBeNull();
    const { data: renamedRow, error: renamedReadError } = await teacherA.client.from("organization_join_link")
      .select("name")
      .eq("id", named.id)
      .single();
    expect(renamedReadError).toBeNull();
    expect(renamedRow?.name).toBe("World History");

    const cleared = await teacherA.client.rpc("rename_school_join_link", {
      p_link_id: named.id,
      p_name: "   ",
    });
    expect(cleared.error).toBeNull();
    const { data: clearedRow, error: clearedReadError } = await teacherA.client.from("organization_join_link")
      .select("name")
      .eq("id", named.id)
      .single();
    expect(clearedReadError).toBeNull();
    expect(clearedRow?.name).toBeNull();

    const tooLong = "x".repeat(81);
    expect((await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
      p_name: tooLong,
    })).error?.code).toBe("22023");
    expect((await teacherA.client.rpc("rename_school_join_link", {
      p_link_id: named.id,
      p_name: tooLong,
    })).error?.code).toBe("22023");

    expect((await studentA.client.rpc("rename_school_join_link", {
      p_link_id: named.id,
      p_name: "Student edit",
    })).error?.code).toBe("42501");
    expect((await adminB.client.rpc("rename_school_join_link", {
      p_link_id: named.id,
      p_name: "Other school edit",
    })).error?.code).toBe("42501");
  });

  it("enrolls from a valid link, treats re-enrollment as a no-op, and rejects expired or revoked links", async () => {
    const { data: linkRows } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    const link = (linkRows as { id: string; token: string }[])[0]!;
    const enrolling = await createUserClient(uniqueEmail("rbac-enroll"), PASSWORD);
    expect((await enrolling.client.rpc("enroll_with_school_token", { p_token: link.token })).data).toBe(orgA);
    expect((await enrolling.client.rpc("enroll_with_school_token", { p_token: link.token })).data).toBe(orgA);
    const { data: membership } = await admin.from("organization_member")
      .select("role, status")
      .eq("organization_id", orgA)
      .eq("user_id", enrolling.userId)
      .single();
    expect(membership).toEqual({ role: "student", status: "active" });

    const { data: expiredRows } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    const expired = (expiredRows as { id: string; token: string }[])[0]!;
    const expiredAt = new Date(Date.now() - 1000);
    const { error: expireError } = await admin.from("organization_join_link")
      .update({
        created_at: new Date(expiredAt.getTime() - 60_000).toISOString(),
        expires_at: expiredAt.toISOString(),
      })
      .eq("id", expired.id);
    expect(expireError).toBeNull();
    expect((await enrolling.client.rpc("enroll_with_school_token", { p_token: expired.token })).error?.code).toBe("P0002");

    const { data: revokedRows } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    const revoked = (revokedRows as { id: string; token: string }[])[0]!;
    expect((await teacherA.client.rpc("revoke_school_join_link", { p_link_id: revoked.id })).error).toBeNull();
    expect((await enrolling.client.rpc("enroll_with_school_token", { p_token: revoked.token })).error?.code).toBe("P0002");
  });

  it("does not allow enrollment in a second active school", async () => {
    const { data: linkRows } = await adminB.client.rpc("create_school_join_link", {
      p_org: orgB,
      p_ttl_seconds: 3600,
    });
    const link = (linkRows as { token: string }[])[0]!;
    expect((await studentA.client.rpc("enroll_with_school_token", { p_token: link.token })).error?.code).toBe("23505");
  });
});

describe("membership management", () => {
  it("removes students from play, preserves their old reads, and restores their membership", async () => {
    const target = await createMember(orgA, "student");
    const adventure = await createPublishedAdventure(teacherA.userId, orgA);
    const { data: attemptId, error: joinError } = await target.client.rpc("join_adventure", {
      p_token: adventure.shareToken,
    });
    expect(joinError).toBeNull();

    const { data: linkRows } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    const link = (linkRows as { token: string }[])[0]!;
    expect((await teacherA.client.rpc("remove_student", {
      p_org: orgA,
      p_user: target.userId,
    })).error).toBeNull();

    expect((await target.client.rpc("enroll_with_school_token", { p_token: link.token })).error?.code).toBe("42501");
    expect((await target.client.rpc("start_adventure", { p_adventure_id: adventure.id })).error?.code).toBe("42501");
    expect((await target.client.rpc("join_adventure", { p_token: adventure.shareToken })).error?.code).toBe("42501");
    expect((await target.client.rpc("restart_attempt", { p_attempt_id: attemptId })).error?.code).toBe("42501");

    const { data: oldAttempt } = await target.client.from("attempt").select("id").eq("id", attemptId);
    const { data: oldState } = await target.client.from("attempt_state").select("attempt_id").eq("attempt_id", attemptId);
    expect(oldAttempt).toHaveLength(1);
    expect(oldState).toHaveLength(1);

    expect((await teacherA.client.rpc("restore_student", {
      p_org: orgA,
      p_user: target.userId,
    })).error).toBeNull();
    const { data: restored } = await admin.from("organization_member")
      .select("status, removed_at, removed_by")
      .eq("organization_id", orgA)
      .eq("user_id", target.userId)
      .single();
    expect(restored).toEqual({ status: "active", removed_at: null, removed_by: null });
  });

  it("restricts staff removal and preserves at least one active admin", async () => {
    expect((await teacherA.client.rpc("remove_student", {
      p_org: orgA,
      p_user: secondTeacherA.userId,
    })).error?.code).toBe("42501");
    expect((await teacherA.client.rpc("remove_staff_member", {
      p_org: orgA,
      p_user: secondTeacherA.userId,
    })).error?.code).toBe("42501");

    expect((await adminA.client.rpc("set_member_role", {
      p_org: orgA,
      p_user: adminA.userId,
      p_role: "teacher",
    })).error?.code).toBe("P0001");
    expect((await adminA.client.rpc("remove_staff_member", {
      p_org: orgA,
      p_user: adminA.userId,
    })).error?.code).toBe("P0001");
  });
});

describe("organization oversight and play access", () => {
  it("gives same-school admins read-only access to teacher adventures and attempts", async () => {
    const adventure = await createPublishedAdventure(teacherA.userId, orgA, "Oversight target");
    const { data: attemptId, error } = await studentA.client.rpc("join_adventure", {
      p_token: adventure.shareToken,
    });
    expect(error).toBeNull();

    const { data: visibleAdventure } = await adminA.client.from("adventure")
      .select("id")
      .eq("id", adventure.id);
    const { data: visibleAttempt } = await adminA.client.from("attempt")
      .select("id")
      .eq("id", attemptId);
    const { data: visibleState } = await adminA.client.from("attempt_state")
      .select("attempt_id")
      .eq("attempt_id", attemptId);
    expect(visibleAdventure).toHaveLength(1);
    expect(visibleAttempt).toHaveLength(1);
    expect(visibleState).toHaveLength(1);

    const update = await adminA.client.from("adventure")
      .update({ title: "Admin edit" })
      .eq("id", adventure.id)
      .select("id");
    expect(update.data).toHaveLength(0);
    const { data: visibleToOtherSchool } = await adminB.client.from("adventure")
      .select("id")
      .eq("id", adventure.id);
    expect(visibleToOtherSchool).toHaveLength(0);
  });

  it("requires school membership to join a share link, but permits platform admins", async () => {
    const adventure = await createPublishedAdventure(teacherA.userId, orgA, "Share access");
    const outsider = await createUserClient(uniqueEmail("rbac-outsider"), PASSWORD);
    expect((await outsider.client.rpc("join_adventure", { p_token: adventure.shareToken })).error?.code).toBe("42501");

    const platformUser = await createUserClient(uniqueEmail("rbac-platform-admin"), PASSWORD);
    const { error: grantError } = await admin.from("platform_admin").insert({ user_id: platformUser.userId });
    expect(grantError).toBeNull();
    const { data: attemptId, error } = await platformUser.client.rpc("join_adventure", {
      p_token: adventure.shareToken,
    });
    expect(error).toBeNull();
    expect(attemptId).toBeTruthy();
  });

  it("claims staff invitations on account creation and adds existing users immediately", async () => {
    const invitedEmail = uniqueEmail("rbac-invited-staff");
    const invited = await adminA.client.rpc("invite_staff", {
      p_org: orgA,
      p_email: ` ${invitedEmail.toUpperCase()} `,
      p_role: "teacher",
    });
    expect(invited.data).toBe("invited");

    const created = await createUserClient(invitedEmail, PASSWORD);
    const { data: claimed } = await admin.from("organization_member")
      .select("role, status")
      .eq("organization_id", orgA)
      .eq("user_id", created.userId)
      .single();
    expect(claimed).toEqual({ role: "teacher", status: "active" });
    const { data: invite } = await admin.from("organization_invite")
      .select("accepted_at, accepted_by")
      .eq("organization_id", orgA)
      .eq("email", invitedEmail.toLowerCase())
      .single();
    expect(invite?.accepted_at).toBeTruthy();
    expect(invite?.accepted_by).toBe(created.userId);

    const existing = await createUserClient(uniqueEmail("rbac-existing-staff"), PASSWORD);
    const existingEmail = (await admin.auth.admin.getUserById(existing.userId)).data.user!.email!;
    const added = await adminA.client.rpc("invite_staff", {
      p_org: orgA,
      p_email: existingEmail,
      p_role: "admin",
    });
    expect(added.data).toBe("added");
    const { data: existingMember } = await admin.from("organization_member")
      .select("role, status")
      .eq("organization_id", orgA)
      .eq("user_id", existing.userId)
      .single();
    expect(existingMember).toEqual({ role: "admin", status: "active" });
  });

  it("lists only published adventures from the caller's school and reports their latest attempt", async () => {
    const schoolAdventure = await createPublishedAdventure(teacherA.userId, orgA, "Library A");
    await createPublishedAdventure(adminB.userId, orgB, "Library B");

    const { data: attemptId, error } = await studentA.client.rpc("join_adventure", {
      p_token: schoolAdventure.shareToken,
    });
    expect(error).toBeNull();

    const { data: library, error: libraryError } = await studentA.client.rpc("list_library");
    expect(libraryError).toBeNull();
    expect(library).toContainEqual(expect.objectContaining({
      adventure_id: schoolAdventure.id,
      organization_id: orgA,
      latest_attempt_id: attemptId,
      latest_attempt_status: "active",
    }));
    expect((library as { adventure_id: string; organization_id: string }[]).every((entry) => entry.organization_id === orgA)).toBe(true);
  });

  it("does not expose can_play_adventure to authenticated clients", async () => {
    const result = await studentA.client.rpc("can_play_adventure", {
      p_adventure_id: "00000000-0000-4000-8000-000000000001",
      p_user: studentA.userId,
    });
    expect(result.error).not.toBeNull();
  });

  it("does not expose internal helpers or authenticated-only RPCs to anon", async () => {
    const claim = await studentA.client.rpc("_claim_staff_invites", {
      p_user: studentA.userId,
      p_email: "someone-else@example.test",
    });
    expect(claim.error?.code).toBe("42501");

    const admit = await studentA.client.rpc("_admit_to_adventure", {
      p_adventure: {
        id: "00000000-0000-4000-8000-000000000001",
        allow_retries: true,
      },
      p_student: studentA.userId,
    });
    expect(admit.error?.code).toBe("42501");

    const start = await studentA.client.rpc("start_attempt", {
      p_adventure_id: "00000000-0000-4000-8000-000000000001",
      p_student: studentA.userId,
    });
    expect(start.error?.code).toBe("42501");

    const { data: linkRows, error: linkError } = await teacherA.client.rpc("create_school_join_link", {
      p_org: orgA,
      p_ttl_seconds: 3600,
    });
    expect(linkError).toBeNull();
    const link = (linkRows as { token: string }[])[0]!;
    const anonEnroll = await anonClient().rpc("enroll_with_school_token", {
      p_token: link.token,
    });
    expect(anonEnroll.error?.code).toBe("42501");
  });
});
