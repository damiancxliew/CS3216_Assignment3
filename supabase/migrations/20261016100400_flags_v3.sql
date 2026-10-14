create table flags_v3 (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts_v3 (id) on delete cascade,
  message_id text not null,
  category text not null,
  excerpt text not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  unique (attempt_id, message_id, category)
);

alter table flags_v3 enable row level security;
revoke all on table flags_v3 from anon, authenticated;
grant select on table flags_v3 to authenticated;
grant update (reviewed_at, reviewed_by) on table flags_v3 to authenticated;
grant all on table flags_v3 to service_role;

create policy flags_v3_staff_select on flags_v3
  for select to authenticated
  using (can_staff_attempt_v3(attempt_id));

create policy flags_v3_staff_update on flags_v3
  for update to authenticated
  using (can_staff_attempt_v3(attempt_id))
  with check (can_staff_attempt_v3(attempt_id));
