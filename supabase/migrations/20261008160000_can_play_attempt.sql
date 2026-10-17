-- Check an attempt's live school membership before the service-role Turn API loads it.
create or replace function can_play_attempt(p_attempt_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from attempt
    where id = p_attempt_id
      and student_id = p_user
      and can_play_adventure(adventure_id, p_user)
  );
$$;

revoke all on function can_play_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function can_play_attempt(uuid, uuid) to service_role;
