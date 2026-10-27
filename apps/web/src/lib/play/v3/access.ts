import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";

import type { V3Adventure, V3PlayStore } from "./store";

export async function canStaffAdventure(
  store: V3PlayStore,
  adventure: V3Adventure,
  userId: string,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (v3SchoolAllowed(adventure.schoolId, env))
    return adventure.ownerId === userId || await store.isSchoolAdmin(adventure.schoolId, userId);
  return v3Enabled(env) && !!(await store.isPlatformAdmin?.(userId));
}
