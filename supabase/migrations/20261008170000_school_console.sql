create or replace function school_roster(p_org uuid)
returns table (
  user_id uuid, role org_role, status membership_status, display_name text,
  email text, joined_at timestamptz, removed_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if is_org_staff(p_org) is not true and is_sysadmin() is not true then
    raise exception 'only school staff can view the roster' using errcode = '42501';
  end if;
  return query
  select m.user_id, m.role, m.status, p.display_name, u.email::text, m.created_at, m.removed_at
  from organization_member m
  left join profile p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.organization_id = p_org
  order by m.status, m.role, lower(coalesce(p.display_name, u.email::text, ''));
end;
$$;

create or replace function school_usage(p_org uuid)
returns table (
  adventure_id uuid, title text, owner_id uuid, owner_name text, status adventure_status,
  attempts bigint, students bigint, completed bigint,
  play_seconds bigint, play_tokens bigint, image_cost_usd numeric, updated_at timestamptz
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
         coalesce(cost.usd, 0)::numeric, a.updated_at
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

create or replace function set_adventure_archived(p_adventure_id uuid, p_archived boolean)
returns adventure_status
language plpgsql volatile security definer set search_path = public
as $$
declare
  v adventure%rowtype;
  v_status adventure_status;
begin
  select * into v from adventure where id = p_adventure_id for update;
  if not found then
    raise exception 'adventure not found' using errcode = 'P0002';
  end if;
  if not (((v.owner_id = auth.uid() and can_author_in(v.organization_id)) is true)
          or is_org_admin(v.organization_id) is true or is_sysadmin() is true) then
    raise exception 'only the owner or a school admin can archive this adventure' using errcode = '42501';
  end if;
  v_status := case
    when p_archived then 'archived'::adventure_status
    when v.published_version is not null then 'published'::adventure_status
    else 'draft'::adventure_status
  end;
  update adventure set status = v_status where id = p_adventure_id;
  return v_status;
end;
$$;

revoke all on function school_roster(uuid) from public, anon;
revoke all on function school_usage(uuid) from public, anon;
revoke all on function set_adventure_archived(uuid, boolean) from public, anon;
grant execute on function school_roster(uuid) to authenticated;
grant execute on function school_usage(uuid) to authenticated;
grant execute on function set_adventure_archived(uuid, boolean) to authenticated;
