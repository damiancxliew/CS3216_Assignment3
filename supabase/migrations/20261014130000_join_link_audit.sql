alter table organization_join_link
  add column revoked_by uuid references auth.users (id) on delete set null;

alter table organization_member
  add column joined_via_link uuid references organization_join_link (id) on delete set null;

create or replace function revoke_school_join_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
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

  update organization_join_link
  set revoked_by = case when revoked_at is null then auth.uid() else revoked_by end,
      revoked_at = coalesce(revoked_at, now())
  where id = p_link_id;
end;
$$;

create or replace function enroll_with_school_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_link uuid;
  v_org uuid;
  v_status membership_status;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select organization_join_link.id, organization_join_link.organization_id into v_link, v_org
  from organization_join_link
  where token = p_token
    and revoked_at is null
    and expires_at > now();
  if not found then
    raise exception 'school link is invalid or expired' using errcode = 'P0002';
  end if;

  select status into v_status
  from organization_member
  where organization_id = v_org and user_id = v_user;
  if found then
    if v_status = 'active' then
      return v_org;
    end if;
    raise exception 'you were removed from this school' using errcode = '42501';
  end if;

  if exists (
    select 1 from organization_member
    where user_id = v_user and status = 'active'
  ) then
    raise exception 'you are already active in another school' using errcode = '23505';
  end if;

  insert into organization_member (organization_id, user_id, role, status, joined_via_link)
  values (v_org, v_user, 'student', 'active', v_link);
  return v_org;
end;
$$;
