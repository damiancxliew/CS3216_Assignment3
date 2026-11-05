create or replace function fail_job_step_dependants(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  loop
    update job_steps pending_step
    set status = 'failed',
        error = 'dependency failed: ' || (
          select dependency.name
          from unnest(pending_step.deps) with ordinality as dependency(name, position)
          join job_steps failed_step
            on failed_step.job_id = pending_step.job_id
            and failed_step.name = dependency.name
            and failed_step.status = 'failed'
          order by dependency.position
          limit 1
        ),
        finished_at = now(),
        updated_at = now()
    where pending_step.job_id = p_job_id
      and pending_step.status = 'pending'
      and exists (
        select 1
        from unnest(pending_step.deps) dependency
        join job_steps failed_step
          on failed_step.job_id = pending_step.job_id
          and failed_step.name = dependency
          and failed_step.status = 'failed'
      );

    get diagnostics v_updated = row_count;
    exit when v_updated = 0;
  end loop;
end;
$$;

revoke all on function fail_job_step_dependants(uuid) from public, anon, authenticated;

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

  perform fail_job_step_dependants(p_job_id);
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
declare
  v_job_id uuid;
begin
  for v_job_id in
    with expired as (
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
        and (p_job_id is null or job_id = p_job_id)
      returning job_id
    )
    select distinct job_id from expired
  loop
    perform fail_job_step_dependants(v_job_id);
  end loop;

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

create or replace function fail_job_step(p_step_id uuid, p_token uuid, p_error text)
returns setof job_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_row job_steps%rowtype;
begin
  select job_id into v_job_id from job_steps where id = p_step_id;
  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_job_id::text, 0));

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
  returning * into v_row;
  if not found then
    return;
  end if;

  if v_row.status = 'failed' then
    perform fail_job_step_dependants(v_row.job_id);
  end if;

  return next v_row;
end;
$$;

revoke all on function fail_job_step(uuid, uuid, text) from public, anon, authenticated;
grant execute on function fail_job_step(uuid, uuid, text) to service_role;
