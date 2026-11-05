-- Public play is opt-in and uses anonymous Auth identities to keep attempts private.
alter table adventure add column is_public boolean not null default false;
alter table adventures_v3 add column is_public boolean not null default false;

create or replace function can_play_adventure(p_adventure_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from adventure a where a.id = p_adventure_id
      and a.is_public and a.status = 'published' and a.published_version is not null)
    or exists (select 1 from adventure a join organization_member m on m.organization_id = a.organization_id
      where a.id = p_adventure_id and m.user_id = p_user and m.status = 'active')
    or exists (select 1 from platform_admin where user_id = p_user)
  );
$$;

-- Only expose the flag through a valid published share link; never expose drafts.
create function public_share_link(p_token uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from adventure where share_token = p_token
    and is_public and status = 'published' and published_version is not null and assets_ready);
$$;
revoke all on function public_share_link(uuid) from public;
grant execute on function public_share_link(uuid) to anon, authenticated;

create function set_adventure_public(p_id uuid, p_kind text, p_public boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_public is null then raise exception 'public access must be specified' using errcode = '22023'; end if;
  if p_kind = 'v2' then
    if not exists(select 1 from adventure a where a.id = p_id and (
      (a.owner_id = auth.uid() and can_author_in(a.organization_id))
      or is_org_admin(a.organization_id) or is_sysadmin())) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    update adventure set is_public = p_public where id = p_id;
  elsif p_kind = 'v3' then
    if can_staff_adventure_v3(p_id) is not true then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    update adventures_v3 set is_public = p_public where id = p_id;
  else
    raise exception 'unknown adventure kind' using errcode = '22023';
  end if;
end;
$$;
revoke all on function set_adventure_public(uuid, text, boolean) from public, anon;
grant execute on function set_adventure_public(uuid, text, boolean) to authenticated;
