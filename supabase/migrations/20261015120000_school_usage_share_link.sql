drop function school_usage(uuid);

create function school_usage(p_org uuid)
returns table (
  adventure_id uuid, title text, owner_id uuid, owner_name text, status adventure_status,
  attempts bigint, students bigint, completed bigint,
  play_seconds bigint, play_tokens bigint, image_cost_usd numeric, updated_at timestamptz,
  share_token uuid, shareable boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if is_org_admin(p_org) is not true and is_sysadmin() is not true then
    raise exception 'only school admins can view school usage' using errcode = '42501';
  end if;
  return query
  select a.id, a.title, a.owner_id, p.display_name, a.status,
         att.attempts, att.students, att.completed,
         coalesce(tel.seconds, 0)::bigint, coalesce(tel.tokens, 0)::bigint,
         coalesce(cost.usd, 0)::numeric, a.updated_at, a.share_token,
         a.status = 'published' and a.published_version is not null and a.assets_ready
  from adventure a
  left join profile p on p.id = a.owner_id
  cross join lateral (
    select count(*) as attempts,
           count(distinct x.student_id) as students,
           count(*) filter (where x.status = 'completed') as completed
    from attempt x where x.adventure_id = a.id
  ) att
  left join lateral (
    select sum(t.duration_seconds) as seconds, sum(t.tokens) as tokens
    from attempt_telemetry t join attempt x on x.id = t.attempt_id
    where x.adventure_id = a.id
  ) tel on true
  left join lateral (
    select sum(s.cost_usd) as usd
    from asset s join spec_version v on v.id = s.spec_version_id
    where v.adventure_id = a.id
  ) cost on true
  where a.organization_id = p_org
  order by a.updated_at desc;
end;
$$;

revoke all on function school_usage(uuid) from public, anon;
grant execute on function school_usage(uuid) to authenticated;
