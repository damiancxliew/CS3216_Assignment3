create table adventures_v3 (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references organization (id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'generating'
    check (status in ('generating', 'needs_review', 'draft', 'published', 'failed', 'archived')),
  spec jsonb,
  spec_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index adventures_v3_school_idx on adventures_v3 (school_id);
create index adventures_v3_owner_idx on adventures_v3 (owner_id);

create table adventure_versions_v3 (
  adventure_id uuid not null references adventures_v3 (id) on delete cascade,
  version integer not null,
  spec jsonb not null,
  created_at timestamptz not null default now(),
  primary key (adventure_id, version)
);

alter table adventures_v3 enable row level security;
alter table adventure_versions_v3 enable row level security;

revoke all on table adventures_v3 from anon, authenticated;
revoke all on table adventure_versions_v3 from anon, authenticated;
grant select, insert, update on table adventures_v3 to authenticated;
grant all on table adventures_v3 to service_role;
grant select on table adventure_versions_v3 to authenticated;
grant all on table adventure_versions_v3 to service_role;

create policy adventures_v3_select on adventures_v3
  for select to authenticated
  using (owner_id = auth.uid() or is_org_admin(school_id) or is_sysadmin());

create policy adventures_v3_insert on adventures_v3
  for insert to authenticated
  with check (owner_id = auth.uid() and can_author_in(school_id));

create policy adventures_v3_update on adventures_v3
  for update to authenticated
  using (owner_id = auth.uid() and can_author_in(school_id))
  with check (owner_id = auth.uid() and can_author_in(school_id));

create or replace function can_staff_adventure_v3(p_adventure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from adventures_v3 adventure
    where adventure.id = p_adventure_id
      and (
        adventure.owner_id = auth.uid()
        or is_org_admin(adventure.school_id)
        or is_sysadmin()
      )
  );
$$;

revoke all on function can_staff_adventure_v3(uuid) from public, anon, authenticated;
grant execute on function can_staff_adventure_v3(uuid) to authenticated, service_role;

create policy adventure_versions_v3_select on adventure_versions_v3
  for select to authenticated
  using (can_staff_adventure_v3(adventure_id));

create or replace function set_adventure_v3_spec_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.spec_version := case when new.spec is null then 0 else 1 end;
  elsif new.spec is distinct from old.spec and new.spec is not null then
    new.spec_version := old.spec_version + 1;
  else
    new.spec_version := old.spec_version;
  end if;
  return new;
end;
$$;

revoke all on function set_adventure_v3_spec_version() from public, anon, authenticated;
grant execute on function set_adventure_v3_spec_version() to service_role;

create trigger adventures_v3_set_spec_version
  before insert or update on adventures_v3
  for each row execute function set_adventure_v3_spec_version();

create or replace function snapshot_adventure_v3_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.spec is not null
    and (tg_op = 'INSERT' or new.spec_version is distinct from old.spec_version)
  then
    insert into adventure_versions_v3 (adventure_id, version, spec)
    values (new.id, new.spec_version, new.spec);
  end if;
  return new;
end;
$$;

revoke all on function snapshot_adventure_v3_version() from public, anon, authenticated;
grant execute on function snapshot_adventure_v3_version() to service_role;

create trigger adventures_v3_snapshot_version
  after insert or update on adventures_v3
  for each row execute function snapshot_adventure_v3_version();

create trigger adventures_v3_set_updated_at
  before update on adventures_v3
  for each row execute function set_updated_at();
