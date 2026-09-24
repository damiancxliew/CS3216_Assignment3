-- Keep planner output and repair feedback away from the owner-readable progress row.
alter table generation_job add column message text;

create table generation_job_state (
  adventure_id uuid primary key references adventure (id) on delete cascade,
  teacher jsonb not null,
  source_snapshot jsonb not null,
  planner_config jsonb not null,
  layout_seed text not null,
  created_by uuid,
  attempt smallint not null default 0 check (attempt between 0 and 2),
  last_output text,
  issues jsonb not null default '[]'::jsonb,
  spec jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  lease_token uuid,
  lease_expires_at timestamptz
);

alter table generation_job_state enable row level security;
revoke all on generation_job_state from public, anon, authenticated;
grant select, insert, update, delete on generation_job_state to service_role;

-- One browser tab owns a step at a time. An interrupted invocation can be
-- retried after its lease expires without leaving the job permanently stuck.
create function claim_generation_job_step(p_adventure_id uuid, p_token uuid)
returns generation_job_state
language sql
volatile
security definer
set search_path = public
as $$
  update generation_job_state
  set lease_token = p_token, lease_expires_at = now() + interval '5 minutes'
  where adventure_id = p_adventure_id
    and (lease_expires_at is null or lease_expires_at < now())
  returning *;
$$;

revoke all on function claim_generation_job_step(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_generation_job_step(uuid, uuid) to service_role;
