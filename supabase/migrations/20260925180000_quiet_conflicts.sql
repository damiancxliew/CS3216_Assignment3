create or replace function save_play_turn(
  p_attempt_id uuid,
  p_expected_revision bigint,
  p_stage_spec_id text,
  p_snapshot jsonb,
  p_messages jsonb,
  p_commitments jsonb,
  p_resolution jsonb,
  p_telemetry jsonb,
  p_opened_stage_id uuid,
  p_ending_id text,
  p_minted_options jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_attempt attempt%rowtype;
  v_spec_id uuid;
  v_stage_ids uuid[];
  v_revision bigint;
  v_deadline timestamptz;
  v_minted_option_id uuid;
  r record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'runtime writes require the service role' using errcode = '42501';
  end if;
  select * into v_attempt from attempt where id = p_attempt_id for update;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'active' then
    return jsonb_build_object('conflict', 'inactive');
  end if;
  select revision into v_revision from attempt_runtime where attempt_id = p_attempt_id for update;
  v_revision := coalesce(v_revision, 0);
  if p_expected_revision is null or p_expected_revision <> v_revision then
    return jsonb_build_object('conflict', 'revision');
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot->'world') is distinct from 'object'
     or jsonb_typeof(p_snapshot->'journal') is distinct from 'array'
     or jsonb_typeof(p_messages) is distinct from 'array'
     or jsonb_typeof(p_commitments) is distinct from 'array'
     or (p_minted_options is not null and jsonb_typeof(p_minted_options) is distinct from 'array') then
    raise exception 'invalid turn payload' using errcode = '22023';
  end if;
  select id into v_spec_id from spec_version
  where adventure_id = v_attempt.adventure_id and version = v_attempt.published_version;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_stage_ids from stage where spec_version_id = v_spec_id;
  if not exists (
    select 1 from stage where spec_version_id = v_spec_id and spec_id = p_stage_spec_id
      and index = (p_snapshot->>'stageIndex')::integer
  ) then
    raise exception 'snapshot stage is outside pinned version' using errcode = '22023';
  end if;

  for r in select * from jsonb_to_recordset(p_minted_options) as m(
    stage_id uuid, spec_id text, label text, preconditions jsonb, branch_target uuid
  ) loop
    if r.stage_id is null or not (r.stage_id = any(v_stage_ids))
       or r.spec_id is null or r.spec_id = ''
       or r.label is null or r.label = ''
       or r.preconditions is null
       or (r.branch_target is not null and not (r.branch_target = any(v_stage_ids))) then
      raise exception 'invalid minted option' using errcode = '22023';
    end if;
    insert into minted_option (attempt_id, stage_id, spec_id, label, preconditions, branch_target)
    values (p_attempt_id, r.stage_id, r.spec_id, r.label, r.preconditions, r.branch_target)
    on conflict (attempt_id, spec_id) do nothing;
  end loop;

  for r in select * from jsonb_to_recordset(p_messages) as m(
    runtime_id text, room_id uuid, author_type message_author_type, author_id uuid,
    body text, visibility message_visibility, created_at timestamptz
  ) loop
    if r.runtime_id is null or r.runtime_id = '' then
      raise exception 'message runtime id is required' using errcode = '22023';
    end if;
    if r.room_id is not null and not exists (select 1 from room where id = r.room_id and stage_id = any(v_stage_ids)) then
      raise exception 'message room is outside pinned version' using errcode = '22023';
    end if;
    if (r.author_type = 'player' and r.author_id is distinct from v_attempt.student_id)
       or (r.author_type = 'agent' and not exists (select 1 from agent where id = r.author_id and stage_id = any(v_stage_ids))) then
      raise exception 'invalid message author' using errcode = '22023';
    end if;
    insert into message (attempt_id, runtime_id, room_id, author_type, author_id, body, visibility, created_at)
    values (p_attempt_id, r.runtime_id, r.room_id, r.author_type, r.author_id, r.body, r.visibility, r.created_at)
    on conflict (attempt_id, runtime_id) do nothing;
    if exists (
      select 1 from message m where m.attempt_id = p_attempt_id and m.runtime_id = r.runtime_id
        and (m.body is distinct from r.body or m.room_id is distinct from r.room_id
          or m.author_type is distinct from r.author_type or m.author_id is distinct from r.author_id
          or m.visibility is distinct from r.visibility)
    ) then raise exception 'message replay conflict' using errcode = '40001'; end if;
  end loop;

  for r in select * from jsonb_to_recordset(p_commitments) as c(
    stage_id uuid, actor_kind actor_kind, player_id uuid, agent_id uuid,
    option_id uuid, minted_spec_id text
  ) loop
    v_minted_option_id := null;
    if r.minted_spec_id is not null then
      select id into v_minted_option_id
      from minted_option
      where attempt_id = p_attempt_id
        and stage_id = r.stage_id
        and spec_id = r.minted_spec_id;
      if not found then
        raise exception 'invalid stage commitment' using errcode = '22023';
      end if;
    end if;
    if r.stage_id is null or not (r.stage_id = any(v_stage_ids))
       or (r.actor_kind = 'player' and r.player_id is distinct from v_attempt.student_id)
       or (r.actor_kind = 'agent' and not exists (select 1 from agent where id = r.agent_id and stage_id = r.stage_id))
       or (r.option_id is not null and r.minted_spec_id is not null)
       or (r.option_id is not null and not exists (select 1 from decision_option where id = r.option_id and stage_id = r.stage_id))
       then
      raise exception 'invalid stage commitment' using errcode = '22023';
    end if;
    insert into stage_commitment (attempt_id, stage_id, actor_kind, player_id, agent_id, option_id, minted_option_id)
    values (p_attempt_id, r.stage_id, r.actor_kind, r.player_id, r.agent_id, r.option_id, v_minted_option_id)
    on conflict do nothing;
    if exists (
      select 1 from stage_commitment c where c.attempt_id = p_attempt_id and c.stage_id = r.stage_id
        and coalesce(c.player_id, c.agent_id) = coalesce(r.player_id, r.agent_id)
        and (c.option_id is distinct from r.option_id or c.minted_option_id is distinct from v_minted_option_id)
    ) then raise exception 'commitment replay conflict' using errcode = '40001'; end if;
  end loop;

  if p_resolution is not null and p_resolution <> 'null'::jsonb then
    if (p_resolution->>'stage_id') is null or not ((p_resolution->>'stage_id')::uuid = any(v_stage_ids)) then
      raise exception 'resolution stage is outside pinned version' using errcode = '22023';
    end if;
    insert into resolution (attempt_id, stage_id, actions, outcome, rolls)
    values (p_attempt_id, (p_resolution->>'stage_id')::uuid, p_resolution->'actions', p_resolution->'outcome', p_resolution->'rolls');
  end if;

  if p_telemetry is not null and p_telemetry <> 'null'::jsonb then
    select * into r from jsonb_to_record(p_telemetry) as t(
      stage_id uuid, stage_index integer, ended_by text, duration_seconds integer,
      tokens integer, messages integer, actions integer, evidence_found integer, agent_lines integer
    );
    if not exists (select 1 from stage where id = r.stage_id and spec_version_id = v_spec_id and index = r.stage_index) then
      raise exception 'telemetry stage is outside pinned version' using errcode = '22023';
    end if;
    insert into attempt_telemetry (attempt_id, stage_id, stage_index, ended_by, duration_seconds, tokens, messages, actions, evidence_found, agent_lines)
    values (p_attempt_id, r.stage_id, r.stage_index, r.ended_by, r.duration_seconds, r.tokens, r.messages, r.actions, r.evidence_found, r.agent_lines);
  end if;

  v_deadline := v_attempt.stage_deadline_at;
  if p_ending_id is not null then
    if p_opened_stage_id is not null or p_snapshot->>'status' is distinct from 'completed'
       or p_snapshot->>'endingId' is distinct from p_ending_id
       or not exists (select 1 from spec_version s, jsonb_array_elements(s.json->'endings') e where s.id = v_spec_id and e->>'id' = p_ending_id) then
      raise exception 'invalid ending' using errcode = '22023';
    end if;
    perform complete_attempt(p_attempt_id, p_ending_id);
    v_deadline := null;
  else
    if p_snapshot->>'status' is distinct from 'active' then
      raise exception 'active turn requires an active snapshot' using errcode = '22023';
    end if;
    if p_opened_stage_id is not null then
      if not exists (select 1 from stage where id = p_opened_stage_id and spec_version_id = v_spec_id and spec_id = p_stage_spec_id) then
        raise exception 'opened stage does not match snapshot' using errcode = '22023';
      end if;
      if p_opened_stage_id is distinct from v_attempt.current_stage_id then
        v_deadline := start_stage_deadline(p_attempt_id, p_opened_stage_id);
      end if;
    elsif not exists (select 1 from stage where id = v_attempt.current_stage_id and spec_id = p_stage_spec_id) then
      raise exception 'snapshot stage changed without a transition' using errcode = '40001';
    end if;
  end if;

  insert into attempt_runtime (attempt_id, stage_spec_id, revision, snapshot)
  values (p_attempt_id, p_stage_spec_id, v_revision + 1, p_snapshot)
  on conflict (attempt_id) do update set stage_spec_id = excluded.stage_spec_id, revision = excluded.revision, snapshot = excluded.snapshot;

  update attempt_state set
    world_state = jsonb_build_object('version', p_snapshot->'version', 'stageIndex', p_snapshot->'stageIndex', 'status', p_snapshot->'status', 'endingId', p_snapshot->'endingId', 'revision', p_snapshot->'revision'),
    journal = p_snapshot->'journal', player_pos = nullif(p_snapshot->'playerPos', 'null'::jsonb), updated_at = now()
  where attempt_id = p_attempt_id;
  if not found then raise exception 'public attempt state missing' using errcode = 'P0002'; end if;
  return jsonb_build_object('runtimeRevision', v_revision + 1, 'stageDeadlineAt', v_deadline);
end;
$$;

revoke all on function save_play_turn(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function save_play_turn(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb)
  to service_role;
