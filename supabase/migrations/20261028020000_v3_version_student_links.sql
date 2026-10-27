-- Student entry identifies one published snapshot. Reuse the immutable UUIDs
-- already issued in publication history; no saved spec or attempt is rewritten.
-- Keep the existing service-only start RPC signature for deployment compatibility;
-- application callers always supply the required publication ID as p_release.
create or replace function list_library_all_versions(p_include_v3 boolean default false)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select row from (
    select to_jsonb(l) || jsonb_build_object('kind', 'v2', 'published_version', a.published_version) as row
    from list_library() l join adventure a on a.id = l.adventure_id
    union all
    select jsonb_build_object(
      'kind', 'v3', 'version_id', publication.link_key, 'adventure_id', a.id, 'organization_id', a.school_id,
      'title', v.spec->>'title', 'setting', v.spec#>>'{stages,0,timePlace}',
      'teacher_name', p.display_name, 'published_version', a.published_version,
      'allow_retries', false, 'updated_at', a.updated_at,
      'latest_attempt_id', latest.id, 'latest_attempt_status',
        case when latest.id is null then null when latest.completed_at is not null then 'completed' else 'active' end)
    from adventures_v3 a
    join adventure_publications_v3 publication on publication.adventure_id = a.id and publication.version = a.published_version
    join adventure_versions_v3 v on v.adventure_id = a.id and v.version = a.published_version
    join organization_member m on m.organization_id = a.school_id and m.user_id = auth.uid() and m.status = 'active'
    left join profile p on p.id = a.owner_id
    left join lateral (
      select x.id, x.completed_at from reporting_attempts_all_versions x
      join attempts_v3 pinned on pinned.id = x.id and pinned.spec_version = a.published_version
      where x.kind = 'v3' and x.adventure_id = a.id and x.student_id = auth.uid()
      order by (x.completed_at is null) desc, x.created_at desc, x.id limit 1
    ) latest on true
    where p_include_v3 and a.status = 'published'
  ) entries order by (row->>'updated_at')::timestamptz desc, row->>'adventure_id';
$$;

create or replace function school_usage_all_versions(p_org uuid, p_include_v3 boolean default false)
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
      'kind', 'v3', 'version_id', publication.link_key, 'adventure_id', a.id, 'title', coalesce(a.spec->>'title', a.title, 'Untitled adventure'),
      'owner_id', a.owner_id, 'owner_name', p.display_name, 'status', a.status,
      'attempts', stats.attempts, 'students', stats.students, 'completed', stats.completed,
      'play_seconds', null, 'play_tokens', coalesce(tokens.n, 0), 'image_cost_usd', null,
      'updated_at', a.updated_at, 'share_token', null,
      'shareable', a.status = 'published' and publication.link_key is not null,
      'published_version', a.published_version)
    from adventures_v3 a left join profile p on p.id = a.owner_id
    left join adventure_publications_v3 publication on publication.adventure_id = a.id and publication.version = a.published_version
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
