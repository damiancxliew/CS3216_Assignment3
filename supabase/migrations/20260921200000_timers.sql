-- Stage timers (P6 / D12 / FR-16).
--
-- The settings themselves already exist in the schema: `adventure.default_timer_seconds`
-- with a per-stage `stage.timer_seconds` override, where null inherits the default
-- and 0 disables the timer. What this migration adds is the half a client must not
-- be able to influence: the deadline is computed from `now()` inside the database,
-- and expiry is decided by comparing `now()` to the stored deadline, never by a
-- countdown the browser reports as finished.
--
-- Three functions, all security definer so they can be called by a teacher or a
-- student without granting those roles write access to the tables underneath:
--
--   set_stage_timer      teacher edits the override on a *draft* stage
--   start_stage_deadline orchestration stamps the deadline when a stage opens
--   expire_stage_if_due  records the player's pass once the deadline has passed

-- A teacher's per-stage override. Published versions are frozen (P4), so this
-- only ever touches a draft; the trigger would reject it anyway, but failing
-- here gives the console a message it can show.
create or replace function set_stage_timer(p_stage_id uuid, p_seconds integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_adventure_id uuid;
  v_published_at timestamptz;
begin
  select sv.adventure_id, sv.published_at
    into v_adventure_id, v_published_at
  from stage s
  join spec_version sv on sv.id = s.spec_version_id
  where s.id = p_stage_id;

  if v_adventure_id is null then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;

  if not is_adventure_owner(v_adventure_id) then
    raise exception 'only the owner may change a stage timer' using errcode = '42501';
  end if;

  if v_published_at is not null then
    raise exception 'this version is published and immutable' using errcode = '25006';
  end if;

  if p_seconds is not null and p_seconds < 0 then
    raise exception 'a timer cannot be negative' using errcode = '22023';
  end if;

  update stage set timer_seconds = p_seconds where id = p_stage_id;
end;
$$;

-- Stamps the deadline for the stage an attempt has just entered. The interval
-- is added to the database's `now()`, so a client clock has no say in it, and a
-- disabled timer (0, or an adventure default of 0 that the stage inherits)
-- stores null rather than a deadline in the past.
create or replace function start_stage_deadline(p_attempt_id uuid, p_stage_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_timer integer;
  v_deadline timestamptz;
begin
  v_timer := effective_timer_seconds(p_stage_id);

  v_deadline := case
    when coalesce(v_timer, 0) > 0 then now() + make_interval(secs => v_timer)
    else null
  end;

  update attempt
  set current_stage_id = p_stage_id, stage_deadline_at = v_deadline
  where id = p_attempt_id;

  if not found then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;

  return v_deadline;
end;
$$;

-- Records the pass the player is deemed to have made when their time runs out.
-- Idempotent and re-entrant: the unique index means a player who committed in
-- the last second keeps their choice, and calling this repeatedly (every poll,
-- from every tab) records one pass. Closing the stage and resolving it stay
-- with orchestration; this is only the record of what the timer decided.
create or replace function expire_stage_if_due(p_attempt_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_attempt attempt%rowtype;
begin
  select * into v_attempt from attempt where id = p_attempt_id;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;

  -- Definer rights would otherwise let any signed-in user time out someone
  -- else's stage. Orchestration calls this with the service role, which has no
  -- `auth.uid()` and is trusted by definition.
  if auth.uid() is not null
     and not (owns_attempt(p_attempt_id) or teaches_attempt(p_attempt_id)) then
    raise exception 'not your attempt' using errcode = '42501';
  end if;

  if v_attempt.stage_deadline_at is null
     or v_attempt.current_stage_id is null
     or now() < v_attempt.stage_deadline_at then
    return false;
  end if;

  insert into stage_commitment (attempt_id, stage_id, actor_kind, player_id, option_id)
  values (p_attempt_id, v_attempt.current_stage_id, 'player', v_attempt.student_id, null)
  on conflict do nothing;

  return true;
end;
$$;

-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default privileges, so revoking from PUBLIC alone leaves them callable.
revoke all on function set_stage_timer(uuid, integer) from public, anon, authenticated;
revoke all on function start_stage_deadline(uuid, uuid) from public, anon, authenticated;
revoke all on function expire_stage_if_due(uuid) from public, anon, authenticated;

grant execute on function set_stage_timer(uuid, integer) to authenticated;
-- Opening a stage is an orchestration call, not something a client may trigger.
grant execute on function start_stage_deadline(uuid, uuid) to service_role;
-- A student may only ever *observe* their own timer running out; the function
-- re-checks the clock itself, so calling it early does nothing.
grant execute on function expire_stage_if_due(uuid) to authenticated, service_role;
