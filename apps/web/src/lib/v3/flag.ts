export function v3Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.V3_ENABLED === "1" || env.V3_ENABLED === "true";
}

export function v3SchoolAllowed(schoolId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!v3Enabled(env) || !env.V3_SCHOOL_IDS) return false;
  return env.V3_SCHOOL_IDS.split(",").map((id) => id.trim()).filter(Boolean).includes(schoolId);
}

/** Keep Guided creation off until its pause screens are shipped. Public flag also gates the brief chip. */
export function guidedModeEnabled(env?: NodeJS.ProcessEnv): boolean {
  return (env ? env.NEXT_PUBLIC_V3_GUIDED_MODE_ENABLED : process.env.NEXT_PUBLIC_V3_GUIDED_MODE_ENABLED) === "1";
}
