import { v3SchoolAllowed } from "@/lib/v3/flag";

import type { V3Adventure, V3PlayStore } from "./store";

export async function canStaffAdventure(
  store: V3PlayStore,
  adventure: V3Adventure,
  userId: string,
  env?: NodeJS.ProcessEnv,
): Promise<boolean> {
  return (
    v3SchoolAllowed(adventure.schoolId, env) &&
    (adventure.ownerId === userId || (await store.isSchoolAdmin(adventure.schoolId, userId)))
  );
}
