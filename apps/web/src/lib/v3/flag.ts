export function v3Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.V3_ENABLED || env.V3_ENABLED === "1" || env.V3_ENABLED === "true";
}

export function v3SchoolAllowed(schoolId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!v3Enabled(env) || !schoolId.trim()) return false;
  const schools = (env.V3_SCHOOL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return schools.length === 0 || schools.includes(schoolId);
}
