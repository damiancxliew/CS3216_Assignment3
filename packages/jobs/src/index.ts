import type { SupabaseClient } from "@supabase/supabase-js";

/** Default step lease: below Vercel's 300 s `maxDuration`, leaving time to record the result. */
export const DEFAULT_LEASE_SECONDS = 285;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface StepContext<I extends Json = Json> {
  jobId: string;
  name: string;
  input: I;
  outputs: Record<string, Json>;
  attempt: number;
  signal: AbortSignal;
}

export interface StepDefinition<I extends Json = Json, O extends Json = Json> {
  name: string;
  maxAttempts: number;
  run: (ctx: StepContext<I>) => Promise<O>;
}

export function defineStep<I extends Json = Json, O extends Json = Json>(
  name: string,
  run: (ctx: StepContext<I>) => Promise<O>,
  options: { maxAttempts?: number } = {},
): StepDefinition<I, O> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be an integer of at least 1");
  }
  return { name, maxAttempts, run };
}

export type EnqueueStep = string | { name: string; step?: string; input?: Json };
export type StepStatus = "pending" | "ready" | "running" | "succeeded" | "failed";

export interface StepProgress {
  name: string;
  step: string;
  status: StepStatus;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobProgress {
  jobId: string;
  status: "running" | "succeeded" | "failed";
  done: number;
  total: number;
  steps: StepProgress[];
}

export interface JobStep {
  id: string;
  jobId: string;
  name: string;
  step: string;
  status: StepStatus;
  deps: string[];
  input: Json;
  output: Json | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface NewJobStep {
  name: string;
  step: string;
  input: Json;
  deps: string[];
  maxAttempts: number;
}

export interface JobStore {
  enqueue(jobId: string, steps: NewJobStep[]): Promise<void>;
  claim(token: string, leaseSeconds: number, jobId?: string): Promise<JobStep | null>;
  complete(stepId: string, token: string, output: Json): Promise<JobStep[]>;
  fail(stepId: string, token: string, error: string): Promise<JobStep | null>;
  list(jobId: string): Promise<JobStep[]>;
  outputs(jobId: string, names: string[]): Promise<Record<string, Json>>;
}

export function supabaseJobStore(client: SupabaseClient): JobStore {
  return {
    async enqueue(jobId, steps) {
      const { error } = await client.rpc("enqueue_job_steps", {
        p_job_id: jobId,
        p_steps: steps.map((step) => ({
          name: step.name,
          step: step.step,
          input: step.input,
          deps: step.deps,
          max_attempts: step.maxAttempts,
        })),
      });
      if (error) throw error;
    },
    async claim(token, leaseSeconds, jobId) {
      const { data, error } = await client.rpc("claim_job_step", {
        p_token: token,
        p_lease_seconds: leaseSeconds,
        p_job_id: jobId ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row ? fromDatabase(row as Record<string, unknown>) : null;
    },
    async complete(stepId, token, output) {
      const { data, error } = await client.rpc("complete_job_step", {
        p_step_id: stepId,
        p_token: token,
        p_output: output,
      });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => fromDatabase(row));
    },
    async fail(stepId, token, errorText) {
      const { data, error } = await client.rpc("fail_job_step", {
        p_step_id: stepId,
        p_token: token,
        p_error: errorText,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row ? fromDatabase(row as Record<string, unknown>) : null;
    },
    async list(jobId) {
      const { data, error } = await client
        .from("job_steps")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => fromDatabase(row as Record<string, unknown>));
    },
    async outputs(jobId, names) {
      if (names.length === 0) return {};
      const { data, error } = await client
        .from("job_steps")
        .select("name, output")
        .eq("job_id", jobId)
        .in("name", names)
        .eq("status", "succeeded");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((row) => [row.name, row.output as Json]));
    },
  };
}

function fromDatabase(row: Record<string, unknown>): JobStep {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    name: String(row.name),
    step: String(row.step),
    status: row.status as StepStatus,
    deps: (row.deps as string[] | null) ?? [],
    input: row.input as Json,
    output: row.output as Json | null,
    error: row.error as string | null,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    leaseToken: row.lease_token as string | null,
    leaseExpiresAt: row.lease_expires_at as string | null,
    createdAt: String(row.created_at),
    startedAt: row.started_at as string | null,
    finishedAt: row.finished_at as string | null,
    updatedAt: String(row.updated_at),
  };
}

export function memoryJobStore(options: { now?: () => number } = {}): JobStore {
  const now = options.now ?? Date.now;
  const jobs = new Map<string, JobStep[]>();

  function timestamp() {
    return new Date(now()).toISOString();
  }

  function failDependants(jobId: string, at: string) {
    const rows = jobs.get(jobId) ?? [];
    let changed: boolean;
    do {
      changed = false;
      for (const row of rows) {
        if (row.status !== "pending") continue;
        const failedDependency = row.deps.find((dep) =>
          rows.some((candidate) => candidate.name === dep && candidate.status === "failed"),
        );
        if (!failedDependency) continue;
        row.status = "failed";
        row.error = `dependency failed: ${failedDependency}`;
        row.finishedAt = at;
        row.updatedAt = at;
        changed = true;
      }
    } while (changed);
  }

  return {
    async enqueue(jobId, steps) {
      const rows = jobs.get(jobId) ?? [];
      const existing = new Set(rows.map((row) => row.name));
      const incoming = new Set(steps.map((step) => step.name));
      const seen = new Set<string>();
      for (const step of steps) {
        if (existing.has(step.name) || seen.has(step.name)) {
          throw new Error(`duplicate step name: ${step.name}`);
        }
        seen.add(step.name);
        for (const dep of step.deps) {
          if (!incoming.has(dep) && !existing.has(dep)) {
            throw new Error(`unknown dependency ${dep} for step ${step.name}`);
          }
        }
      }
      const createdAt = timestamp();
      const added = steps.map((step): JobStep => ({
        id: crypto.randomUUID(),
        jobId,
        name: step.name,
        step: step.step,
        status: step.deps.every((dep) => rows.find((row) => row.name === dep)?.status === "succeeded")
          ? "ready"
          : "pending",
        deps: [...step.deps],
        input: step.input,
        output: null,
        error: null,
        attempts: 0,
        maxAttempts: step.maxAttempts,
        leaseToken: null,
        leaseExpiresAt: null,
        createdAt,
        startedAt: null,
        finishedAt: null,
        updatedAt: createdAt,
      }));
      rows.push(...added);
      jobs.set(jobId, rows);
      failDependants(jobId, createdAt);
    },
    async claim(token, leaseSeconds, jobId) {
      const time = now();
      const candidateJobs = jobId === undefined ? [...jobs.values()] : [jobs.get(jobId) ?? []];
      const expiredJobs = new Set<string>();
      for (const rows of candidateJobs) {
        for (const row of rows) {
          if (
            row.status === "running" &&
            row.leaseExpiresAt !== null &&
            Date.parse(row.leaseExpiresAt) <= time &&
            row.attempts >= row.maxAttempts
          ) {
            row.status = "failed";
            row.error = "lease expired after final attempt";
            row.finishedAt = timestamp();
            row.leaseToken = null;
            row.leaseExpiresAt = null;
            row.updatedAt = timestamp();
            expiredJobs.add(row.jobId);
          }
        }
      }
      for (const expiredJob of expiredJobs) {
        failDependants(expiredJob, timestamp());
      }
      const candidates = candidateJobs.flat().filter((row) =>
        row.status === "ready" ||
        (row.status === "running" && row.leaseExpiresAt !== null && Date.parse(row.leaseExpiresAt) <= time),
      );
      candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const row = candidates[0];
      if (!row) return null;
      row.status = "running";
      row.attempts += 1;
      row.leaseToken = token;
      row.leaseExpiresAt = new Date(time + leaseSeconds * 1000).toISOString();
      row.startedAt ??= timestamp();
      row.updatedAt = timestamp();
      return { ...row, deps: [...row.deps] };
    },
    async complete(stepId, token, output) {
      const rows = [...jobs.values()].find((items) => items.some((row) => row.id === stepId));
      if (!rows) return [];
      const completed = rows.find((row) => row.id === stepId);
      if (!completed || completed.status !== "running" || completed.leaseToken !== token) return [];
      completed.status = "succeeded";
      completed.output = output;
      completed.finishedAt = timestamp();
      completed.leaseToken = null;
      completed.leaseExpiresAt = null;
      completed.updatedAt = timestamp();
      const readied = rows.filter((row) =>
        row.status === "pending" &&
        row.deps.every((dep) => rows.find((candidate) => candidate.name === dep)?.status === "succeeded"),
      );
      for (const row of readied) {
        row.status = "ready";
        row.updatedAt = timestamp();
      }
      return readied.map((row) => ({ ...row, deps: [...row.deps] }));
    },
    async fail(stepId, token, errorText) {
      const row = [...jobs.values()].flat().find((item) => item.id === stepId);
      if (!row || row.status !== "running" || row.leaseToken !== token) return null;
      const updatedAt = timestamp();
      row.error = errorText;
      row.status = row.attempts < row.maxAttempts ? "ready" : "failed";
      if (row.status === "failed") row.finishedAt = updatedAt;
      row.leaseToken = null;
      row.leaseExpiresAt = null;
      row.updatedAt = updatedAt;
      if (row.status === "failed") failDependants(row.jobId, updatedAt);
      return { ...row, deps: [...row.deps] };
    },
    async list(jobId) {
      return (jobs.get(jobId) ?? []).map((row) => ({ ...row, deps: [...row.deps] }));
    },
    async outputs(jobId, names) {
      const selected = (jobs.get(jobId) ?? []).filter(
        (row) => names.includes(row.name) && row.status === "succeeded",
      );
      return Object.fromEntries(selected.map((row) => [row.name, row.output as Json]));
    },
  };
}

export function createJobs(store: JobStore, definitions: StepDefinition<any, any>[]) {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const enqueuedJobs = new Set<string>();
  if (byName.size !== definitions.length) throw new Error("step definitions must have unique names");

  async function enqueue(jobId: string, steps: EnqueueStep[], deps: Record<string, string[]> = {}) {
    const names = new Set<string>();
    const normalized = steps.map((item) => {
      const name = typeof item === "string" ? item : item.name;
      const step = typeof item === "string" ? name : item.step ?? name;
      const definition = byName.get(step);
      if (!definition) throw new Error(`unknown step definition: ${step}`);
      if (names.has(name)) throw new Error(`duplicate step name: ${name}`);
      names.add(name);
      return {
        name,
        step,
        input: typeof item === "string" ? null : item.input ?? null,
        deps: deps[name] ?? [],
        maxAttempts: definition.maxAttempts,
      };
    });
    const batch = new Map(normalized.map((item) => [item.name, item.deps]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(name: string) {
      if (visiting.has(name)) throw new Error(`dependency cycle includes ${name}`);
      if (visited.has(name) || !batch.has(name)) return;
      visiting.add(name);
      for (const dep of batch.get(name) ?? []) visit(dep);
      visiting.delete(name);
      visited.add(name);
    }
    for (const name of batch.keys()) visit(name);
    const existing = new Set((await store.list(jobId)).map((row) => row.name));
    for (const item of normalized) {
      for (const dep of item.deps) {
        if (!names.has(dep) && !existing.has(dep)) {
          throw new Error(`unknown dependency ${dep} for step ${item.name}`);
        }
      }
    }
    await store.enqueue(jobId, normalized);
    enqueuedJobs.add(jobId);
  }

  async function getProgress(jobId: string): Promise<JobProgress | null> {
    const rows = await store.list(jobId);
    if (rows.length === 0) return null;
    const failed = rows.some((row) => row.status === "failed");
    const succeeded = rows.every((row) => row.status === "succeeded");
    return {
      jobId,
      status: failed ? "failed" : succeeded ? "succeeded" : "running",
      done: rows.filter((row) => row.status === "succeeded" || row.status === "failed").length,
      total: rows.length,
      steps: rows.map((row) => ({
        name: row.name,
        step: row.step,
        status: row.status,
        attempts: row.attempts,
        error: row.error,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      })),
    };
  }

  async function runNext(options: { jobId?: string; leaseSeconds?: number } = {}): Promise<RunResult | null> {
    // Under the host's 300 s limit, so the step aborts and its row is released before the function is killed.
    const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    const token = crypto.randomUUID();
    const claimed = await store.claim(token, leaseSeconds, options.jobId);
    if (!claimed) return null;
    const definition = byName.get(claimed.step);
    if (!definition) {
      const message = `unknown step definition: ${claimed.step}`;
      const failed = await store.fail(claimed.id, token, message);
      return {
        name: claimed.name,
        step: claimed.step,
        jobId: claimed.jobId,
        status: failed?.status === "ready" ? "retrying" : "failed",
        error: message,
      };
    }
    try {
      const outputs = await store.outputs(claimed.jobId, claimed.deps);
      const output = await definition.run({
        jobId: claimed.jobId,
        name: claimed.name,
        input: claimed.input as never,
        outputs,
        attempt: claimed.attempts,
        signal: AbortSignal.timeout(Math.max(0, (leaseSeconds - 15) * 1000)),
      });
      const readied = await store.complete(claimed.id, token, output);
      return {
        name: claimed.name,
        step: claimed.step,
        jobId: claimed.jobId,
        status: "succeeded",
        readied: readied.map((row) => row.name),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await store.fail(claimed.id, token, message);
      return {
        name: claimed.name,
        step: claimed.step,
        jobId: claimed.jobId,
        status: failed?.status === "ready" ? "retrying" : "failed",
        error: message,
      };
    }
  }

  async function drain(options: { jobId?: string } = {}): Promise<JobProgress | null> {
    while (await runNext(options)) {
      // Continue until no rows are claimable.
    }
    if (options.jobId !== undefined) return getProgress(options.jobId);
    return enqueuedJobs.size === 1 ? getProgress([...enqueuedJobs][0]!) : null;
  }

  return { enqueue, getProgress, runNext, drain };
}

export type RunResult =
  | { name: string; step: string; jobId: string; status: "succeeded"; readied: string[] }
  | { name: string; step: string; jobId: string; status: "retrying" | "failed"; error: string };
