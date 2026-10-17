create table attempt_events_v3 (
  attempt_id uuid not null references attempts_v3 (id) on delete cascade,
  seq integer not null,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (attempt_id, seq)
);

alter table attempt_events_v3 enable row level security;
revoke all on table attempt_events_v3 from anon, authenticated;
grant select on table attempt_events_v3 to authenticated;
grant all on table attempt_events_v3 to service_role;

create or replace function can_staff_attempt_v3(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from attempts_v3 attempt
    where attempt.id = p_attempt_id
      and can_staff_adventure_v3(attempt.adventure_id)
  );
$$;

revoke all on function can_staff_attempt_v3(uuid) from public, anon, authenticated;
grant execute on function can_staff_attempt_v3(uuid) to authenticated, service_role;

create policy attempt_events_v3_staff_select on attempt_events_v3
  for select to authenticated
  using (can_staff_attempt_v3(attempt_id));

create or replace function save_attempt_v3(
  p_attempt_id uuid,
  p_expected_revision integer,
  p_state jsonb,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision integer;
  v_first_seq integer;
  v_event_count integer;
begin
  update attempts_v3
  set state = p_state,
      revision = revision + 1
  where id = p_attempt_id
    and revision = p_expected_revision
  returning revision into v_revision;

  if not found then
    select revision into v_revision from attempts_v3 where id = p_attempt_id;
    return jsonb_build_object('saved', false, 'revision', v_revision);
  end if;

  v_event_count := jsonb_array_length(p_events);
  if v_event_count > 0 then
    select coalesce(max(seq), 0) + 1
      into v_first_seq
      from attempt_events_v3
      where attempt_id = p_attempt_id;

    insert into attempt_events_v3 (attempt_id, seq, type, payload)
    select
      p_attempt_id,
      v_first_seq + event.ordinality::integer - 1,
      event.value ->> 'type',
      coalesce(event.value -> 'payload', '{}'::jsonb)
    from jsonb_array_elements(p_events) with ordinality as event(value, ordinality);
  end if;

  return jsonb_build_object(
    'saved', true,
    'revision', v_revision,
    'first_seq', case when v_event_count > 0 then v_first_seq else null end
  );
end;
$$;

revoke all on function save_attempt_v3(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function save_attempt_v3(uuid, integer, jsonb, jsonb) to service_role;
