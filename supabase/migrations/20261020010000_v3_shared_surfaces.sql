-- Shared discovery and reporting include both generations. Existing RPCs remain
-- available so this migration can precede the application deployment.
alter table adventures_v3 add column archived_from_status text
  check (archived_from_status in ('draft', 'published'));

-- Reporting data is private; authenticated discovery functions below expose
-- only school-authorized metadata, never attempt state or draft specs.
create view reporting_attempts_all_versions as
select 'v2'::text as kind, x.id, x.adventure_id, a.organization_id as school_id,
       x.student_id, x.created_at, x.updated_at,
       case when x.status = 'completed' then x.updated_at end as completed_at
from attempt x join adventure a on a.id = x.adventure_id
union all
select 'v3', x.id, x.adventure_id, a.school_id, x.student_id,
       x.created_at, x.updated_at, done.completed_at
from attempts_v3 x join adventures_v3 a on a.id = x.adventure_id
left join lateral (
  select min(e.created_at) as completed_at from attempt_events_v3 e
  where e.attempt_id = x.id and e.type = 'phase' and e.payload->>'to' = 'reveal'
) done on true;
revoke all on reporting_attempts_all_versions from public, anon, authenticated;
grant select on reporting_attempts_all_versions to service_role;

create function list_library_all_versions(p_include_v3 boolean default false)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select row from (
    select to_jsonb(l) || jsonb_build_object('kind', 'v2', 'published_version', a.published_version) as row
    from list_library() l join adventure a on a.id = l.adventure_id
    union all
    select jsonb_build_object(
      'kind', 'v3', 'adventure_id', a.id, 'organization_id', a.school_id,
      'title', v.spec->>'title', 'setting', v.spec#>>'{stages,0,timePlace}',
      'teacher_name', p.display_name, 'published_version', a.published_version,
      'allow_retries', false, 'updated_at', a.updated_at,
      'latest_attempt_id', latest.id, 'latest_attempt_status',
        case when latest.id is null then null when latest.completed_at is not null then 'completed' else 'active' end)
    from adventures_v3 a
    join adventure_versions_v3 v on v.adventure_id = a.id and v.version = a.published_version
    join organization_member m on m.organization_id = a.school_id and m.user_id = auth.uid() and m.status = 'active'
    left join profile p on p.id = a.owner_id
    left join lateral (
      select x.id, x.completed_at from reporting_attempts_all_versions x
      where x.kind = 'v3' and x.adventure_id = a.id and x.student_id = auth.uid()
      order by (x.completed_at is null) desc, x.created_at desc, x.id limit 1
    ) latest on true
    where p_include_v3 and a.status = 'published'
  ) entries order by (row->>'updated_at')::timestamptz desc, row->>'adventure_id';
$$;

create function school_usage_all_versions(p_org uuid, p_include_v3 boolean default false)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if is_org_admin(p_org) is not true and is_sysadmin() is not true then
    raise exception 'only school admins can view school usage' using errcode = '42501';
  end if;
  return query select row || jsonb_build_object('school_students', (
    select count(distinct student_id) from reporting_attempts_all_versions
    where school_id = p_org and (kind = 'v2' or p_include_v3)
  ), 'version_students', (
    select count(distinct student_id) from reporting_attempts_all_versions
    where school_id = p_org and kind = row->>'kind'
  )) from (
    select to_jsonb(u) || jsonb_build_object('kind', 'v2') as row from school_usage(p_org) u
    union all
    select jsonb_build_object(
      'kind', 'v3', 'adventure_id', a.id, 'title', coalesce(a.spec->>'title', a.title, 'Untitled adventure'),
      'owner_id', a.owner_id, 'owner_name', p.display_name, 'status', a.status,
      'attempts', stats.attempts, 'students', stats.students, 'completed', stats.completed,
      'play_seconds', null, 'play_tokens', coalesce(tokens.n, 0), 'image_cost_usd', null,
      'updated_at', a.updated_at, 'share_token', null,
      'shareable', a.status = 'published' and a.published_version is not null,
      'published_version', a.published_version)
    from adventures_v3 a left join profile p on p.id = a.owner_id
    cross join lateral (
      select count(*) as attempts, count(distinct x.student_id) as students,
             count(*) filter(where x.completed_at is not null) as completed
      from reporting_attempts_all_versions x where x.kind = 'v3' and x.adventure_id = a.id
    ) stats
    left join lateral (
      select sum(u.input_tokens::bigint + u.output_tokens::bigint) as n
      from llm_usage u join attempts_v3 x on x.id = u.attempt_v3_id where x.adventure_id = a.id
    ) tokens on true
    where p_include_v3 and a.school_id = p_org
  ) entries order by (row->>'updated_at')::timestamptz desc, row->>'adventure_id';
end;
$$;

create function set_adventure_archived_v3(p_org uuid, p_adventure_id uuid, p_archived boolean)
returns text language plpgsql security definer set search_path = public as $$
declare a adventures_v3; next_status text;
begin
  select * into a from adventures_v3 where id = p_adventure_id and school_id = p_org for update;
  if not found then raise exception 'adventure not found' using errcode = 'P0002'; end if;
  if not ((a.owner_id = auth.uid() and can_author_in(a.school_id)) is true
    or is_org_admin(a.school_id) is true or is_sysadmin() is true) then
    raise exception 'only the owner or a school admin can archive this adventure' using errcode = '42501';
  end if;
  if p_archived then
    if a.status = 'archived' then return a.status; end if;
    if a.status not in ('draft', 'published') then
      raise exception 'finish generating before archiving' using errcode = '22023';
    end if;
    update adventures_v3 set archived_from_status = a.status, status = 'archived' where id = a.id;
    return 'archived';
  end if;
  if a.status <> 'archived' then return a.status; end if;
  next_status := coalesce(a.archived_from_status, 'draft');
  update adventures_v3 set status = next_status, archived_from_status = null where id = a.id;
  return next_status;
end;
$$;

revoke all on function list_library_all_versions(boolean) from public, anon;
revoke all on function school_usage_all_versions(uuid, boolean) from public, anon;
revoke all on function set_adventure_archived_v3(uuid, uuid, boolean) from public, anon;
grant execute on function list_library_all_versions(boolean), school_usage_all_versions(uuid, boolean),
  set_adventure_archived_v3(uuid, uuid, boolean) to authenticated;

-- JSON extension rows keep the existing metric fields, adding coverage counts
-- rather than presenting unrecorded v3 time or image costs as zero.
create function platform_overview_all_versions(p_since timestamptz)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(b) || jsonb_build_object(
    'adventures', b.adventures + (select count(*) from adventures_v3),
    'published_adventures', b.published_adventures + (select count(*) from adventures_v3 where status = 'published'),
    'attempts', (select count(*) from reporting_attempts_all_versions),
    'attempts_since', (select count(*) from reporting_attempts_all_versions where created_at >= p_since),
    'completed_since', (select count(*) from reporting_attempts_all_versions where completed_at >= p_since),
    'active_students_since', (select count(distinct student_id) from reporting_attempts_all_versions where updated_at >= p_since),
    'unmeasured_v3_attempts', (select count(*) from attempts_v3 where updated_at >= p_since),
    'unmeasured_v3_adventures', (select count(*) from adventures_v3))
  from platform_overview(p_since) b;
$$;

create function platform_school_stats_all_versions(p_since timestamptz)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(b) || jsonb_build_object(
    'adventures', b.adventures + v.adventures, 'published', b.published + v.published,
    'attempts', x.attempts, 'attempts_since', x.attempts_since,
    'unmeasured_v3_adventures', v.adventures)
  from platform_school_stats(p_since) b
  cross join lateral (
    select count(*) as adventures, count(*) filter(where status = 'published') as published
    from adventures_v3 where school_id = b.organization_id
  ) v
  cross join lateral (
    select count(*) as attempts, count(*) filter(where created_at >= p_since) as attempts_since
    from reporting_attempts_all_versions where school_id = b.organization_id
  ) x;
$$;

create function platform_activity_daily_all_versions(p_since timestamptz)
returns setof jsonb language sql stable security definer set search_path = public as $$
  with activity as (
    select (created_at at time zone 'UTC')::date as day, student_id from reporting_attempts_all_versions where created_at >= p_since
    union
    select (updated_at at time zone 'UTC')::date, student_id from reporting_attempts_all_versions where updated_at >= p_since
    union
    select (t.recorded_at at time zone 'UTC')::date, x.student_id
    from attempt_telemetry t join attempt x on x.id = t.attempt_id where t.recorded_at >= p_since
    union
    select (e.created_at at time zone 'UTC')::date, x.student_id
    from attempt_events_v3 e join attempts_v3 x on x.id = e.attempt_id where e.created_at >= p_since
  )
  select to_jsonb(b) || jsonb_build_object(
    'attempts_started', (select count(*) from reporting_attempts_all_versions where created_at >= p_since and (created_at at time zone 'UTC')::date = b.day),
    'attempts_completed', (select count(*) from reporting_attempts_all_versions where completed_at >= p_since and (completed_at at time zone 'UTC')::date = b.day),
    'active_students', (select count(distinct student_id) from activity where day = b.day),
    'unmeasured_v3_attempts', (select count(*) from attempts_v3 where updated_at >= p_since and (updated_at at time zone 'UTC')::date = b.day))
  from platform_activity_daily(p_since) b;
$$;

revoke all on function platform_overview_all_versions(timestamptz), platform_school_stats_all_versions(timestamptz),
  platform_activity_daily_all_versions(timestamptz) from public, anon, authenticated;
grant execute on function platform_overview_all_versions(timestamptz), platform_school_stats_all_versions(timestamptz),
  platform_activity_daily_all_versions(timestamptz) to service_role;
