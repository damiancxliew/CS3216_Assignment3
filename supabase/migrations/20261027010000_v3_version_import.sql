-- Keep source material alongside immutable specs when replacing an adventure.
create table adventure_version_context_v3 (
  adventure_id uuid not null,
  version integer not null,
  sources jsonb not null default '[]'::jsonb,
  check_errors jsonb,
  primary key (adventure_id, version),
  foreign key (adventure_id, version) references adventure_versions_v3(adventure_id, version)
    on delete cascade deferrable initially deferred
);
alter table adventure_version_context_v3 enable row level security;
revoke all on adventure_version_context_v3 from anon, authenticated;
grant all on adventure_version_context_v3 to service_role;

create function capture_version_sources_v3(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', source_key, 'title', title, 'kind', kind, 'pages', pages,
    'origin', case when origin = 'outside' then 'outside' else 'teacher' end
  ) || case when url is null then '{}'::jsonb else jsonb_build_object('url', url) end
  order by source_key), '[]'::jsonb)
  from sources_v3 where adventure_id = p_id and not excluded;
$$;

create function snapshot_version_context_v3() returns trigger
language plpgsql set search_path = public as $$
declare source_snapshot jsonb; checks jsonb;
begin
  if new.spec_version is not distinct from old.spec_version then return new; end if;
  source_snapshot := capture_version_sources_v3(new.id);
  if old.spec is not null then
    insert into adventure_version_context_v3(adventure_id, version, sources)
      values(new.id, old.spec_version, source_snapshot) on conflict do nothing;
  end if;
  select check_errors into checks from adventure_version_context_v3
    where adventure_id = new.id and version = old.spec_version;
  insert into adventure_version_context_v3(adventure_id, version, sources, check_errors)
    values(new.id, new.spec_version, source_snapshot, checks) on conflict do nothing;
  return new;
end;
$$;
-- Runs after the existing immutable-spec snapshot trigger.
create trigger zz_adventures_v3_snapshot_context after update on adventures_v3
  for each row execute function snapshot_version_context_v3();

create function import_adventure_version_v3(p_id uuid, p_expected_version integer, p_expected_published integer, p_spec jsonb, p_sources jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare a adventures_v3; source jsonb;
begin
  select * into a from adventures_v3 where id = p_id for update;
  if not found or a.spec_version <> p_expected_version
    or a.published_version is distinct from p_expected_published
    or a.status not in ('draft', 'published', 'archived') then return jsonb_build_object('saved', false); end if;
  if p_spec is not distinct from a.spec then return jsonb_build_object('saved', false); end if;
  insert into adventure_version_context_v3(adventure_id, version, sources)
    values(a.id, a.spec_version, capture_version_sources_v3(a.id)) on conflict do nothing;
  -- Deferred FK permits reserving the next context before the spec trigger runs.
  insert into adventure_version_context_v3(adventure_id, version, sources, check_errors)
    values(a.id, a.spec_version + 1, p_sources, '[]'::jsonb);
  delete from sources_v3 where adventure_id = a.id;
  for source in select * from jsonb_array_elements(p_sources) loop
    insert into sources_v3(adventure_id, source_key, origin, kind, title, storage_key, url, content_hash, pages)
      values(a.id, source->>'id', case when source->>'origin' = 'outside' then 'outside' else 'upload' end,
        (source->>'kind')::source_kind, source->>'title', 'inline:version-import/' || a.id::text,
        source->>'url', encode(sha256(convert_to((source->'pages')::text, 'UTF8')), 'hex'), source->'pages');
  end loop;
  update adventures_v3 set spec = p_spec, title = p_spec->>'title' where id = a.id returning * into a;
  return jsonb_build_object('saved', true, 'version', a.spec_version);
end;
$$;

create function publish_selected_version_v3(p_id uuid, p_expected_version integer, p_expected_published integer, p_selected_version integer)
returns boolean language plpgsql set search_path = public as $$
declare a adventures_v3;
begin
  select * into a from adventures_v3 where id = p_id for update;
  if not found or a.spec_version <> p_expected_version
    or a.published_version is distinct from p_expected_published
    or a.status not in ('draft', 'published', 'archived')
    or not exists(select 1 from adventure_versions_v3 where adventure_id = a.id and version = p_selected_version)
    then return false; end if;
  update adventures_v3 set status = 'published', published_version = p_selected_version where id = a.id;
  return true;
end;
$$;
revoke all on function capture_version_sources_v3(uuid) from public, anon, authenticated;
revoke all on function snapshot_version_context_v3() from public, anon, authenticated;
revoke all on function import_adventure_version_v3(uuid, integer, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function publish_selected_version_v3(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function capture_version_sources_v3(uuid) to service_role;
grant execute on function import_adventure_version_v3(uuid, integer, integer, jsonb, jsonb) to service_role;
grant execute on function publish_selected_version_v3(uuid, integer, integer, integer) to service_role;
