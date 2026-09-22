-- A spec version is two things that have to agree: the frozen `json` the
-- runtime reads, and the relational rows (stages, rooms, agents, evidence,
-- objectives, decision options) everything else joins against. They are
-- written row by row by the application, so a failure part-way through — a
-- connection-pool timeout, a dropped request — leaves a version whose json
-- promises rows that do not exist. Publish froze such a version once, and the
-- play route died on `option rows do not match the authored spec` for every
-- student who joined.
--
-- `spec_version_gaps()` names the difference; `publish_adventure()` refuses to
-- freeze a version that has any.

create or replace function spec_version_gaps(p_spec_version_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with authored as (
    select stage.value as stage
    from spec_version
    cross join lateral jsonb_array_elements(coalesce(spec_version.json -> 'stages', '[]'::jsonb)) as stage(value)
    where spec_version.id = p_spec_version_id
      -- A json blob whose stages are not authored objects (test fixtures, an
      -- older generator) has nothing to compare against.
      and jsonb_typeof(stage.value) = 'object'
      and stage.value ? 'id'
  ),
  expected as (
    select authored.stage ->> 'id' as stage_spec_id, kind.kind, child.value ->> 'id' as spec_id
    from authored
    cross join lateral (values ('room', 'rooms'), ('agent', 'agents'), ('evidence', 'evidence'), ('objective', 'objectives')) as kind(kind, key)
    cross join lateral jsonb_array_elements(coalesce(authored.stage -> kind.key, '[]'::jsonb)) as child(value)
    union all
    select authored.stage ->> 'id', 'option', option.value ->> 'id'
    from authored
    cross join lateral jsonb_array_elements(coalesce(authored.stage -> 'decision' -> 'options', '[]'::jsonb)) as option(value)
  ),
  present as (
    select stage.spec_id as stage_spec_id, rows.kind, rows.spec_id
    from stage
    cross join lateral (
      select 'room' as kind, room.spec_id from room where room.stage_id = stage.id
      union all
      select 'agent', agent.spec_id from agent where agent.stage_id = stage.id
      union all
      select 'evidence', evidence.spec_id from evidence where evidence.stage_id = stage.id
      union all
      select 'objective', objective.spec_id from objective where objective.stage_id = stage.id
      union all
      select 'option', decision_option.spec_id from decision_option where decision_option.stage_id = stage.id
    ) as rows
    where stage.spec_version_id = p_spec_version_id
  ),
  gaps as (
    select format('stage "%s" is missing from the database', authored.stage ->> 'id') as gap
    from authored
    where not exists (
      select 1 from stage
      where stage.spec_version_id = p_spec_version_id and stage.spec_id = authored.stage ->> 'id'
    )
    union all
    select format('%s "%s" of stage "%s" is missing from the database', expected.kind, expected.spec_id, expected.stage_spec_id)
    from expected
    where exists (
      select 1 from stage
      where stage.spec_version_id = p_spec_version_id and stage.spec_id = expected.stage_spec_id
    )
    and not exists (
      select 1 from present
      where present.stage_spec_id = expected.stage_spec_id
        and present.kind = expected.kind
        and present.spec_id = expected.spec_id
    )
  )
  select coalesce(array_agg(gap order by gap), '{}'::text[]) from gaps;
$$;

create or replace function publish_adventure(p_adventure_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_spec_version uuid;
  v_gaps text[];
begin
  if not is_adventure_owner(p_adventure_id) then
    raise exception 'not your adventure' using errcode = '42501';
  end if;

  select version, id into v_version, v_spec_version
  from spec_version
  where adventure_id = p_adventure_id and published_at is null
  order by version desc
  limit 1;

  if v_version is null then
    raise exception 'nothing to publish: this adventure has no draft version'
      using errcode = 'P0002';
  end if;

  -- Publishing freezes the version for good, so an incomplete draft must not
  -- get through: students would join an adventure the runtime cannot load.
  v_gaps := spec_version_gaps(v_spec_version);
  if array_length(v_gaps, 1) > 0 then
    raise exception 'draft v% is incomplete and cannot be published (% gaps, e.g. %); generate or import it again',
      v_version, array_length(v_gaps, 1), v_gaps[1]
      using errcode = '23514';
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

grant execute on function spec_version_gaps(uuid) to authenticated, service_role;
