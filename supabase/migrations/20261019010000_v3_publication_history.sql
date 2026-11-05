-- Keep publication history separate from immutable authoring snapshots.
create table adventure_publications_v3 (
  adventure_id uuid not null,
  version integer not null,
  link_key uuid not null default gen_random_uuid() unique,
  first_published_at timestamptz,
  last_published_at timestamptz,
  primary key (adventure_id, version),
  foreign key (adventure_id, version) references adventure_versions_v3(adventure_id, version) on delete cascade
);
alter table adventure_publications_v3 enable row level security;
revoke all on adventure_publications_v3 from anon, authenticated;
grant select on adventure_publications_v3 to authenticated;
grant all on adventure_publications_v3 to service_role;
create policy adventure_publications_v3_staff_select on adventure_publications_v3
  for select to authenticated using (can_staff_adventure_v3(adventure_id));
-- Earlier publication timestamps cannot be recovered reliably. Preserve that
-- uncertainty instead of presenting snapshot creation as publication time.
insert into adventure_publications_v3(adventure_id, version)
select id, published_version from adventures_v3 where published_version is not null
union select adventure_id, spec_version from attempts_v3
on conflict do nothing;

create function record_adventure_publication_v3() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and new.published_version is not null
    and (tg_op = 'INSERT' or old.published_version is distinct from new.published_version or old.status <> 'published') then
    insert into adventure_publications_v3(adventure_id, version, first_published_at, last_published_at)
      values(new.id, new.published_version, now(), now())
      on conflict(adventure_id, version) do update set last_published_at = excluded.last_published_at;
  end if;
  return new;
end;
$$;
revoke all on function record_adventure_publication_v3() from public, anon, authenticated;
create trigger adventures_v3_publication_history after insert or update on adventures_v3
  for each row execute function record_adventure_publication_v3();

-- Release links are issued once by publication and cannot be minted by clients.
-- A supplied release must match its immutable snapshot. Unpublish closes starts.
drop function start_attempt_v3(uuid, integer, uuid, jsonb);
create function start_attempt_v3(p_adventure_id uuid, p_spec_version integer, p_student_id uuid, p_state jsonb, p_release uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare a adventures_v3; attempt attempts_v3;
begin
  select * into a from adventures_v3 where id = p_adventure_id for update;
  if not found or a.status <> 'published' then return null; end if;
  if p_release is null then
    if a.published_version is distinct from p_spec_version then return null; end if;
  elsif not exists(select 1 from adventure_publications_v3 where adventure_id = a.id and version = p_spec_version and link_key = p_release) then return null;
  end if;
  insert into attempts_v3(adventure_id, spec_version, student_id, state)
    values(p_adventure_id, p_spec_version, p_student_id, p_state) returning * into attempt;
  return jsonb_build_object('id', attempt.id, 'revision', attempt.revision);
end;
$$;
revoke all on function start_attempt_v3(uuid, integer, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function start_attempt_v3(uuid, integer, uuid, jsonb, uuid) to service_role;
