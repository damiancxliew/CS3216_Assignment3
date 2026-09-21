-- P7: resume (FR-18).
--
-- Resuming needs no new state — the attempt, its journal, transcript and
-- commitments are already server-side — but it does need the server's clock,
-- because the countdown a resumed tab renders must be measured against the
-- same clock that will decide the deadline (D12/FR-16).

create or replace function server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

revoke all on function server_now() from public, anon;
grant execute on function server_now() to authenticated, service_role;
