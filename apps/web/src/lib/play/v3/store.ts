import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseJobStore } from "@adventure/jobs";
import { finalCheckErrors, type FinalCheckOutput } from "@/lib/v3/generation/check-errors";
import type { CheckIssue } from "@adventure/spec-v3";
import type { TransferSource } from "@/lib/v3/spec-transfer";
import { GameEvent } from "@adventure/play-contract";

export interface V3Adventure {
  id: string;
  schoolId: string;
  ownerId: string;
  status: string;
  publishedVersion?: number | null;
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

export interface V3Publication {
  linkKey: string;
  version: number;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  publishedBy: string | null;
  publisherName: string | null;
}

export interface V3PlayStore {
  isPlatformAdmin?(userId: string): Promise<boolean>;
  loadVersionContext?(id: string, version: number): Promise<{ sources: TransferSource[]; checkErrors: CheckIssue[] | null } | null>;
  listPublications(id: string): Promise<V3Publication[]>;
  loadAdventure(id: string): Promise<V3Adventure | null>;
  loadCheckErrors(id: string, version?: number): Promise<CheckIssue[]>;
  saveDraft(id: string, expectedVersion: number, spec: unknown): Promise<{ saved: boolean; version?: number }>;
  publishVersion(id: string, expectedVersion: number, expectedPublished: number | null, publish: boolean, selectedVersion?: number, publisherId?: string): Promise<boolean>;
  setAdventureStatus(id: string, status: string): Promise<void>;
  loadVersionSpec(adventureId: string, version: number): Promise<unknown | null>;
  isActiveMember(schoolId: string, userId: string): Promise<boolean>;
  isSchoolAdmin(schoolId: string, userId: string): Promise<boolean>;
  listAttempts(adventureId: string): Promise<{ id: string; specVersion: number; studentId: string }[]>;
  loadEvents(attemptIds: readonly string[]): Promise<Map<string, GameEvent[]>>;
  studentEmail(userId: string): Promise<string | null>;
  findLatestAttempt(adventureId: string, studentId: string, version?: number): Promise<V3Attempt | null>;
  createAttempt(input: {
    adventureId: string;
    specVersion: number;
    studentId: string;
    state: unknown;
    release?: string;
  }): Promise<{ id: string; revision: 0 } | null>;
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
  owner_id: string;
  status: string;
  published_version: number | null;
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

type AttemptSummaryRow = {
  id: string;
  spec_version: number;
  student_id: string;
};

type AttemptEventRow = {
  attempt_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown> | null;
};

export class SupabaseV3PlayStore implements V3PlayStore {
  constructor(private readonly admin: SupabaseClient) {}

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data, error } = await this.admin.from("platform_admin").select("user_id").eq("user_id", userId).limit(1);
    if (error) throw error;
    return !!data?.length;
  }

  async listPublications(id: string): Promise<V3Publication[]> {
    const rows: V3Publication[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.admin.from("adventure_publications_v3")
        .select("version, link_key, first_published_at, last_published_at, published_by, publisher:profile!adventure_publications_v3_published_by_fkey(display_name)").eq("adventure_id", id)
        .order("version", { ascending: false }).range(from, from + 999);
      if (error) throw error;
      for (const row of data ?? []) rows.push({ linkKey: row.link_key, version: row.version, firstPublishedAt: row.first_published_at, lastPublishedAt: row.last_published_at, publishedBy: row.published_by, publisherName: (row.publisher as unknown as { display_name: string | null } | null)?.display_name ?? null });
      if ((data?.length ?? 0) < 1000) return rows;
    }
  }

  async loadAdventure(id: string): Promise<V3Adventure | null> {
    const { data, error } = await this.admin
      .from("adventures_v3")
      .select("id, school_id, owner_id, status, published_version, spec_version, spec")
      .eq("id", id)
      .maybeSingle<AdventureRow>();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      schoolId: data.school_id,
      ownerId: data.owner_id,
      status: data.status,
      publishedVersion: data.published_version,
      specVersion: data.spec_version,
      spec: data.spec,
    };
  }

  async loadVersionContext(id: string, version: number) {
    const { data, error } = await this.admin.from("adventure_version_context_v3")
      .select("sources,check_errors").eq("adventure_id", id).eq("version", version).maybeSingle();
    if (error) throw error;
    return data ? { sources: data.sources as TransferSource[], checkErrors: data.check_errors as CheckIssue[] | null } : null;
  }

  async loadCheckErrors(id: string, version?: number): Promise<CheckIssue[]> {
    const selected = version ?? (await this.loadAdventure(id))?.specVersion;
    const context = selected === undefined ? null : await this.loadVersionContext(id, selected);
    if (context?.checkErrors) return context.checkErrors;
    const outputs = await supabaseJobStore(this.admin).outputs(id, ["check"]);
    return finalCheckErrors(outputs.check as FinalCheckOutput | undefined);
  }

  async saveDraft(id: string, expectedVersion: number, spec: unknown): Promise<{ saved: boolean; version?: number }> {
    const { data, error } = await this.admin.rpc("save_adventure_v3", { p_id: id, p_expected_version: expectedVersion, p_spec: spec });
    if (error) throw error;
    return data;
  }

  async publishVersion(id: string, expectedVersion: number, expectedPublished: number | null, publish: boolean, selectedVersion?: number, publisherId?: string): Promise<boolean> {
    const { data, error } = await this.admin.rpc(publisherId ? "publish_attributed_version_v3" : selectedVersion === undefined ? "publish_adventure_v3" : "publish_selected_version_v3", {
      p_id: id, p_expected_version: expectedVersion, p_expected_published: expectedPublished,
      ...(publisherId ? { p_publish: publish, p_publisher_id: publisherId, p_selected_version: selectedVersion ?? null }
        : selectedVersion === undefined ? { p_publish: publish } : { p_selected_version: selectedVersion }),
    });
    if (error) throw error;
    return data === true;
  }

  async setAdventureStatus(id: string, status: string): Promise<void> {
    const { error } = await this.admin.from("adventures_v3").update({ status }).eq("id", id);
    if (error) throw error;
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

  async isSchoolAdmin(schoolId: string, userId: string): Promise<boolean> {
    const [membership, platformAdmin] = await Promise.all([
      this.admin
        .from("organization_member")
        .select("user_id")
        .eq("organization_id", schoolId)
        .eq("user_id", userId)
        .eq("status", "active")
        .eq("role", "admin")
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

  async listAttempts(adventureId: string): Promise<{ id: string; specVersion: number; studentId: string }[]> {
    const attempts: AttemptSummaryRow[] = [];
    for (let from = 0; ; from += 1_000) {
      const { data, error } = await this.admin
        .from("attempts_v3")
        .select("id, spec_version, student_id")
        .eq("adventure_id", adventureId)
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      const page = (data ?? []) as AttemptSummaryRow[];
      attempts.push(...page);
      if (page.length < 1_000) break;
    }
    return attempts.map((attempt) => ({
      id: attempt.id,
      specVersion: attempt.spec_version,
      studentId: attempt.student_id,
    }));
  }

  async loadEvents(attemptIds: readonly string[]): Promise<Map<string, GameEvent[]>> {
    const ids = [...new Set(attemptIds)];
    const events = new Map<string, GameEvent[]>(ids.map((id) => [id, []]));
    let invalidCount = 0;

    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      for (let from = 0; ; from += 1_000) {
        const { data, error } = await this.admin
          .from("attempt_events_v3")
          .select("attempt_id, seq, type, payload")
          .in("attempt_id", chunk)
          .order("attempt_id", { ascending: true })
          .order("seq", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        const page = (data ?? []) as AttemptEventRow[];
        for (const row of page) {
          const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
          const parsed = GameEvent.safeParse({ type: row.type, ...payload });
          if (!parsed.success) {
            invalidCount += 1;
            continue;
          }
          events.get(row.attempt_id)?.push(parsed.data);
        }
        if (page.length < 1_000) break;
      }
    }

    if (invalidCount > 0) {
      console.warn(`Skipped ${invalidCount} invalid v3 attempt events.`);
    }
    return events;
  }

  async studentEmail(userId: string): Promise<string | null> {
    const { data, error } = await this.admin.auth.admin.getUserById(userId);
    if (error) throw error;
    return data.user?.email ?? null;
  }

  async findLatestAttempt(adventureId: string, studentId: string, version?: number): Promise<V3Attempt | null> {
    let query = this.admin
      .from("attempts_v3")
      .select("id, adventure_id, spec_version, student_id, state, revision")
      .eq("adventure_id", adventureId)
      .eq("student_id", studentId);
    if (version !== undefined) query = query.eq("spec_version", version);
    const { data, error } = await query
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
    release?: string;
  }): Promise<{ id: string; revision: 0 } | null> {
    const { data, error } = await this.admin.rpc("start_attempt_v3", {
      p_adventure_id: input.adventureId, p_spec_version: input.specVersion,
      p_student_id: input.studentId, p_state: input.state,
      ...(input.release ? { p_release: input.release } : {}),
    });
    if (error) throw error;
    return data as { id: string; revision: 0 } | null;
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
  private readonly publications = new Map<string, V3Publication[]>();
  private readonly adventures = new Map<string, V3Adventure>();
  private readonly versions = new Map<string, unknown>();
  private readonly attempts = new Map<string, MemoryAttempt>();
  private readonly activeMembers = new Set<string>();
  private readonly schoolAdmins = new Set<string>();
  private readonly platformAdmins = new Set<string>();
  private readonly studentEmails = new Map<string, string>();
  private readonly tokenCounts = new Map<string, number>();
  private sequence = 0;
  readonly savedEvents: { attemptId: string; events: GameEvent[] }[] = [];
  readonly flags: ({ attemptId: string } & V3FlagInput)[] = [];

  addAdventure(adventure: V3Adventure): void {
    this.adventures.set(adventure.id, structuredClone({ ...adventure, publishedVersion: adventure.publishedVersion === undefined ? (adventure.status === "published" ? adventure.specVersion : null) : adventure.publishedVersion }));
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

  addSchoolAdmin(schoolId: string, userId: string): void {
    this.schoolAdmins.add(`${schoolId}:${userId}`);
  }

  addPlatformAdmin(userId: string): void {
    this.platformAdmins.add(userId);
  }

  async isPlatformAdmin(userId: string): Promise<boolean> { return this.platformAdmins.has(userId); }

  setStudentEmail(userId: string, email: string): void {
    this.studentEmails.set(userId, email);
  }

  addAttemptWithEvents(input: {
    adventureId: string;
    specVersion: number;
    studentId: string;
    events: GameEvent[];
    id?: string;
  }): string {
    const id = input.id ?? crypto.randomUUID();
    this.attempts.set(id, {
      id,
      adventureId: input.adventureId,
      specVersion: input.specVersion,
      studentId: input.studentId,
      state: {},
      revision: 0,
      events: structuredClone(input.events),
      order: ++this.sequence,
    });
    return id;
  }

  setTokensUsed(attemptId: string, tokens: number): void {
    this.tokenCounts.set(attemptId, tokens);
  }

  async listPublications(id: string): Promise<V3Publication[]> {
    return structuredClone(this.publications.get(id) ?? []);
  }

  async loadAdventure(id: string): Promise<V3Adventure | null> {
    const adventure = this.adventures.get(id);
    return adventure ? structuredClone(adventure) : null;
  }

  readonly checkErrors = new Map<string, CheckIssue[]>();

  async loadCheckErrors(id: string): Promise<CheckIssue[]> {
    return structuredClone(this.checkErrors.get(id) ?? []);
  }

  async saveDraft(id: string, expectedVersion: number, spec: unknown): Promise<{ saved: boolean; version?: number }> {
    const a = this.adventures.get(id);
    if (!a || a.specVersion !== expectedVersion || !["draft", "published", "archived"].includes(a.status)) return { saved: false };
    if (JSON.stringify(a.spec) !== JSON.stringify(spec)) {
      a.spec = structuredClone(spec);
      a.specVersion++;
      this.addVersionSpec(id, a.specVersion, spec);
    }
    return { saved: true, version: a.specVersion };
  }

  async publishVersion(id: string, expectedVersion: number, expectedPublished: number | null, publish: boolean, selectedVersion?: number, publisherId?: string): Promise<boolean> {
    const a = this.adventures.get(id);
    if (!a || a.specVersion !== expectedVersion || a.publishedVersion !== expectedPublished) return false;
    const selected = selectedVersion ?? a.specVersion;
    if (publish && !this.versions.has(`${id}:${selected}`)) return false;
    const changed = a.status !== "published" || a.publishedVersion !== selected;
    a.status = publish ? "published" : "draft";
    a.publishedVersion = publish ? selected : null;
    if (publish && changed) {
      const rows = this.publications.get(id) ?? [];
      const previous = rows.find(row => row.version === selected);
      const now = new Date().toISOString();
      if (previous) Object.assign(previous, { lastPublishedAt: now, publishedBy: publisherId ?? null, publisherName: null });
      else rows.push({ linkKey: crypto.randomUUID(), version: selected, firstPublishedAt: now, lastPublishedAt: now, publishedBy: publisherId ?? null, publisherName: null });
      this.publications.set(id, rows);
    }
    return true;
  }

  async setAdventureStatus(id: string, status: string): Promise<void> {
    const adventure = this.adventures.get(id);
    if (adventure) adventure.status = status;
  }

  async loadVersionSpec(adventureId: string, version: number): Promise<unknown | null> {
    const spec = this.versions.get(`${adventureId}:${version}`);
    return spec === undefined ? null : structuredClone(spec);
  }

  async isActiveMember(schoolId: string, userId: string): Promise<boolean> {
    return this.activeMembers.has(`${schoolId}:${userId}`) || this.platformAdmins.has(userId);
  }

  async isSchoolAdmin(schoolId: string, userId: string): Promise<boolean> {
    return this.schoolAdmins.has(`${schoolId}:${userId}`) || this.platformAdmins.has(userId);
  }

  async listAttempts(adventureId: string): Promise<{ id: string; specVersion: number; studentId: string }[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.adventureId === adventureId)
      .sort((a, b) => a.order - b.order)
      .map(({ id, specVersion, studentId }) => ({ id, specVersion, studentId }));
  }

  async loadEvents(attemptIds: readonly string[]): Promise<Map<string, GameEvent[]>> {
    const events = new Map<string, GameEvent[]>();
    for (const id of new Set(attemptIds)) {
      events.set(id, structuredClone(this.attempts.get(id)?.events ?? []));
    }
    return events;
  }

  async studentEmail(userId: string): Promise<string | null> {
    return this.studentEmails.get(userId) ?? null;
  }

  async findLatestAttempt(adventureId: string, studentId: string, version?: number): Promise<V3Attempt | null> {
    const latest = [...this.attempts.values()]
      .filter((attempt) => attempt.adventureId === adventureId && attempt.studentId === studentId && (version === undefined || attempt.specVersion === version))
      .sort((a, b) => b.order - a.order)[0];
    return latest ? this.toAttempt(latest) : null;
  }

  async createAttempt(input: {
    adventureId: string;
    specVersion: number;
    studentId: string;
    state: unknown;
    release?: string;
  }): Promise<{ id: string; revision: 0 } | null> {
    const a = this.adventures.get(input.adventureId);
    if (!a || a.status !== "published" || (input.release ? !(this.publications.get(a.id) ?? []).some(p => p.linkKey === input.release && p.version === input.specVersion) : a.publishedVersion !== input.specVersion)) return null;
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
