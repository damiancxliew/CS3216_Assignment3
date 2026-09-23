alter table spec_version add column compiled_stages jsonb;
alter table spec_version add column compiled_spec jsonb;

create or replace function set_version_maps(p_spec_version_id uuid, p_maps jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'map compilation writes require the service role' using errcode = '42501';
  end if;
  if jsonb_typeof(p_maps) is distinct from 'array' then
    raise exception 'compiled maps must be an array' using errcode = '22023';
  end if;
  update spec_version set compiled_stages = p_maps, compiled_spec = json
  where id = p_spec_version_id and published_at is null;
  if not found then raise exception 'version missing or already published' using errcode = '25006'; end if;
end;
$$;
revoke all on function set_version_maps(uuid, jsonb) from public, anon, authenticated;
grant execute on function set_version_maps(uuid, jsonb) to service_role;

create or replace function inherit_version_maps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.compiled_stages is null then
    select compiled_stages, compiled_spec into new.compiled_stages, new.compiled_spec
    from spec_version
    where adventure_id = new.adventure_id and version = new.version - 1
      and published_at is not null and json = new.json and compiled_spec = new.json;
  end if;
  return new;
end;
$$;
create trigger spec_version_inherit_maps before insert on spec_version
  for each row execute function inherit_version_maps();
revoke all on function inherit_version_maps() from public, anon, authenticated;

create or replace function require_version_maps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.published_at is null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.published_at is not null then return new; end if;
  end if;
  if jsonb_typeof(new.compiled_stages) is distinct from 'array' or new.compiled_spec is distinct from new.json then
    raise exception 'compile the current draft before publishing; legacy adventures require a new compatible version' using errcode = '22023';
  end if;
  if jsonb_array_length(new.compiled_stages) = 0
     or jsonb_array_length(new.compiled_stages) <> (select count(*) from stage where spec_version_id = new.id) then
    raise exception 'compiled map count does not match the version' using errcode = '22023';
  end if;
  for c in select value, ordinality from jsonb_array_elements(new.compiled_stages) with ordinality loop
    if c.value->'map'->>'schemaVersion' is distinct from '3'
       or c.value->'map'->>'generatorVersion' is distinct from 'settlement-2'
       or not exists (
         select 1 from stage s where s.spec_version_id = new.id and s.index = c.ordinality - 1
           and (s.spec_id is null or s.spec_id = c.value->'map'->>'stageId')
       ) then
      raise exception 'compiled map does not match the authored stage' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
create trigger spec_version_require_maps before insert or update of published_at on spec_version
  for each row execute function require_version_maps();
revoke all on function require_version_maps() from public, anon, authenticated;
