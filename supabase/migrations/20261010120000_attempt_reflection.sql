-- Student historical-judgement reflections, scoped to completed attempts.
create table attempt_reflection (
  attempt_id uuid not null references attempt (id) on delete cascade,
  prompt_key text not null check (prompt_key in ('factor', 'turning-point', 'evidence', 'inevitability')),
  choice text check (char_length(choice) <= 200),
  choice_label text check (char_length(choice_label) <= 300),
  stance text check (stance in ('inevitable', 'likely', 'open', 'unlikely')),
  response text not null check (char_length(btrim(response)) between 1 and 2000),
  counter text check (char_length(counter) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, prompt_key)
);

alter table attempt_reflection enable row level security;

revoke all on attempt_reflection from anon, authenticated;
grant select, insert, update on attempt_reflection to authenticated;

create policy attempt_reflection_select on attempt_reflection
  for select to authenticated
  using (owns_attempt(attempt_id) or teaches_attempt(attempt_id) or oversees_attempt(attempt_id));

create policy attempt_reflection_insert on attempt_reflection
  for insert to authenticated
  with check (
    owns_attempt(attempt_id)
    and exists (select 1 from attempt t where t.id = attempt_id and t.status = 'completed')
  );

create policy attempt_reflection_update on attempt_reflection
  for update to authenticated
  using (
    owns_attempt(attempt_id)
    and exists (select 1 from attempt t where t.id = attempt_id and t.status = 'completed')
  )
  with check (
    owns_attempt(attempt_id)
    and exists (select 1 from attempt t where t.id = attempt_id and t.status = 'completed')
  );
