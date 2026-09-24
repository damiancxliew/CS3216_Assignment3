-- A newly published version waits for its artwork and walking sprites before
-- new student attempts may start. Existing published adventures stay open.
alter table adventure add column assets_ready boolean not null default true;

-- Keep legacy direct publishes playable. The teacher workflow calls this
-- wrapper so publishing and closing new attempts happen in one transaction.
create function publish_adventure_with_assets(p_adventure_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_version integer;
begin
  v_version := publish_adventure(p_adventure_id);
  update adventure set assets_ready = false where id = p_adventure_id;
  return v_version;
end;
$$;

revoke all on function publish_adventure_with_assets(uuid) from public;
grant execute on function publish_adventure_with_assets(uuid) to authenticated;

alter table asset drop constraint if exists asset_kind_check;
alter table asset add constraint asset_kind_check check (kind in ('portrait', 'landmark', 'prop', 'sprite'));

create function require_ready_assets_for_attempt()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from adventure a
    where a.id = new.adventure_id
      and a.published_version = new.published_version
      and not a.assets_ready
  ) then
    raise exception 'this adventure is preparing its artwork' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger attempt_require_ready_assets
  before insert on attempt
  for each row execute function require_ready_assets_for_attempt();

create function share_link_ready(p_token uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select a.assets_ready from adventure a
    where a.share_token = p_token and a.status = 'published' and a.published_version is not null
  ), false);
$$;

revoke all on function share_link_ready(uuid) from public;
grant execute on function share_link_ready(uuid) to anon, authenticated;
