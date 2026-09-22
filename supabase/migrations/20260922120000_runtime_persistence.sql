alter table stage add column spec_id text;
alter table room add column spec_id text;
alter table agent add column spec_id text;
alter table evidence add column spec_id text;
alter table objective add column spec_id text;
alter table decision_option add column spec_id text;

update stage as relational
set spec_id = authored.value ->> 'id'
from spec_version as version
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stages', '[]'::jsonb)
) as authored(value)
where relational.spec_version_id = version.id
  and relational.index = (authored.value ->> 'index')::integer;

update room as relational
set spec_id = authored_room.value ->> 'id'
from stage as relational_stage
join spec_version as version on version.id = relational_stage.spec_version_id
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stages', '[]'::jsonb)
) as authored_stage(value)
cross join lateral jsonb_array_elements(
  coalesce(authored_stage.value -> 'rooms', '[]'::jsonb)
) as authored_room(value)
where relational.stage_id = relational_stage.id
  and authored_stage.value ->> 'id' = relational_stage.spec_id
  and authored_room.value ->> 'name' = relational.name
  and authored_room.value ->> 'purpose' = coalesce(relational.purpose, '')
  and authored_room.value ->> 'doorDefault' = relational.door_default::text;

update agent as relational
set spec_id = authored_agent.value ->> 'id'
from stage as relational_stage
join spec_version as version on version.id = relational_stage.spec_version_id
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stages', '[]'::jsonb)
) as authored_stage(value)
cross join lateral jsonb_array_elements(
  coalesce(authored_stage.value -> 'agents', '[]'::jsonb)
) as authored_agent(value)
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stakeholders', '[]'::jsonb)
) as stakeholder(value)
where relational.stage_id = relational_stage.id
  and authored_stage.value ->> 'id' = relational_stage.spec_id
  and stakeholder.value ->> 'id' = authored_agent.value ->> 'stakeholderId'
  and stakeholder.value ->> 'name' = relational.name
  and authored_agent.value -> 'publicPosition' ->> 'text' = coalesce(relational.public_position, '')
  and authored_agent.value ->> 'startRoomId' = (
    select mapped_room.spec_id from room as mapped_room where mapped_room.id = relational.start_room_id
  );

update evidence as relational
set spec_id = authored_evidence.value ->> 'id'
from stage as relational_stage
join spec_version as version on version.id = relational_stage.spec_version_id
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stages', '[]'::jsonb)
) as authored_stage(value)
cross join lateral jsonb_array_elements(
  coalesce(authored_stage.value -> 'evidence', '[]'::jsonb)
) as authored_evidence(value)
where relational.stage_id = relational_stage.id
  and authored_stage.value ->> 'id' = relational_stage.spec_id
  and authored_evidence.value -> 'content' ->> 'text' = relational.text
  and authored_evidence.value ->> 'roomId' = (
    select mapped_room.spec_id from room as mapped_room where mapped_room.id = relational.room_id
  );

update objective as relational
set spec_id = authored_objective.value ->> 'id'
from stage as relational_stage
join spec_version as version on version.id = relational_stage.spec_version_id
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stages', '[]'::jsonb)
) as authored_stage(value)
cross join lateral jsonb_array_elements(
  coalesce(authored_stage.value -> 'objectives', '[]'::jsonb)
) as authored_objective(value)
where relational.stage_id = relational_stage.id
  and authored_stage.value ->> 'id' = relational_stage.spec_id
  and authored_objective.value ->> 'title' = relational.title;

update decision_option as relational
set spec_id = authored_option.value ->> 'id'
from stage as relational_stage
join spec_version as version on version.id = relational_stage.spec_version_id
cross join lateral jsonb_array_elements(
  coalesce(version.json -> 'stages', '[]'::jsonb)
) as authored_stage(value)
cross join lateral jsonb_array_elements(
  coalesce(authored_stage.value -> 'decision' -> 'options', '[]'::jsonb)
) as authored_option(value)
where relational.stage_id = relational_stage.id
  and authored_stage.value ->> 'id' = relational_stage.spec_id
  and authored_option.value ->> 'label' = relational.label;

create unique index stage_spec_id_idx
  on stage (spec_version_id, spec_id)
  where spec_id is not null;
create unique index room_spec_id_idx
  on room (stage_id, spec_id)
  where spec_id is not null;
create unique index agent_spec_id_idx
  on agent (stage_id, spec_id)
  where spec_id is not null;
create unique index evidence_spec_id_idx
  on evidence (stage_id, spec_id)
  where spec_id is not null;
create unique index objective_spec_id_idx
  on objective (stage_id, spec_id)
  where spec_id is not null;
create unique index decision_option_spec_id_idx
  on decision_option (stage_id, spec_id)
  where spec_id is not null;

alter table message add column runtime_id text;
create unique index message_runtime_id_idx
  on message (attempt_id, runtime_id);
create unique index resolution_attempt_stage_idx
  on resolution (attempt_id, stage_id);

create table attempt_runtime (
  attempt_id uuid primary key references attempt (id) on delete cascade,
  stage_spec_id text not null,
  revision bigint not null check (revision >= 1),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger attempt_runtime_set_updated_at
  before update on attempt_runtime
  for each row execute function set_updated_at();

alter table attempt_runtime enable row level security;
revoke all on attempt_runtime from public, anon, authenticated;

create or replace function save_attempt_runtime(
  p_attempt_id uuid,
  p_expected_revision bigint,
  p_stage_spec_id text,
  p_snapshot jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'attempt runtime writes require the service role' using errcode = '42501';
  end if;

  select revision into v_revision
  from attempt_runtime
  where attempt_id = p_attempt_id
  for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception 'attempt runtime revision conflict: expected %, found no row', p_expected_revision
        using errcode = '40001';
    end if;

    insert into attempt_runtime (attempt_id, stage_spec_id, revision, snapshot)
    values (p_attempt_id, p_stage_spec_id, 1, p_snapshot);
    return 1;
  end if;

  if v_revision <> p_expected_revision then
    raise exception 'attempt runtime revision conflict: expected %, found %', p_expected_revision, v_revision
      using errcode = '40001';
  end if;

  update attempt_runtime
  set stage_spec_id = p_stage_spec_id,
      revision = v_revision + 1,
      snapshot = p_snapshot
  where attempt_id = p_attempt_id;

  return v_revision + 1;
end;
$$;

revoke all on function save_attempt_runtime(uuid, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function save_attempt_runtime(uuid, bigint, text, jsonb)
  to service_role;

create or replace function create_draft_version(p_adventure_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_source_spec uuid;
  v_new_spec uuid;
  v_version integer;
  v_id uuid;
  r record;
begin
  if not is_adventure_owner(p_adventure_id) then
    raise exception 'not your adventure' using errcode = '42501';
  end if;

  select id into v_source_spec
  from spec_version
  where adventure_id = p_adventure_id
  order by version desc
  limit 1;

  if v_source_spec is null then
    raise exception 'this adventure has no version to copy' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from spec_version
    where adventure_id = p_adventure_id and published_at is null
  ) then
    raise exception 'this adventure already has an unpublished draft'
      using errcode = '23505';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from spec_version where adventure_id = p_adventure_id;

  create temporary table if not exists clone_map (
    old uuid primary key,
    new uuid not null
  ) on commit drop;
  truncate clone_map;

  insert into spec_version (adventure_id, version, json, generator_version, created_by)
  select adventure_id, v_version, json, generator_version, auth.uid()
  from spec_version where id = v_source_spec
  returning id into v_new_spec;

  for r in select * from stage where spec_version_id = v_source_spec order by index loop
    insert into stage (
      spec_version_id, spec_id, index, title, shared_context, timer_seconds,
      branch_map, ambient_overlay, overlay_intensity
    )
    values (
      v_new_spec, r.spec_id, r.index, r.title, r.shared_context, r.timer_seconds,
      r.branch_map, r.ambient_overlay, r.overlay_intensity
    )
    returning id into v_id;
    insert into clone_map values (r.id, v_id);
  end loop;

  for r in
    select room.* from room
    join clone_map m on m.old = room.stage_id
  loop
    insert into room (stage_id, spec_id, name, purpose, door_default)
    values (
      (select new from clone_map where old = r.stage_id),
      r.spec_id, r.name, r.purpose, r.door_default
    )
    returning id into v_id;
    insert into clone_map values (r.id, v_id);
  end loop;

  for r in
    select agent.* from agent
    join clone_map m on m.old = agent.stage_id
  loop
    insert into agent (stage_id, spec_id, name, role, public_position, model_tier, start_room_id)
    values (
      (select new from clone_map where old = r.stage_id),
      r.spec_id, r.name, r.role, r.public_position, r.model_tier,
      (select new from clone_map where old = r.start_room_id)
    )
    returning id into v_id;
    insert into clone_map values (r.id, v_id);

    insert into agent_private_context (agent_id, private_context, knowledge_horizon)
    select v_id, private_context, knowledge_horizon
    from agent_private_context where agent_id = r.id;
  end loop;

  for r in
    select evidence.* from evidence
    join clone_map m on m.old = evidence.stage_id
  loop
    insert into evidence (stage_id, spec_id, room_id, text, source_span)
    values (
      (select new from clone_map where old = r.stage_id),
      r.spec_id,
      (select new from clone_map where old = r.room_id),
      r.text, r.source_span
    );
  end loop;

  for r in
    select objective.* from objective
    join clone_map m on m.old = objective.stage_id
  loop
    insert into objective (stage_id, spec_id, title, requires, target_id)
    values (
      (select new from clone_map where old = r.stage_id),
      r.spec_id,
      r.title,
      coalesce(
        (
          select array_agg(coalesce(m.new, u) order by ord)
          from unnest(r.requires) with ordinality as t(u, ord)
          left join clone_map m on m.old = t.u
        ),
        '{}'::uuid[]
      ),
      coalesce((select new from clone_map where old = r.target_id), r.target_id)
    );
  end loop;

  for r in
    select decision_option.* from decision_option
    join clone_map m on m.old = decision_option.stage_id
  loop
    insert into decision_option (stage_id, spec_id, label, preconditions, branch_target)
    values (
      (select new from clone_map where old = r.stage_id),
      r.spec_id,
      r.label, r.preconditions,
      (select new from clone_map where old = r.branch_target)
    );
  end loop;

  for r in
    select map_artifact.* from map_artifact
    join clone_map m on m.old = map_artifact.stage_id
  loop
    insert into map_artifact (stage_id, seed, generator_version, json)
    values (
      (select new from clone_map where old = r.stage_id),
      r.seed, r.generator_version, r.json
    );
  end loop;

  -- branch_map is free-form jsonb holding stage ids; rewrite the copies' ids
  -- textually so a branch in the draft points inside the draft.
  for r in select old, new from clone_map loop
    update stage
    set branch_map = replace(branch_map::text, r.old::text, r.new::text)::jsonb
    where spec_version_id = v_new_spec
      and branch_map::text like '%' || r.old::text || '%';
  end loop;

  update adventure set status = 'draft' where id = p_adventure_id and published_version is null;

  return v_version;
end;
$$;
