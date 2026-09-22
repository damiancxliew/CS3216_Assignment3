-- P4: publish + immutable versioning.
--
-- A published spec version is frozen: not by convention, and not by a check in
-- a route handler that a later feature might forget, but by triggers that
-- refuse the write. `publish_adventure()` stamps the version; after that the
-- version row and every row hanging off it — stages, rooms, agents, private
-- context, evidence, objectives, options, maps — reject INSERT, UPDATE and
-- DELETE for every role, service role included.
--
-- A teacher who wants to change a published adventure calls
-- `create_draft_version()`, which deep-copies the published version into the
-- next version number as a draft. Attempts pin `published_version` at the
-- moment they join (P3), and RLS only exposes the pinned version, so an
-- in-flight attempt keeps playing the version it started on no matter how many
-- times the teacher republishes.

-- ---------------------------------------------------------------------------
-- freeze
-- ---------------------------------------------------------------------------

create or replace function is_spec_version_frozen(p_spec_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select published_at is not null from spec_version where id = p_spec_version_id),
    false
  );
$$;

create or replace function reject_frozen_spec_version_write(p_spec_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_spec_version_frozen(p_spec_version_id) then
    raise exception 'published spec version % is immutable; create a new draft version instead', p_spec_version_id
      using errcode = '25006';  -- read_only_sql_transaction
  end if;
end;
$$;

-- spec_version itself: publishing is the one transition allowed (null ->
-- timestamp); after that the row is sealed.
create or replace function guard_frozen_spec_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.published_at is not null then
    raise exception 'published spec version % is immutable; create a new draft version instead', old.id
      using errcode = '25006';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger spec_version_freeze
  before update or delete on spec_version
  for each row execute function guard_frozen_spec_version();

create or replace function guard_frozen_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform reject_frozen_spec_version_write(old.spec_version_id);
  end if;
  if tg_op <> 'DELETE' then
    perform reject_frozen_spec_version_write(new.spec_version_id);
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger stage_freeze
  before insert or update or delete on stage
  for each row execute function guard_frozen_stage();

-- room, agent, evidence, objective, decision_option, map_artifact: everything
-- reachable from a stage.
create or replace function guard_frozen_stage_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec_version_id uuid;
begin
  if tg_op <> 'INSERT' then
    select spec_version_id into v_spec_version_id from stage where id = old.stage_id;
    perform reject_frozen_spec_version_write(v_spec_version_id);
  end if;
  if tg_op <> 'DELETE' then
    select spec_version_id into v_spec_version_id from stage where id = new.stage_id;
    perform reject_frozen_spec_version_write(v_spec_version_id);
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger room_freeze
  before insert or update or delete on room
  for each row execute function guard_frozen_stage_child();

create trigger agent_freeze
  before insert or update or delete on agent
  for each row execute function guard_frozen_stage_child();

create trigger evidence_freeze
  before insert or update or delete on evidence
  for each row execute function guard_frozen_stage_child();

create trigger objective_freeze
  before insert or update or delete on objective
  for each row execute function guard_frozen_stage_child();

create trigger decision_option_freeze
  before insert or update or delete on decision_option
  for each row execute function guard_frozen_stage_child();

create trigger map_artifact_freeze
  before insert or update or delete on map_artifact
  for each row execute function guard_frozen_stage_child();

create or replace function guard_frozen_agent_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spec_version_id uuid;
begin
  select s.spec_version_id into v_spec_version_id
  from agent a join stage s on s.id = a.stage_id
  where a.id = case tg_op when 'DELETE' then old.agent_id else new.agent_id end;

  perform reject_frozen_spec_version_write(v_spec_version_id);
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger agent_private_context_freeze
  before insert or update or delete on agent_private_context
  for each row execute function guard_frozen_agent_child();

-- ---------------------------------------------------------------------------
-- publish
-- ---------------------------------------------------------------------------

-- Publishes the adventure's newest draft version and points the adventure at
-- it. Existing attempts are untouched: they keep the version number they
-- pinned when they joined.
create or replace function publish_adventure(p_adventure_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_version integer;
begin
  if not is_adventure_owner(p_adventure_id) then
    raise exception 'not your adventure' using errcode = '42501';
  end if;

  select version into v_version
  from spec_version
  where adventure_id = p_adventure_id and published_at is null
  order by version desc
  limit 1;

  if v_version is null then
    raise exception 'nothing to publish: this adventure has no draft version'
      using errcode = 'P0002';
  end if;

  update spec_version
  set published_at = now()
  where adventure_id = p_adventure_id and version = v_version;

  update adventure
  set status = 'published', published_version = v_version
  where id = p_adventure_id;

  return v_version;
end;
$$;

-- Deep-copies the newest version of the adventure into the next version number
-- as a draft, so the teacher can edit without touching what students are
-- playing. Internal references (a stage's branch map, an agent's starting room,
-- an option's branch target) are rewritten to the copies.
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
      spec_version_id, index, title, shared_context, timer_seconds,
      branch_map, ambient_overlay, overlay_intensity
    )
    values (
      v_new_spec, r.index, r.title, r.shared_context, r.timer_seconds,
      r.branch_map, r.ambient_overlay, r.overlay_intensity
    )
    returning id into v_id;
    insert into clone_map values (r.id, v_id);
  end loop;

  for r in
    select room.* from room
    join clone_map m on m.old = room.stage_id
  loop
    insert into room (stage_id, name, purpose, door_default)
    values (
      (select new from clone_map where old = r.stage_id),
      r.name, r.purpose, r.door_default
    )
    returning id into v_id;
    insert into clone_map values (r.id, v_id);
  end loop;

  for r in
    select agent.* from agent
    join clone_map m on m.old = agent.stage_id
  loop
    insert into agent (stage_id, name, role, public_position, model_tier, start_room_id)
    values (
      (select new from clone_map where old = r.stage_id),
      r.name, r.role, r.public_position, r.model_tier,
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
    insert into evidence (stage_id, room_id, text, source_span)
    values (
      (select new from clone_map where old = r.stage_id),
      (select new from clone_map where old = r.room_id),
      r.text, r.source_span
    );
  end loop;

  for r in
    select objective.* from objective
    join clone_map m on m.old = objective.stage_id
  loop
    insert into objective (stage_id, title, requires, target_id)
    values (
      (select new from clone_map where old = r.stage_id),
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
    insert into decision_option (stage_id, label, preconditions, branch_target)
    values (
      (select new from clone_map where old = r.stage_id),
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

revoke all on function publish_adventure(uuid) from public;
revoke all on function create_draft_version(uuid) from public;
grant execute on function publish_adventure(uuid) to authenticated;
grant execute on function create_draft_version(uuid) to authenticated;
