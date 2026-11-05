drop function save_attempt_v3(uuid, integer, jsonb, jsonb);

create function save_attempt_v3(
  p_attempt_id uuid,
  p_expected_revision integer,
  p_state jsonb,
  p_events jsonb,
  p_flags jsonb default '[]'::jsonb
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

  insert into flags_v3 (attempt_id, message_id, category, excerpt, result)
  select p_attempt_id, f.value ->> 'messageId', f.value ->> 'category', f.value ->> 'excerpt', coalesce(f.value -> 'result', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_flags, '[]'::jsonb)) as f(value)
  on conflict (attempt_id, message_id, category) do nothing;

  return jsonb_build_object(
    'saved', true,
    'revision', v_revision,
    'first_seq', case when v_event_count > 0 then v_first_seq else null end
  );
end;
$$;

revoke all on function save_attempt_v3(uuid, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function save_attempt_v3(uuid, integer, jsonb, jsonb, jsonb) to service_role;
