-- Organizations and roles.
--
-- Each user belongs to at most one active school. Students join through
-- expiring links; staff membership controls authoring and admin oversight.

create type org_role as enum ('admin', 'teacher', 'student');
create type membership_status as enum ('active', 'removed');

create table organization (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table organization_member (
  organization_id uuid not null references organization (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role org_role not null,
  status membership_status not null default 'active',
  added_by uuid references auth.users (id) on delete set null,
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_member_user_idx on organization_member (user_id);
create unique index organization_member_one_active_school
  on organization_member (user_id) where status = 'active';

create trigger organization_member_set_updated_at
  before update on organization_member
  for each row execute function set_updated_at();

create table organization_join_link (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index organization_join_link_organization_idx
  on organization_join_link (organization_id);

create table organization_invite (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  email text not null check (email = lower(email)),
  role org_role not null check (role in ('admin', 'teacher')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  unique (organization_id, email)
);

create table platform_admin (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table adventure
  add column organization_id uuid references organization (id) on delete restrict;

create index adventure_organization_idx on adventure (organization_id);

insert into organization (id, name, slug)
values ('00000000-0000-4000-8000-000000005c01', 'Testing School', 'testing-school')
on conflict do nothing;

insert into organization_member (organization_id, user_id, role, status)
select
  '00000000-0000-4000-8000-000000005c01',
  users.id,
  'teacher',
  'active'
from (
  select owner_id as id from adventure
  union
  select '00000000-0000-4000-8000-000000000d3a'::uuid
  where exists (
    select 1 from auth.users where id = '00000000-0000-4000-8000-000000000d3a'
  )
) as users
on conflict do nothing;

insert into organization_member (organization_id, user_id, role, status)
select
  '00000000-0000-4000-8000-000000005c01',
  attempts.student_id,
  'student',
  'active'
from (
  select distinct student_id from attempt
) as attempts
where not exists (
  select 1 from organization_member member
  where member.user_id = attempts.student_id
)
on conflict do nothing;

update adventure
set organization_id = '00000000-0000-4000-8000-000000005c01'
where organization_id is null;

alter table adventure
  alter column organization_id set not null;

create or replace function adventure_default_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id
    from organization_member
    where user_id = new.owner_id
      and status = 'active'
      and role in ('admin', 'teacher');
  end if;
  return new;
end;
$$;

create trigger adventure_default_organization
  before insert on adventure
  for each row execute function adventure_default_organization();

revoke all on function adventure_default_organization() from public, anon, authenticated;

create or replace function is_sysadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_admin where user_id = auth.uid()
  );
$$;

create or replace function org_role_of(p_org uuid)
returns org_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from organization_member
  where organization_id = p_org
    and user_id = auth.uid()
    and status = 'active';
$$;

create or replace function is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select org_role_of(p_org) is not null;
$$;

create or replace function is_org_staff(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(org_role_of(p_org) in ('admin', 'teacher'), false);
$$;

create or replace function is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(org_role_of(p_org) = 'admin', false);
$$;

create or replace function can_author_in(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_org_staff(p_org) or is_sysadmin();
$$;

create or replace function oversees_adventure(p_adventure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from adventure a
    where a.id = p_adventure_id and is_org_admin(a.organization_id)
  );
$$;

create or replace function oversees_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from attempt t
    join adventure a on a.id = t.adventure_id
    where t.id = p_attempt_id and is_org_admin(a.organization_id)
  );
$$;

create or replace function can_play_adventure(p_adventure_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from adventure a
    join organization_member member on member.organization_id = a.organization_id
    where a.id = p_adventure_id
      and member.user_id = p_user
      and member.status = 'active'
  ) or exists (
    select 1 from platform_admin where user_id = p_user
  );
$$;

revoke all on function can_play_adventure(uuid, uuid) from public, anon, authenticated;
grant execute on function can_play_adventure(uuid, uuid) to service_role;

create or replace function can_read_spec_version(p_spec_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from spec_version sv
    where sv.id = p_spec_version_id
      and (
        is_adventure_owner(sv.adventure_id)
        or oversees_adventure(sv.adventure_id)
        or exists (
          select 1 from attempt t
          where t.adventure_id = sv.adventure_id
            and t.student_id = auth.uid()
            and t.published_version = sv.version
        )
      )
  );
$$;

drop policy adventure_select on adventure;
create policy adventure_select on adventure
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (status = 'published' and has_attempt_on_adventure(id))
    or oversees_adventure(id)
  );

drop policy adventure_insert_own on adventure;
create policy adventure_insert_own on adventure
  for insert to authenticated
  with check (owner_id = auth.uid() and can_author_in(organization_id));

drop policy adventure_update_own on adventure;
create policy adventure_update_own on adventure
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and can_author_in(organization_id));

drop policy source_select_owner on source;
create policy source_select_owner on source
  for select to authenticated
  using (is_adventure_owner(adventure_id) or oversees_adventure(adventure_id));

drop policy source_chunk_select_owner on source_chunk;
create policy source_chunk_select_owner on source_chunk
  for select to authenticated
  using (exists (
    select 1 from source s
    where s.id = source_chunk.source_id
      and (is_adventure_owner(s.adventure_id) or oversees_adventure(s.adventure_id))
  ));

drop policy attempt_select on attempt;
create policy attempt_select on attempt
  for select to authenticated
  using (
    student_id = auth.uid()
    or is_adventure_owner(adventure_id)
    or oversees_adventure(adventure_id)
  );

drop policy attempt_state_select on attempt_state;
create policy attempt_state_select on attempt_state
  for select to authenticated
  using (owns_attempt(attempt_id) or teaches_attempt(attempt_id) or oversees_attempt(attempt_id));

drop policy message_select on message;
create policy message_select on message
  for select to authenticated
  using (
    visibility = 'room'
    and (owns_attempt(attempt_id) or teaches_attempt(attempt_id) or oversees_attempt(attempt_id))
  );

drop policy stage_commitment_select on stage_commitment;
create policy stage_commitment_select on stage_commitment
  for select to authenticated
  using (owns_attempt(attempt_id) or teaches_attempt(attempt_id) or oversees_attempt(attempt_id));

drop policy minted_option_select on minted_option;
create policy minted_option_select on minted_option
  for select to authenticated
  using (owns_attempt(attempt_id) or teaches_attempt(attempt_id) or oversees_attempt(attempt_id));

drop policy attempt_telemetry_select on attempt_telemetry;
create policy attempt_telemetry_select on attempt_telemetry
  for select to authenticated
  using (teaches_attempt(attempt_id) or oversees_attempt(attempt_id));

alter table organization enable row level security;
alter table organization_member enable row level security;
alter table organization_join_link enable row level security;
alter table organization_invite enable row level security;
alter table platform_admin enable row level security;

revoke all on organization from anon;
revoke insert, update, delete on organization from authenticated;
revoke all on organization_member from anon;
revoke insert, update, delete on organization_member from authenticated;
revoke all on organization_join_link from anon;
revoke insert, update, delete on organization_join_link from authenticated;
revoke all on organization_invite from anon;
revoke insert, update, delete on organization_invite from authenticated;
revoke all on platform_admin from anon;
revoke insert, update, delete on platform_admin from authenticated;

create policy organization_select on organization
  for select to authenticated
  using (is_org_member(id) or is_sysadmin());

create policy organization_member_select on organization_member
  for select to authenticated
  using (user_id = auth.uid() or is_org_staff(organization_id) or is_sysadmin());

create policy organization_join_link_select on organization_join_link
  for select to authenticated
  using (is_org_staff(organization_id) or is_sysadmin());

create policy organization_invite_select on organization_invite
  for select to authenticated
  using (is_org_admin(organization_id) or is_sysadmin());

create policy platform_admin_select_self on platform_admin
  for select to authenticated
  using (user_id = auth.uid());

create or replace function create_school_join_link(p_org uuid, p_ttl_seconds integer)
returns table (id uuid, token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
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

  return query
  insert into organization_join_link (organization_id, created_by, expires_at)
  values (p_org, auth.uid(), now() + make_interval(secs => p_ttl_seconds))
  returning organization_join_link.id, organization_join_link.token, organization_join_link.expires_at;
end;
$$;

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
  set revoked_at = coalesce(revoked_at, now())
  where id = p_link_id;
end;
$$;

create or replace function school_link_preview(p_token uuid)
returns table (organization_id uuid, name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select link.organization_id, org.name, link.expires_at
  from organization_join_link link
  join organization org on org.id = link.organization_id
  where link.token = p_token
    and link.revoked_at is null
    and link.expires_at > now();
$$;

create or replace function enroll_with_school_token(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_status membership_status;
begin
  if v_user is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select organization_id into v_org
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

  insert into organization_member (organization_id, user_id, role, status)
  values (v_org, v_user, 'student', 'active');
  return v_org;
end;
$$;

create or replace function remove_student(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role org_role;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not is_org_staff(p_org) and not is_sysadmin() then
    raise exception 'not school staff' using errcode = '42501';
  end if;

  select role into v_role from organization_member
  where organization_id = p_org and user_id = p_user;
  if not found then
    raise exception 'school member not found' using errcode = 'P0002';
  end if;
  if v_role <> 'student' then
    raise exception 'target is not a student' using errcode = '42501';
  end if;

  update organization_member
  set status = 'removed', removed_by = auth.uid(), removed_at = now()
  where organization_id = p_org and user_id = p_user;
end;
$$;

create or replace function restore_student(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role org_role;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not is_org_staff(p_org) and not is_sysadmin() then
    raise exception 'not school staff' using errcode = '42501';
  end if;

  select role into v_role from organization_member
  where organization_id = p_org and user_id = p_user;
  if not found then
    raise exception 'school member not found' using errcode = 'P0002';
  end if;
  if v_role <> 'student' then
    raise exception 'target is not a student' using errcode = '42501';
  end if;

  update organization_member
  set status = 'active', removed_by = null, removed_at = null
  where organization_id = p_org and user_id = p_user;
end;
$$;

create or replace function invite_staff(p_org uuid, p_email text, p_role org_role)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not is_org_admin(p_org) and not is_sysadmin() then
    raise exception 'only school admins may manage staff' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'teacher') or p_role is null then
    raise exception 'staff role must be admin or teacher' using errcode = '22023';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'email is required' using errcode = '22023';
  end if;

  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if found then
    if exists (
      select 1 from organization_member
      where user_id = v_user and status = 'active' and organization_id <> p_org
    ) then
      raise exception 'user is already active in another school' using errcode = '23505';
    end if;

    insert into organization_member (organization_id, user_id, role, status, added_by, removed_by, removed_at)
    values (p_org, v_user, p_role, 'active', auth.uid(), null, null)
    on conflict (organization_id, user_id) do update
      set role = excluded.role,
          status = 'active',
          added_by = excluded.added_by,
          removed_by = null,
          removed_at = null;
    return 'added';
  end if;

  insert into organization_invite (organization_id, email, role, invited_by, accepted_at, accepted_by)
  values (p_org, v_email, p_role, auth.uid(), null, null)
  on conflict (organization_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        accepted_at = null,
        accepted_by = null;
  return 'invited';
end;
$$;

create or replace function set_member_role(p_org uuid, p_user uuid, p_role org_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target organization_member%rowtype;
  v_active_admins integer;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not is_org_admin(p_org) and not is_sysadmin() then
    raise exception 'only school admins may manage staff' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'role is required' using errcode = '22023';
  end if;
  perform 1 from organization where id = p_org for update;
  select * into v_target from organization_member
  where organization_id = p_org and user_id = p_user
  for update;
  if not found then
    raise exception 'school member not found' using errcode = 'P0002';
  end if;

  if v_target.status = 'active' and v_target.role = 'admin' and p_role <> 'admin' then
    select count(*) into v_active_admins from organization_member
    where organization_id = p_org and status = 'active' and role = 'admin';
    if v_active_admins = 1 then
      raise exception 'a school needs at least one admin' using errcode = 'P0001';
    end if;
  end if;

  update organization_member set role = p_role
  where organization_id = p_org and user_id = p_user;
end;
$$;

create or replace function remove_staff_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target organization_member%rowtype;
  v_active_admins integer;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not is_org_admin(p_org) and not is_sysadmin() then
    raise exception 'only school admins may manage staff' using errcode = '42501';
  end if;
  perform 1 from organization where id = p_org for update;
  select * into v_target from organization_member
  where organization_id = p_org and user_id = p_user
  for update;
  if not found then
    raise exception 'school member not found' using errcode = 'P0002';
  end if;
  if v_target.role not in ('admin', 'teacher') then
    raise exception 'target is not staff' using errcode = '42501';
  end if;

  if v_target.status = 'active' and v_target.role = 'admin' then
    select count(*) into v_active_admins from organization_member
    where organization_id = p_org and status = 'active' and role = 'admin';
    if v_active_admins = 1 then
      raise exception 'a school needs at least one admin' using errcode = 'P0001';
    end if;
  end if;

  delete from organization_member
  where organization_id = p_org and user_id = p_user;
end;
$$;

create or replace function _claim_staff_invites(p_user uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite organization_invite%rowtype;
  v_claimed integer := 0;
begin
  for v_invite in
    select * from organization_invite
    where accepted_at is null and email = lower(p_email)
    order by created_at
    for update
  loop
    if exists (
      select 1 from organization_member
      where user_id = p_user and status = 'active'
        and organization_id <> v_invite.organization_id
    ) then
      continue;
    end if;

    insert into organization_member (
      organization_id, user_id, role, status, added_by, removed_by, removed_at
    )
    values (
      v_invite.organization_id, p_user, v_invite.role, 'active',
      v_invite.invited_by, null, null
    )
    on conflict (organization_id, user_id) do update
      set role = excluded.role,
          status = 'active',
          added_by = excluded.added_by,
          removed_by = null,
          removed_at = null;

    update organization_invite
    set accepted_at = now(), accepted_by = p_user
    where id = v_invite.id;
    v_claimed := v_claimed + 1;
  end loop;
  return v_claimed;
end;
$$;

create or replace function claim_staff_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return 0;
  end if;
  return _claim_staff_invites(auth.uid(), v_email);
end;
$$;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  if new.email is not null then
    perform _claim_staff_invites(new.id, lower(new.email));
  end if;
  return new;
end;
$$;

create or replace function _admit_to_adventure(p_adventure adventure, p_student uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_id uuid;
begin
  select id into v_attempt_id
  from attempt
  where adventure_id = p_adventure.id
    and student_id = p_student
    and status in ('active', 'spectating')
  order by created_at
  limit 1;

  if found then
    return v_attempt_id;
  end if;

  if not p_adventure.allow_retries then
    select id into v_attempt_id
    from attempt
    where adventure_id = p_adventure.id
      and student_id = p_student
    order by created_at desc
    limit 1;

    if found then
      return v_attempt_id;
    end if;
  end if;

  return start_attempt(p_adventure.id, p_student);
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
  if not can_play_adventure(v_adventure.id, v_student) then
    raise exception 'join this school before playing' using errcode = '42501';
  end if;

  return _admit_to_adventure(v_adventure, v_student);
end;
$$;

create or replace function start_adventure(p_adventure_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_student uuid := auth.uid();
  v_adventure adventure%rowtype;
begin
  if v_student is null then
    raise exception 'sign in required to start an adventure' using errcode = '42501';
  end if;
  select * into v_adventure from adventure
  where id = p_adventure_id
    and status = 'published'
    and published_version is not null;
  if not found then
    raise exception 'this adventure is not open for play' using errcode = 'P0002';
  end if;
  if not can_play_adventure(v_adventure.id, v_student) then
    raise exception 'join this school before playing' using errcode = '42501';
  end if;
  return _admit_to_adventure(v_adventure, v_student);
end;
$$;

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
  if not can_play_adventure(v_attempt.adventure_id, v_student) then
    raise exception 'join this school before playing' using errcode = '42501';
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

create or replace function list_library()
returns table (
  adventure_id uuid,
  organization_id uuid,
  title text,
  setting text,
  teacher_name text,
  allow_retries boolean,
  latest_attempt_id uuid,
  latest_attempt_status attempt_status,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.organization_id,
    a.title,
    a.setting,
    p.display_name,
    a.allow_retries,
    latest.id,
    latest.status,
    a.updated_at
  from adventure a
  join organization_member membership
    on membership.organization_id = a.organization_id
   and membership.user_id = auth.uid()
   and membership.status = 'active'
  left join profile p on p.id = a.owner_id
  left join lateral (
    select t.id, t.status
    from attempt t
    where t.adventure_id = a.id
      and t.student_id = auth.uid()
    order by (t.status in ('active', 'spectating')) desc, t.created_at desc
    limit 1
  ) latest on true
  where a.status = 'published'
    and a.published_version is not null
  order by a.updated_at desc;
$$;

revoke all on function create_school_join_link(uuid, integer) from public, anon;
revoke all on function revoke_school_join_link(uuid) from public, anon;
revoke all on function school_link_preview(uuid) from public, anon;
revoke all on function enroll_with_school_token(uuid) from public, anon;
revoke all on function remove_student(uuid, uuid) from public, anon;
revoke all on function restore_student(uuid, uuid) from public, anon;
revoke all on function invite_staff(uuid, text, org_role) from public, anon;
revoke all on function set_member_role(uuid, uuid, org_role) from public, anon;
revoke all on function remove_staff_member(uuid, uuid) from public, anon;
revoke all on function _claim_staff_invites(uuid, text) from public, anon, authenticated;
revoke all on function claim_staff_invites() from public, anon;
revoke all on function _admit_to_adventure(adventure, uuid) from public, anon, authenticated;
revoke all on function join_adventure(uuid) from public, anon;
revoke all on function start_adventure(uuid) from public, anon;
revoke all on function restart_attempt(uuid) from public, anon;
revoke all on function list_library() from public, anon;
revoke all on function start_attempt(uuid, uuid) from public, anon, authenticated;

grant execute on function create_school_join_link(uuid, integer) to authenticated;
grant execute on function revoke_school_join_link(uuid) to authenticated;
grant execute on function school_link_preview(uuid) to anon, authenticated;
grant execute on function enroll_with_school_token(uuid) to authenticated;
grant execute on function remove_student(uuid, uuid) to authenticated;
grant execute on function restore_student(uuid, uuid) to authenticated;
grant execute on function invite_staff(uuid, text, org_role) to authenticated;
grant execute on function set_member_role(uuid, uuid, org_role) to authenticated;
grant execute on function remove_staff_member(uuid, uuid) to authenticated;
grant execute on function claim_staff_invites() to authenticated;
grant execute on function join_adventure(uuid) to authenticated;
grant execute on function start_adventure(uuid) to authenticated;
grant execute on function restart_attempt(uuid) to authenticated;
grant execute on function list_library() to authenticated;
