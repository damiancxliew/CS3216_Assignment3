-- P3: sharing links.
--
-- A share link carries `adventure.share_token` and nothing else. The token is
-- not a read grant: it is an argument to join_adventure(), which admits the
-- signed-in student to a *published* adventure by giving them an attempt, and
-- the existing RLS then exposes exactly the version that attempt pinned. An
-- unpublished adventure has no reachable state through its link — the lookup
-- simply finds nothing.

-- The public face of a link, shown before sign-in so a student knows what they
-- are being invited to. Only published adventures resolve.
create or replace function share_link_preview(p_token uuid)
returns table (adventure_id uuid, title text, setting text, teacher_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.title, a.setting, p.display_name
  from adventure a
  left join profile p on p.id = a.owner_id
  where a.share_token = p_token
    and a.status = 'published'
    and a.published_version is not null;
$$;

-- Admits the current user to the adventure behind a link. Returns their live
-- attempt if they already have one, so a re-used link resumes rather than
-- restarts (FR-18), and otherwise creates one pinned to the version published
-- at this moment (P4). The stage deadline is set here, server-side, from
-- effective_timer_seconds (D12/FR-16).
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
  v_stage_id uuid;
  v_timer integer;
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
    v_student,
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

-- Invalidates a link a teacher has lost control of. Owner only: the function
-- runs as definer, so it has to check ownership itself.
create or replace function rotate_share_token(p_adventure_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not is_adventure_owner(p_adventure_id) then
    raise exception 'not your adventure' using errcode = '42501';
  end if;

  update adventure
  set share_token = gen_random_uuid(), updated_at = now()
  where id = p_adventure_id
  returning share_token into v_token;

  return v_token;
end;
$$;

revoke all on function share_link_preview(uuid) from public;
revoke all on function join_adventure(uuid) from public;
revoke all on function rotate_share_token(uuid) from public;

-- The preview runs before sign-in; joining and rotating require an identity.
grant execute on function share_link_preview(uuid) to anon, authenticated;
grant execute on function join_adventure(uuid) to authenticated;
grant execute on function rotate_share_token(uuid) to authenticated;
