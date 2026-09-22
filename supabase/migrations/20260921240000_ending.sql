-- P8: ending and debrief (FR-19).
--
-- An ending is not a stage — it lives in the pinned spec json, not in a table —
-- so all an attempt needs is which one it reached. The Resolver decides that;
-- this only records it, which is why the write is service_role only and the
-- column is the ending's spec id rather than a foreign key.

alter table attempt add column ending_id text;

create or replace function complete_attempt(p_attempt_id uuid, p_ending_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update attempt
  set status = 'completed',
      ending_id = p_ending_id,
      -- a finished attempt has no open stage, so it has no deadline either
      stage_deadline_at = null,
      current_stage_id = null,
      updated_at = now()
  where id = p_attempt_id;

  if not found then
    raise exception 'no such attempt' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function complete_attempt(uuid, text) from public, anon, authenticated;
grant execute on function complete_attempt(uuid, text) to service_role;
