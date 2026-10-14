create table attempts_v3 (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures_v3 (id) on delete cascade,
  spec_version integer not null,
  student_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (adventure_id, spec_version)
    references adventure_versions_v3 (adventure_id, version)
);

create index attempts_v3_adventure_student_idx on attempts_v3 (adventure_id, student_id);

alter table attempts_v3 enable row level security;
revoke all on table attempts_v3 from anon, authenticated;
grant select on table attempts_v3 to authenticated;
grant all on table attempts_v3 to service_role;

create policy attempts_v3_staff_select on attempts_v3
  for select to authenticated
  using (can_staff_adventure_v3(adventure_id));

create trigger attempts_v3_set_updated_at
  before update on attempts_v3
  for each row execute function set_updated_at();
