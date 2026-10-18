-- Deploy before enabling direct editing. All mutations are service-only; application
-- services enforce staff/school access and validate before calling these operations.
alter table adventures_v3 add column published_version integer;
update adventures_v3 set published_version = spec_version where status = 'published';
alter table adventures_v3 add constraint adventures_v3_published_version_fk
  foreign key (id, published_version) references adventure_versions_v3(adventure_id, version)
  deferrable initially deferred;
revoke insert, update on adventures_v3 from authenticated;

create function save_adventure_v3(p_id uuid, p_expected_version integer, p_spec jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare a adventures_v3;
begin
  select * into a from adventures_v3 where id = p_id for update;
  if not found or a.spec_version <> p_expected_version or a.status not in ('draft', 'published', 'archived') then
    return jsonb_build_object('saved', false);
  end if;
  update adventures_v3 set spec = p_spec where id = p_id returning * into a;
  return jsonb_build_object('saved', true, 'version', a.spec_version);
end;
$$;

create function publish_adventure_v3(p_id uuid, p_expected_version integer, p_expected_published integer, p_publish boolean)
returns boolean language plpgsql set search_path = public as $$
declare a adventures_v3;
begin
  select * into a from adventures_v3 where id = p_id for update;
  if not found or a.spec_version <> p_expected_version
    or a.published_version is distinct from p_expected_published
    or a.status not in ('draft', 'published', 'archived') then return false; end if;
  update adventures_v3 set
    published_version = case when p_publish then a.spec_version else null end,
    status = case when p_publish then 'published' else 'draft' end
    where id = p_id;
  return true;
end;
$$;

create function start_attempt_v3(p_adventure_id uuid, p_spec_version integer, p_student_id uuid, p_state jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare a adventures_v3; attempt attempts_v3;
begin
  -- This lock serializes publication changes with insertion after state initialization.
  select * into a from adventures_v3 where id = p_adventure_id for update;
  if not found or a.status <> 'published' or a.published_version is distinct from p_spec_version then
    return null;
  end if;
  insert into attempts_v3(adventure_id, spec_version, student_id, state)
    values (p_adventure_id, p_spec_version, p_student_id, p_state) returning * into attempt;
  return jsonb_build_object('id', attempt.id, 'revision', attempt.revision);
end;
$$;

create function immutable_adventure_version_v3() returns trigger language plpgsql as $$
begin raise exception 'Adventure version snapshots are immutable'; end;
$$;
create trigger adventure_versions_v3_immutable before update on adventure_versions_v3
  for each row execute function immutable_adventure_version_v3();
revoke all on function save_adventure_v3(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function publish_adventure_v3(uuid, integer, integer, boolean) from public, anon, authenticated;
revoke all on function start_attempt_v3(uuid, integer, uuid, jsonb) from public, anon, authenticated;
grant execute on function save_adventure_v3(uuid, integer, jsonb) to service_role;
grant execute on function publish_adventure_v3(uuid, integer, integer, boolean) to service_role;
grant execute on function start_attempt_v3(uuid, integer, uuid, jsonb) to service_role;
