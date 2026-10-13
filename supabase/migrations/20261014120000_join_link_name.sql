alter table organization_join_link
  add column name text check (name is null or char_length(name) between 1 and 80);

drop function create_school_join_link(uuid, integer);

create function create_school_join_link(p_org uuid, p_ttl_seconds integer, p_name text default null)
returns table (id uuid, token uuid, expires_at timestamptz, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not can_author_in(p_org) then
    raise exception 'not school staff' using errcode = '42501';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 300 or p_ttl_seconds > 2592000 then
    raise exception 'TTL must be between 300 and 2592000 seconds'
      using errcode = '22023';
  end if;

  v_name := nullif(btrim(p_name), '');
  if char_length(v_name) > 80 then
    raise exception 'link name must be 80 characters or fewer' using errcode = '22023';
  end if;

  return query
  insert into organization_join_link (organization_id, created_by, expires_at, name)
  values (p_org, auth.uid(), now() + make_interval(secs => p_ttl_seconds), v_name)
  returning organization_join_link.id, organization_join_link.token, organization_join_link.expires_at, organization_join_link.name;
end;
$$;

create function rename_school_join_link(p_link_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select organization_id into v_org from organization_join_link where id = p_link_id;
  if not found then
    raise exception 'school link not found' using errcode = 'P0002';
  end if;
  if not is_org_staff(v_org) and not is_sysadmin() then
    raise exception 'not school staff' using errcode = '42501';
  end if;

  v_name := nullif(btrim(p_name), '');
  if char_length(v_name) > 80 then
    raise exception 'link name must be 80 characters or fewer' using errcode = '22023';
  end if;

  update organization_join_link
  set name = v_name
  where id = p_link_id;
end;
$$;

revoke all on function create_school_join_link(uuid, integer, text) from public, anon;
revoke all on function rename_school_join_link(uuid, text) from public, anon;
grant execute on function create_school_join_link(uuid, integer, text) to authenticated;
grant execute on function rename_school_join_link(uuid, text) to authenticated;
