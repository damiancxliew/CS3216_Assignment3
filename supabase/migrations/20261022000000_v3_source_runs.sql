-- Additive: accepted documents survive retry and teacher deselection.
alter table sources_v3 add column excluded boolean not null default false;
create table source_search_runs_v3 (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures_v3(id) on delete cascade,
  requester_id uuid not null references auth.users(id),
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  input_hash text not null,
  state text not null default 'pending' check (state in ('pending','running','ready','failed')),
  diagnostics jsonb not null default '[]',
  results jsonb not null default '{}',
  usage jsonb not null default '{}',
  cost_usd numeric not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adventure_id, requester_id, idempotency_key)
);
create unique index source_search_runs_v3_active on source_search_runs_v3(adventure_id) where state in ('pending','running');
alter table source_search_runs_v3 enable row level security;
revoke all on source_search_runs_v3 from anon, authenticated;
grant select on source_search_runs_v3 to authenticated;
grant all on source_search_runs_v3 to service_role;
create policy source_search_runs_v3_staff on source_search_runs_v3 for select to authenticated using (can_staff_adventure_v3(adventure_id));

-- Retry and Continue serialize on the same adventure row. Only server actions call these.
create function begin_source_search_v3(p_adventure_id uuid, p_requester_id uuid, p_key text, p_hash text, p_excluded text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare run_id uuid; prior_hash text;
begin
  perform 1 from adventures_v3 where id = p_adventure_id and status = 'needs_review' for update;
  if not found then raise exception 'Not awaiting source review'; end if;
  select id, input_hash into run_id, prior_hash from source_search_runs_v3 where adventure_id = p_adventure_id and requester_id = p_requester_id and idempotency_key = p_key;
  if found then
    if prior_hash <> p_hash then raise exception 'Idempotency conflict'; end if;
    return run_id;
  end if;
  if exists (select 1 from job_steps where job_id = p_adventure_id and name = 'skeleton') then raise exception 'Already continued'; end if;
  insert into source_search_runs_v3(adventure_id, requester_id, idempotency_key, input_hash) values (p_adventure_id,p_requester_id,p_key,p_hash) returning id into run_id;
  update sources_v3 set excluded = source_key = any(p_excluded) where adventure_id = p_adventure_id and origin = 'outside';
  return run_id;
end $$;

create function continue_sources_v3(p_adventure_id uuid, p_excluded text[])
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from adventures_v3 where id = p_adventure_id and status = 'needs_review' for update;
  if not found then return false; end if;
  if exists (select 1 from source_search_runs_v3 where adventure_id = p_adventure_id and state in ('pending','running')) then return false; end if;
  update sources_v3 set excluded = source_key = any(p_excluded) where adventure_id = p_adventure_id and origin = 'outside';
  update adventures_v3 set status = 'generating' where id = p_adventure_id;
  return true;
end $$;
revoke all on function begin_source_search_v3(uuid,uuid,text,text,text[]), continue_sources_v3(uuid,text[]) from public,anon,authenticated;
grant execute on function begin_source_search_v3(uuid,uuid,text,text,text[]), continue_sources_v3(uuid,text[]) to service_role;
create function save_source_selection_v3(p_adventure_id uuid, p_excluded text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from adventures_v3 where id = p_adventure_id and status = 'needs_review' for update;
  if not found or exists (select 1 from source_search_runs_v3 where adventure_id = p_adventure_id and state in ('pending','running')) then raise exception 'Review unavailable'; end if;
  update sources_v3 set excluded = source_key = any(p_excluded) where adventure_id = p_adventure_id and origin = 'outside';
end $$;
revoke all on function save_source_selection_v3(uuid,text[]) from public,anon,authenticated;
grant execute on function save_source_selection_v3(uuid,text[]) to service_role;
