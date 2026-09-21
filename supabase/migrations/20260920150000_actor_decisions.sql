-- Actor-kind-neutral decisions (D18/FR-14, revised by Kevin).
--
-- A decision is no longer player-only: agents commit or pass under the same
-- rules. A stage closes when every actor in it has a row here, or when the
-- stage timer expires (orchestration owns closure; this table is the record).
-- `option_id is null` means the actor passed — including the pass recorded on
-- the player's behalf when the timer runs out.

create type actor_kind as enum ('player', 'agent');

create table stage_commitment (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempt (id) on delete cascade,
  stage_id uuid not null references stage (id) on delete cascade,
  actor_kind actor_kind not null,
  -- exactly one of these is set, so both kinds keep a real foreign key
  player_id uuid references auth.users (id) on delete cascade,
  agent_id uuid references agent (id) on delete cascade,
  -- null = passed (declined, or the timer expired before they committed)
  option_id uuid references decision_option (id) on delete set null,
  committed_at timestamptz not null default now(),
  constraint stage_commitment_actor_exactly_one check (
    (actor_kind = 'player' and player_id is not null and agent_id is null)
    or (actor_kind = 'agent' and agent_id is not null and player_id is null)
  )
);

-- One commitment per actor per stage of an attempt.
create unique index stage_commitment_actor_idx
  on stage_commitment (attempt_id, stage_id, coalesce(player_id, agent_id));

create index stage_commitment_stage_idx on stage_commitment (attempt_id, stage_id);

alter table stage_commitment enable row level security;

-- A client may see *that* an actor has committed, never *what* another actor
-- chose before the Resolver reveals it: `option_id` is withheld at the column
-- grant, not merely omitted by the API. Writes stay with the service role.
revoke all on stage_commitment from anon, authenticated;
grant select (id, attempt_id, stage_id, actor_kind, player_id, agent_id, committed_at)
  on stage_commitment to authenticated;

create policy stage_commitment_select on stage_commitment
  for select to authenticated
  using (owns_attempt(attempt_id) or teaches_attempt(attempt_id));
