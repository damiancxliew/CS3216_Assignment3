import type { V3Adventure, V3PlayStore } from "./store";

export async function canStaffAdventure(
  store: V3PlayStore,
  adventure: V3Adventure,
  userId: string,
): Promise<boolean> {
  return adventure.ownerId === userId ||
    await store.isSchoolAdmin(adventure.schoolId, userId) ||
    !!(await store.isPlatformAdmin?.(userId));
}
