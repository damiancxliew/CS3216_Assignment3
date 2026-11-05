alter table llm_usage
  add column attempt_v3_id uuid references attempts_v3 (id) on delete set null;

create index llm_usage_attempt_v3_id_idx on llm_usage (attempt_v3_id);

create function attempt_v3_tokens(p_attempt_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0)::bigint
  from llm_usage
  where attempt_v3_id = p_attempt_id;
$$;

revoke all on function attempt_v3_tokens(uuid) from public, anon, authenticated;
grant execute on function attempt_v3_tokens(uuid) to service_role;
