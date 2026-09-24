-- Teacher-only progress for the long-running story planner. The model call has
-- no reliable percentage, so the UI reports the last completed phase instead.
create table generation_job (
  adventure_id uuid primary key references adventure (id) on delete cascade,
  state text not null check (state in ('running', 'completed', 'failed')),
  phase text not null check (phase in ('preparing', 'planning', 'checking', 'repairing', 'saving', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table generation_job enable row level security;
grant select on generation_job to authenticated;

create policy generation_job_select_owner on generation_job
  for select to authenticated
  using (is_adventure_owner(adventure_id));

revoke insert, update, delete on generation_job from anon, authenticated;
