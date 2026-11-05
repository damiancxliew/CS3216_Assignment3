-- Remove an upload and its brief metadata in the same transaction.
-- No persisted fields or validators change. Calls remain service-role only.
create function remove_brief_source_v3(p_adventure_id uuid, p_owner_id uuid, p_source_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
begin
  select brief_state into v_state from adventures_v3
    where id = p_adventure_id and owner_id = p_owner_id and status = 'briefing'
    for update;
  if not found or v_state is null or (v_state->'draft') ? 'sources' then
    raise exception 'Not collecting sources';
  end if;

  delete from sources_v3
    where adventure_id = p_adventure_id and source_key = p_source_key and origin = 'upload';
  v_state := jsonb_set(v_state, '{sources}', coalesce((
    select jsonb_agg(source) from jsonb_array_elements(v_state->'sources') source
      where source->>'id' <> p_source_key
  ), '[]'::jsonb));
  update adventures_v3 set brief_state = v_state where id = p_adventure_id;
  return v_state;
end $$;
revoke all on function remove_brief_source_v3(uuid,uuid,text) from public,anon,authenticated;
grant execute on function remove_brief_source_v3(uuid,uuid,text) to service_role;
