-- Attribute actual publication operations, independently of snapshot authorship.
-- Earlier actors are unknown; never substitute the owner or latest editor.
alter table adventure_publications_v3 add column published_by uuid
  references profile(id) on delete set null;

create or replace function record_adventure_publication_v3() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and new.published_version is not null
    and (tg_op = 'INSERT' or old.published_version is distinct from new.published_version or old.status <> 'published') then
    insert into adventure_publications_v3(adventure_id, version, first_published_at, last_published_at)
      values(new.id, new.published_version, now(), now())
      on conflict(adventure_id, version) do update set
        last_published_at = excluded.last_published_at, published_by = null;
  end if;
  return new;
end;
$$;

-- Existing RPC signatures remain usable by older application versions. Their
-- actors remain unknown. The server passes its authenticated user to this RPC
-- only after staff authorization and validation of the selected snapshot.
create function publish_attributed_version_v3(
  p_id uuid, p_expected_version integer, p_expected_published integer,
  p_publish boolean, p_publisher_id uuid, p_selected_version integer default null
) returns boolean language plpgsql set search_path = public as $$
declare a adventures_v3; saved boolean; changed boolean;
begin
  select * into a from adventures_v3 where id = p_id for update;
  if not found then return false; end if;
  changed := a.status <> 'published'
    or a.published_version is distinct from coalesce(p_selected_version, a.spec_version);
  if p_selected_version is null then
    saved := publish_adventure_v3(p_id, p_expected_version, p_expected_published, p_publish);
  elsif p_publish then
    saved := publish_selected_version_v3(p_id, p_expected_version, p_expected_published, p_selected_version);
  else
    return false;
  end if;
  if saved and p_publish and changed then
    update adventure_publications_v3 set published_by = p_publisher_id
      where adventure_id = p_id and version = coalesce(p_selected_version, a.spec_version);
  end if;
  return saved;
end;
$$;
revoke all on function publish_attributed_version_v3(uuid, integer, integer, boolean, uuid, integer) from public, anon, authenticated;
grant execute on function publish_attributed_version_v3(uuid, integer, integer, boolean, uuid, integer) to service_role;
