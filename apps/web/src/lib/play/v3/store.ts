import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameEvent } from "@adventure/play-contract";

export interface V3Adventure {
  id: string;
  schoolId: string;
  status: string;
  specVersion: number;
  spec: unknown | null;
}

export interface V3Attempt {
  id: string;
  adventureId: string;
  specVersion: number;
  studentId: string;
  state: unknown;
  revision: number;
  schoolId: string;
}

export interface V3FlagInput {
  messageId: string;
  category: string;
  excerpt: string;
  result: { reason: string | null; characterId: string; stageIndex: number };
}

export interface V3PlayStore {
  loadAdventure(id: string): Promise<V3Adventure | null>;
  loadVersionSpec(adventureId: string, version: number): Promise<unknown | null>;
  isActiveMember(schoolId: string, userId: string): Promise<boolean>;
  findLatestAttempt(adventureId: string, studentId: string): Promise<V3Attempt | null>;
  createAttempt(input: {
    adventureId: string;
    specVersion: number;
    studentId: string;
    state: unknown;
  }): Promise<{ id: string; revision: 0 }>;
  loadAttempt(id: string): Promise<V3Attempt | null>;
  save(
    id: string,
    expectedRevision: number,
    state: unknown,
    events: GameEvent[],
    flags?: readonly V3FlagInput[],
  ): Promise<{ saved: boolean; revision: number | null }>;
  tokensUsed(attemptId: string): Promise<number>;
}

type AdventureRow = {
  id: string;
  school_id: string;
  status: string;
  spec_version: number;
  spec: unknown | null;
};

type AttemptRow = {
  id: string;
  adventure_id: string;
  spec_version: number;
  student_id: string;
  state: unknown;
  revision: number;
};

export class SupabaseV3PlayStore implements V3PlayStore {
  constructor(private readonly admin: SupabaseClient) {}

  async loadAdventure(id: string): Promise<V3Adventure | null> {
    const { data, error } = await this.admin
      .from("adventures_v3")
      .select("id, school_id, status, spec_version, spec")
      .eq("id", id)
      .maybeSingle<AdventureRow>();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      schoolId: data.school_id,
      status: data.status,
      specVersion: data.spec_version,
      spec: data.spec,
    };
  }

  async loadVersionSpec(adventureId: string, version: number): Promise<unknown | null> {
    const { data, error } = await this.admin
      .from("adventure_versions_v3")
      .select("spec")
      .eq("adventure_id", adventureId)
      .eq("version", version)
      .maybeSingle<{ spec: unknown }>();
    if (error) throw error;
    return data?.spec ?? null;
  }

  async isActiveMember(schoolId: string, userId: string): Promise<boolean> {
    const [membership, platformAdmin] = await Promise.all([
      this.admin
        .from("organization_member")
        .select("user_id")
        .eq("organization_id", schoolId)
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1),
      this.admin
        .from("platform_admin")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1),
    ]);
    if (membership.error) throw membership.error;
    if (platformAdmin.error) throw platformAdmin.error;
    return (membership.data?.length ?? 0) > 0 || (platformAdmin.data?.length ?? 0) > 0;
  }

  async findLatestAttempt(adventureId: string, studentId: string): Promise<V3Attempt | null> {
    const { data, error } = await this.admin
      .from("attempts_v3")
      .select("id, adventure_id, spec_version, student_id, state, revision")
      .eq("adventure_id", adventureId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<AttemptRow>();
    if (error) throw error;
    return data ? this.withSchool(data) : null;
  }

  async createAttempt(input: {
    adventureId: string;
    specVersion: number;
    studentId: string;
    state: unknown;
  }): Promise<{ id: string; revision: 0 }> {
    const { data, error } = await this.admin
      .from("attempts_v3")
      .insert({
        adventure_id: input.adventureId,
        spec_version: input.specVersion,
        student_id: input.studentId,
        state: input.state,
      })
      .select("id, revision")
      .single<{ id: string; revision: 0 }>();
    if (error) throw error;
    return { id: data.id, revision: 0 };
  }

  async loadAttempt(id: string): Promise<V3Attempt | null> {
    const { data, error } = await this.admin
      .from("attempts_v3")
      .select("id, adventure_id, spec_version, student_id, state, revision")
      .eq("id", id)
      .maybeSingle<AttemptRow>();
    if (error) throw error;
    return data ? this.withSchool(data) : null;
  }

  async save(
    id: string,
    expectedRevision: number,
    state: unknown,
    events: GameEvent[],
    flags: readonly V3FlagInput[] = [],
  ): Promise<{ saved: boolean; revision: number | null }> {
    const { data, error } = await this.admin.rpc("save_attempt_v3", {
      p_attempt_id: id,
      p_expected_revision: expectedRevision,
      p_state: state,
      p_events: events.map(({ type, ...payload }) => ({ type, payload })),
      ...(flags.length > 0 ? { p_flags: flags } : {}),
    });
    if (error) throw error;
    const result = data as { saved: boolean; revision: number | null } | null;
    if (!result) throw new Error("save_attempt_v3 returned no result");
    return { saved: result.saved, revision: result.revision };
  }

  async tokensUsed(attemptId: string): Promise<number> {
    const { data, error } = await this.admin.rpc("attempt_v3_tokens", {
      p_attempt_id: attemptId,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  private async withSchool(row: AttemptRow): Promise<V3Attempt | null> {
    const adventure = await this.loadAdventure(row.adventure_id);
    if (!adventure) return null;
    return {
      id: row.id,
      adventureId: row.adventure_id,
      specVersion: row.spec_version,
      studentId: row.student_id,
      state: row.state,
      revision: row.revision,
      schoolId: adventure.schoolId,
    };
  }
}

type MemoryAttempt = Omit<V3Attempt, "schoolId"> & {
  order: number;
  events: GameEvent[];
};

export class MemoryV3PlayStore implements V3PlayStore {
  private readonly adventures = new Map<string, V3Adventure>();
  private readonly versions = new Map<string, unknown>();
  private readonly attempts = new Map<string, MemoryAttempt>();
  private readonly activeMembers = new Set<string>();
  private readonly platformAdmins = new Set<string>();
  private readonly tokenCounts = new Map<string, number>();
  private sequence = 0;
  readonly savedEvents: { attemptId: string; events: GameEvent[] }[] = [];
  readonly flags: ({ attemptId: string } & V3FlagInput)[] = [];

  addAdventure(adventure: V3Adventure): void {
    this.adventures.set(adventure.id, structuredClone(adventure));
    if (adventure.spec !== null) {
      this.addVersionSpec(adventure.id, adventure.specVersion, adventure.spec);
    }
  }

  addVersionSpec(adventureId: string, version: number, spec: unknown): void {
    this.versions.set(`${adventureId}:${version}`, structuredClone(spec));
  }

  addMember(schoolId: string, userId: string, active = true): void {
    const key = `${schoolId}:${userId}`;
    if (active) this.activeMembers.add(key);
    else this.activeMembers.delete(key);
  }

  addPlatformAdmin(userId: string): void {
    this.platformAdmins.add(userId);
  }

  setTokensUsed(attemptId: string, tokens: number): void {
    this.tokenCounts.set(attemptId, tokens);
  }

  async loadAdventure(id: string): Promise<V3Adventure | null> {
    const adventure = this.adventures.get(id);
    return adventure ? structuredClone(adventure) : null;
  }

  async loadVersionSpec(adventureId: string, version: number): Promise<unknown | null> {
    const spec = this.versions.get(`${adventureId}:${version}`);
    return spec === undefined ? null : structuredClone(spec);
  }

  async isActiveMember(schoolId: string, userId: string): Promise<boolean> {
    return this.activeMembers.has(`${schoolId}:${userId}`) || this.platformAdmins.has(userId);
  }

  async findLatestAttempt(adventureId: string, studentId: string): Promise<V3Attempt | null> {
    const latest = [...this.attempts.values()]
      .filter((attempt) => attempt.adventureId === adventureId && attempt.studentId === studentId)
      .sort((a, b) => b.order - a.order)[0];
    return latest ? this.toAttempt(latest) : null;
  }

  async createAttempt(input: {
    adventureId: string;
    specVersion: number;
    studentId: string;
    state: unknown;
  }): Promise<{ id: string; revision: 0 }> {
    const id = crypto.randomUUID();
    this.attempts.set(id, {
      id,
      adventureId: input.adventureId,
      specVersion: input.specVersion,
      studentId: input.studentId,
      state: structuredClone(input.state),
      revision: 0,
      events: [],
      order: ++this.sequence,
    });
    return { id, revision: 0 };
  }

  async loadAttempt(id: string): Promise<V3Attempt | null> {
    const attempt = this.attempts.get(id);
    return attempt ? this.toAttempt(attempt) : null;
  }

  async save(
    id: string,
    expectedRevision: number,
    state: unknown,
    events: GameEvent[],
    flags: readonly V3FlagInput[] = [],
  ): Promise<{ saved: boolean; revision: number | null }> {
    const attempt = this.attempts.get(id);
    if (!attempt) return { saved: false, revision: null };
    if (attempt.revision !== expectedRevision) return { saved: false, revision: attempt.revision };
    attempt.state = structuredClone(state);
    attempt.revision += 1;
    attempt.events.push(...structuredClone(events));
    this.savedEvents.push({ attemptId: id, events: structuredClone(events) });
    for (const flag of flags) {
      if (!this.flags.some((saved) => (
        saved.attemptId === id
        && saved.messageId === flag.messageId
        && saved.category === flag.category
      ))) {
        this.flags.push({ attemptId: id, ...structuredClone(flag) });
      }
    }
    return { saved: true, revision: attempt.revision };
  }

  async tokensUsed(attemptId: string): Promise<number> {
    return this.tokenCounts.get(attemptId) ?? 0;
  }

  private toAttempt(attempt: MemoryAttempt): V3Attempt | null {
    const adventure = this.adventures.get(attempt.adventureId);
    if (!adventure) return null;
    return {
      id: attempt.id,
      adventureId: attempt.adventureId,
      specVersion: attempt.specVersion,
      studentId: attempt.studentId,
      state: structuredClone(attempt.state),
      revision: attempt.revision,
      schoolId: adventure.schoolId,
    };
  }
}
