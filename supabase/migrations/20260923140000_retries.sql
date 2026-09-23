-- ---------------------------------------------------------------------------
-- Retries are the teacher's decision, not the link's
-- ---------------------------------------------------------------------------
-- A finished attempt used to mean the share link silently handed out a second
-- one, so a class could replay until the ending read well. Whether that is
-- allowed is now a property of the adventure, enforced where attempts are
-- created rather than in the page that offers the button: with retries off,
-- opening the link again lands the student back on the attempt they finished.

alter table adventure
  add column allow_retries boolean not null default true;

comment on column adventure.allow_retries is 'Whether a student may start a fresh attempt once theirs has finished.';

-- The one place an attempt is created, so joining a link and retrying cannot
-- disagree about the version it pins or the deadline it stamps (P4, D12/FR-16).
-- Internal: callers are the definer functions below, never a client role.
create or replace function start_attempt(p_adventure_id uuid, p_student uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_adventure adventure%rowtype;
  v_attempt_id uuid;
  v_stage_id uuid;
  v_timer integer;
begin
  select * into v_adventure
  from adventure
  where id = p_adventure_id
    and status = 'published'
    and published_version is not null;

  if not found then
    raise exception 'this adventure is not open for play'
      using errcode = 'P0002';
  end if;

  select s.id into v_stage_id
  from stage s
  join spec_version sv on sv.id = s.spec_version_id
  where sv.adventure_id = v_adventure.id
    and sv.version = v_adventure.published_version
  order by s.index
  limit 1;

  v_timer := case
    when v_stage_id is null then null
    else effective_timer_seconds(v_stage_id)
  end;

  insert into attempt (
    adventure_id, published_version, student_id, current_stage_id, stage_deadline_at
  )
  values (
    v_adventure.id,
    v_adventure.published_version,
    p_student,
    v_stage_id,
    case
      when coalesce(v_timer, 0) > 0 then now() + make_interval(secs => v_timer)
      else null
    end
  )
  returning id into v_attempt_id;

  insert into attempt_state (attempt_id) values (v_attempt_id);

  return v_attempt_id;
end;
$$;

create or replace function join_adventure(p_token uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
  v_adventure adventure%rowtype;
  v_attempt_id uuid;
begin
  if v_student is null then
    raise exception 'sign in required to join an adventure'
      using errcode = '42501';
  end if;

  select * into v_adventure
  from adventure
  where share_token = p_token
    and status = 'published'
    and published_version is not null;

  if not found then
    raise exception 'this link does not point at a published adventure'
      using errcode = 'P0002';
  end if;

  -- A live attempt always resumes rather than restarting (FR-18).
  select id into v_attempt_id
  from attempt
  where adventure_id = v_adventure.id
    and student_id = v_student
    and status in ('active', 'spectating')
  order by created_at
  limit 1;

  if found then
    return v_attempt_id;
  end if;

  if not v_adventure.allow_retries then
    select id into v_attempt_id
    from attempt
    where adventure_id = v_adventure.id
      and student_id = v_student
    order by created_at desc
    limit 1;

    if found then
      return v_attempt_id;
    end if;
  end if;

  return start_attempt(v_adventure.id, v_student);
end;
$$;

-- The "play it again" button at the ending. The student needs no link for it,
-- but they get a second attempt only while the teacher allows one, and a live
-- attempt is returned untouched rather than replaced.
create or replace function restart_attempt(p_attempt_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
  v_attempt attempt%rowtype;
  v_allowed boolean;
  v_live uuid;
begin
  if v_student is null then
    raise exception 'sign in required to play again'
      using errcode = '42501';
  end if;

  select * into v_attempt
  from attempt
  where id = p_attempt_id
    and student_id = v_student;

  if not found then
    raise exception 'no such attempt'
      using errcode = 'P0002';
  end if;

  select allow_retries into v_allowed
  from adventure
  where id = v_attempt.adventure_id;

  if not v_allowed then
    raise exception 'retries are switched off for this adventure'
      using errcode = '42501';
  end if;

  select id into v_live
  from attempt
  where adventure_id = v_attempt.adventure_id
    and student_id = v_student
    and status in ('active', 'spectating')
  order by created_at
  limit 1;

  if found then
    return v_live;
  end if;

  return start_attempt(v_attempt.adventure_id, v_student);
end;
$$;

revoke all on function start_attempt(uuid, uuid) from public;
revoke all on function join_adventure(uuid) from public;
revoke all on function restart_attempt(uuid) from public;

grant execute on function join_adventure(uuid) to authenticated;
grant execute on function restart_attempt(uuid) to authenticated;
