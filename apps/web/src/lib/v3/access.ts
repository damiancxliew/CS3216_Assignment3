import type { Viewer } from "@/lib/auth/viewer";

/** Authoring access is distinct from student visibility of published adventures. */
export function canAccessV3Authoring(viewer: Viewer, row: { ownerId: string; schoolId: string }): boolean {
  if (!viewer.user) return false;
  if (viewer.isSysadmin) return true;
  return viewer.membership?.role !== "student" &&
    (row.ownerId === viewer.user.id ||
      (viewer.membership?.role === "admin" && viewer.membership.organizationId === row.schoolId));
}
