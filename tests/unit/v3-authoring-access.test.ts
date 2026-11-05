import { describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/auth/viewer";
import { canAccessV3Authoring } from "@/lib/v3/access";
import { canStaffAdventure } from "@/lib/play/v3/access";
import { MemoryV3PlayStore } from "@/lib/play/v3/store";

describe("v3 authoring roles", () => {
  const row = { ownerId: "owner", schoolId: "school" };
  const viewer = (role: "teacher" | "admin" | "student", school = "school", sysadmin = false): Viewer => ({ user: { id: "other-user" } as Viewer["user"], membership: { role, organizationId: school, organizationName: "School", slug: "school" }, isSysadmin: sysadmin });

  it("allows staff authoring by default while retaining ownership and school boundaries", () => {
    expect(canAccessV3Authoring({ ...viewer("teacher"), user: { id: "owner" } as Viewer["user"] }, row)).toBe(true);
    expect(canAccessV3Authoring(viewer("admin"), row)).toBe(true);
    expect(canAccessV3Authoring(viewer("admin", "elsewhere"), row)).toBe(false);
    expect(canAccessV3Authoring(viewer("teacher"), row)).toBe(false);
    expect(canAccessV3Authoring(viewer("student"), row)).toBe(false);
  });
  it("limits school admins to their school and teachers to their own adventures", () => {
    expect(canAccessV3Authoring(viewer("admin"), row)).toBe(true);
    expect(canAccessV3Authoring(viewer("admin", "elsewhere"), row)).toBe(false);
    expect(canAccessV3Authoring(viewer("teacher"), row)).toBe(false);
    expect(canAccessV3Authoring(viewer("student"), row)).toBe(false);
  });
  it("allows system admins without membership to author across schools", async () => {
    expect(canAccessV3Authoring({ ...viewer("teacher", "elsewhere", true), membership: null }, row)).toBe(true);
    const store = new MemoryV3PlayStore(); store.addPlatformAdmin("system-admin");
    const adventure = { id: "a", ...row, status: "draft", specVersion: 1, spec: null };
    expect(await canStaffAdventure(store, adventure, "system-admin")).toBe(true);
    expect(await canStaffAdventure(store, adventure, "school-admin")).toBe(false);
  });
});
