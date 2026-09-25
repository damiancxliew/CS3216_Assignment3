drop function if exists claim_generation_job_step(uuid, uuid);

-- A bare composite return makes PostgREST emit an all-null row when no job is claimed,
-- which callers cannot distinguish from a successfully claimed job.
create function claim_generation_job_step(p_adventure_id uuid, p_token uuid)
returns setof generation_job_state
language sql
volatile
security definer
set search_path = public
as $$
  update generation_job_state
  set lease_token = p_token, lease_expires_at = now() + interval '10 minutes'
  where adventure_id = p_adventure_id
    and (lease_expires_at is null or lease_expires_at < now())
  returning *;
$$;

revoke all on function claim_generation_job_step(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_generation_job_step(uuid, uuid) to service_role;
