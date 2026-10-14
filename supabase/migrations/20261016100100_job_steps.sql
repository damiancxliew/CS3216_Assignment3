create table job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  name text not null,
  step text not null,
  status text not null check (status in ('pending', 'ready', 'running', 'succeeded', 'failed')),
  deps text[] not null default '{}',
  input jsonb not null default 'null',
  output jsonb,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts >= 1),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (job_id, name)
);

create index job_steps_job_idx on job_steps (job_id);
create index job_steps_active_created_idx on job_steps (created_at)
  where status in ('ready', 'running');

alter table job_steps enable row level security;
revoke all on table job_steps from anon, authenticated;
grant all on table job_steps to service_role;

create trigger job_steps_set_updated_at
  before update on job_steps
  for each row execute function set_updated_at();

create or replace function enqueue_job_steps(p_job_id uuid, p_steps jsonb)
returns setof job_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step jsonb;
  v_dep text;
  v_name text;
  v_step_name text;
  v_input jsonb;
  v_deps text[];
  v_status text;
  v_row job_steps%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text, 0));

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_name := v_step ->> 'name';
    for v_dep in
      select jsonb_array_elements_text(coalesce(v_step -> 'deps', '[]'::jsonb))
    loop
      if not exists (
        select 1
        from jsonb_array_elements(p_steps) batch_step
        where batch_step ->> 'name' = v_dep
      ) and not exists (
        select 1 from job_steps
        where job_id = p_job_id and name = v_dep
      ) then
        raise exception 'unknown dependency % for step %', v_dep, v_name;
      end if;
    end loop;
  end loop;

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_name := v_step ->> 'name';
    v_step_name := coalesce(v_step ->> 'step', v_name);
    v_input := coalesce(v_step -> 'input', 'null'::jsonb);
    select coalesce(array_agg(value), '{}'::text[])
      into v_deps
      from jsonb_array_elements_text(coalesce(v_step -> 'deps', '[]'::jsonb));

    if cardinality(v_deps) = 0 or not exists (
      select 1
      from unnest(v_deps) dependency
      where not exists (
        select 1 from job_steps existing
        where existing.job_id = p_job_id
          and existing.name = dependency
          and existing.status = 'succeeded'
      )
    ) then
      v_status := 'ready';
    else
      v_status := 'pending';
    end if;

    insert into job_steps (job_id, name, step, status, deps, input, max_attempts)
    values (
      p_job_id,
      v_name,
      v_step_name,
      v_status,
      v_deps,
      v_input,
      coalesce((v_step ->> 'max_attempts')::integer, 3)
    )
    returning * into v_row;
    return next v_row;
  end loop;
end;
$$;

revoke all on function enqueue_job_steps(uuid, jsonb) from public, anon, authenticated;
grant execute on function enqueue_job_steps(uuid, jsonb) to service_role;

create or replace function claim_job_step(
  p_token uuid,
  p_lease_seconds integer default 330,
  p_job_id uuid default null
)
returns setof job_steps
language plpgsql
security definer
set search_path = public
as $$
begin
  update job_steps
  set status = 'failed',
      error = 'lease expired after final attempt',
      finished_at = now(),
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'running'
    and lease_expires_at <= now()
    and attempts >= max_attempts
    and (p_job_id is null or job_id = p_job_id);

  return query
  with candidate as (
    select id
    from job_steps
    where (p_job_id is null or job_id = p_job_id)
      and (
        status = 'ready'
        or (status = 'running' and lease_expires_at <= now())
      )
    order by created_at
    limit 1
    for update skip locked
  )
  update job_steps step_row
  set status = 'running',
      attempts = step_row.attempts + 1,
      lease_token = p_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(step_row.started_at, now()),
      updated_at = now()
  from candidate
  where step_row.id = candidate.id
  returning step_row.*;
end;
$$;

revoke all on function claim_job_step(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function claim_job_step(uuid, integer, uuid) to service_role;

create or replace function complete_job_step(p_step_id uuid, p_token uuid, p_output jsonb)
returns setof job_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_completed_job_id uuid;
begin
  select job_id into v_job_id from job_steps where id = p_step_id;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_job_id::text, 0));

  update job_steps
  set status = 'succeeded',
      output = p_output,
      finished_at = now(),
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_step_id
    and status = 'running'
    and lease_token = p_token
  returning job_id into v_completed_job_id;
  if not found then
    return;
  end if;

  return query
  update job_steps pending_step
  set status = 'ready',
      updated_at = now()
  where pending_step.job_id = v_completed_job_id
    and pending_step.status = 'pending'
    and not exists (
      select 1
      from unnest(pending_step.deps) dependency
      where not exists (
        select 1 from job_steps succeeded_step
        where succeeded_step.job_id = pending_step.job_id
          and succeeded_step.name = dependency
          and succeeded_step.status = 'succeeded'
      )
    )
  returning pending_step.*;
end;
$$;

revoke all on function complete_job_step(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function complete_job_step(uuid, uuid, jsonb) to service_role;

create or replace function fail_job_step(p_step_id uuid, p_token uuid, p_error text)
returns setof job_steps
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update job_steps
  set status = case when attempts < max_attempts then 'ready' else 'failed' end,
      error = p_error,
      finished_at = case when attempts < max_attempts then finished_at else now() end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_step_id
    and status = 'running'
    and lease_token = p_token
  returning *;
end;
$$;

revoke all on function fail_job_step(uuid, uuid, text) from public, anon, authenticated;
grant execute on function fail_job_step(uuid, uuid, text) to service_role;
