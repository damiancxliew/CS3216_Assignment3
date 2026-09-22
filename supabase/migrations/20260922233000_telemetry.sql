-- ---------------------------------------------------------------------------
-- Runtime telemetry (P11 / FR-22)
-- ---------------------------------------------------------------------------
-- One row per stage an attempt finishes, written by the Turn API when the
-- stage resolves: how long it took, how many model tokens it cost, how much
-- the student did. Nothing here is per-message or contains text — it is the
-- ledger that lets the team say "an attempt takes N minutes and M tokens"
-- with numbers instead of a guess (release gate 6, milestones M6/M19).

create table attempt_telemetry (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempt (id) on delete cascade,
  stage_id uuid references stage (id) on delete set null,
  stage_index integer not null,
  -- how the stage ended
  ended_by text not null check (ended_by in ('decision', 'timer')),
  -- wall clock from the stage opening (or the attempt starting) to its resolution
  duration_seconds integer not null check (duration_seconds >= 0),
  -- model usage attributed to this stage: agent replies, autonomous ticks, agent decisions
  tokens integer not null default 0 check (tokens >= 0),
  -- what the student did
  messages integer not null default 0,
  actions integer not null default 0,
  evidence_found integer not null default 0,
  -- how many autonomous agent utterances the stage produced
  agent_lines integer not null default 0,
  recorded_at timestamptz not null default now(),
  unique (attempt_id, stage_index)
);

create index attempt_telemetry_attempt_idx on attempt_telemetry (attempt_id);

alter table attempt_telemetry enable row level security;

-- The teacher sees the numbers for their adventures' attempts; the student does not need them.
create policy attempt_telemetry_select on attempt_telemetry
  for select to authenticated
  using (teaches_attempt(attempt_id));
