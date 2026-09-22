revoke all on attempt_state from anon, authenticated;
grant select (attempt_id, journal, player_pos, updated_at) on attempt_state to authenticated;

create or replace function save_play_state(
  p_attempt_id uuid,
  p_student_id uuid,
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_messages jsonb,
  p_decisions jsonb,
  p_resolution jsonb,
  p_opened_stage_id uuid,
  p_ending_id text
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_attempt attempt%rowtype;
  v_world jsonb;
  v_spec_id uuid;
  v_stage_ids uuid[];
  v_revision bigint;
  v_deadline timestamptz;
  r record;
begin
  select * into v_attempt from attempt
  where id = p_attempt_id and student_id = p_student_id
  for update;
  if not found then
    raise exception 'attempt not found' using errcode = '42501';
  end if;
  if v_attempt.status not in ('active', 'spectating') then
    raise exception 'attempt is closed' using errcode = '40001';
  end if;

  select world_state into v_world from attempt_state
  where attempt_id = p_attempt_id for update;
  if not found then
    raise exception 'attempt state not found' using errcode = 'P0002';
  end if;
  v_revision := coalesce((v_world->>'revision')::bigint, -1);
  if p_expected_revision is null or p_expected_revision <> v_revision then
    raise exception 'attempt revision conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot->'world') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'journal') is distinct from 'array'
     or coalesce((p_snapshot->>'revision')::bigint, -1) <= v_revision
     or jsonb_typeof(p_messages) is distinct from 'array'
     or jsonb_typeof(p_decisions) is distinct from 'array' then
    raise exception 'invalid play snapshot' using errcode = '22023';
  end if;

  select id into v_spec_id from spec_version
  where adventure_id = v_attempt.adventure_id and version = v_attempt.published_version;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_stage_ids from stage
  where spec_version_id = v_spec_id;
  v_deadline := v_attempt.stage_deadline_at;

  for r in select * from jsonb_to_recordset(p_messages) as m(
    room_id uuid, author_type message_author_type, author_id uuid,
    body text, visibility message_visibility, created_at timestamptz
  ) loop
    if r.room_id is not null and not exists (
      select 1 from room where id = r.room_id and stage_id = any(v_stage_ids)
    ) then
      raise exception 'message room is outside pinned version' using errcode = '22023';
    end if;
    if (r.author_type = 'player' and r.author_id is distinct from p_student_id)
       or (r.author_type = 'agent' and not exists (
         select 1 from agent where id = r.author_id and stage_id = any(v_stage_ids)
       )) then
      raise exception 'invalid message author' using errcode = '22023';
    end if;
    insert into message (attempt_id, room_id, author_type, author_id, body, visibility, created_at)
    values (p_attempt_id, r.room_id, r.author_type, r.author_id, r.body, r.visibility, r.created_at);
  end loop;

  for r in select * from jsonb_to_recordset(p_decisions) as d(
    stage_id uuid, actor_kind actor_kind, player_id uuid, agent_id uuid, option_id uuid
  ) loop
    if r.stage_id is null or not (r.stage_id = any(v_stage_ids))
       or (r.actor_kind = 'player' and r.player_id is distinct from p_student_id)
       or (r.actor_kind = 'agent' and not exists (
         select 1 from agent where id = r.agent_id and stage_id = r.stage_id
       ))
       or (r.option_id is not null and not exists (
         select 1 from decision_option where id = r.option_id and stage_id = r.stage_id
       )) then
      raise exception 'invalid stage commitment' using errcode = '22023';
    end if;
    insert into stage_commitment (attempt_id, stage_id, actor_kind, player_id, agent_id, option_id)
    values (p_attempt_id, r.stage_id, r.actor_kind, r.player_id, r.agent_id, r.option_id)
    on conflict do nothing;
    if exists (
      select 1 from stage_commitment c
      where c.attempt_id = p_attempt_id and c.stage_id = r.stage_id
        and coalesce(c.player_id, c.agent_id) = coalesce(r.player_id, r.agent_id)
        and c.option_id is distinct from r.option_id
    ) then
      raise exception 'stage commitment conflict' using errcode = '40001';
    end if;
  end loop;

  if p_resolution is not null and p_resolution <> 'null'::jsonb then
    if (p_resolution->>'stage_id') is null
       or not ((p_resolution->>'stage_id')::uuid = any(v_stage_ids)) then
      raise exception 'resolution stage is outside pinned version' using errcode = '22023';
    end if;
    insert into resolution (attempt_id, stage_id, actions, outcome, rolls)
    values (p_attempt_id, (p_resolution->>'stage_id')::uuid,
      p_resolution->'actions', p_resolution->'outcome', p_resolution->'rolls');
  end if;

  if p_ending_id is not null then
    if p_opened_stage_id is not null or not exists (
      select 1 from spec_version s, jsonb_array_elements(s.json->'endings') e
      where s.id = v_spec_id and e->>'id' = p_ending_id
    ) then
      raise exception 'invalid ending' using errcode = '22023';
    end if;
    perform complete_attempt(p_attempt_id, p_ending_id);
    v_deadline := null;
  elsif p_opened_stage_id is not null then
    if not (p_opened_stage_id = any(v_stage_ids)) then
      raise exception 'opened stage is outside pinned version' using errcode = '22023';
    end if;
    if p_opened_stage_id is distinct from v_attempt.current_stage_id then
      v_deadline := start_stage_deadline(p_attempt_id, p_opened_stage_id);
    end if;
  end if;

  update attempt_state set world_state = p_snapshot, journal = p_snapshot->'journal',
    player_pos = nullif(p_snapshot->'playerPos', 'null'::jsonb), updated_at = now()
  where attempt_id = p_attempt_id;
  return v_deadline;
end;
$$;

revoke all on function save_play_state(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function save_play_state(uuid, uuid, bigint, jsonb, jsonb, jsonb, jsonb, uuid, text)
  to service_role;
