create table llm_usage (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  purpose text not null check (purpose in ('brief', 'generation', 'play')),
  organization_id uuid references organization (id) on delete set null,
  adventure_id uuid references adventure (id) on delete set null,
  attempt_id uuid references attempt (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  call text not null,
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0)
);

create index llm_usage_occurred_idx on llm_usage (occurred_at);
create index llm_usage_organization_idx on llm_usage (organization_id, occurred_at);

alter table llm_usage enable row level security;
-- no policies: written and read by the service role only

create table model_price (
  model text primary key check (length(model) between 1 and 100),
  input_usd_per_mtok numeric(12, 6) not null check (input_usd_per_mtok >= 0),
  cached_input_usd_per_mtok numeric(12, 6) not null check (cached_input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(12, 6) not null check (output_usd_per_mtok >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table model_price enable row level security;

insert into model_price (model, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok)
values
  ('gpt-5.4', 2.5, 0.25, 15),
  ('gpt-5.4-mini', 0.75, 0.075, 4.5),
  ('gpt-5.6-sol', 4, 0.4, 20),
  ('gpt-5.6-terra', 2, 0.2, 12),
  ('gpt-5.6-luna', 0.2, 0.02, 1.2)
on conflict (model) do nothing;

create or replace function llm_call_cost(p_model text, p_input integer, p_cached integer, p_output integer)
returns numeric
language sql stable security definer set search_path = public
as $$
  select (greatest(p_input - p_cached, 0) * p.input_usd_per_mtok
          + p_cached * p.cached_input_usd_per_mtok
          + p_output * p.output_usd_per_mtok) / 1000000
  from model_price p
  where p.model in (p_model, regexp_replace(p_model, '-\d{4}-\d{2}-\d{2}$', ''))
  order by (p.model = p_model) desc
  limit 1;
$$;

revoke all on function llm_call_cost(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function llm_call_cost(text, integer, integer, integer) to service_role;

create or replace function llm_usage_fill_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.attempt_id is not null then
    select coalesce(new.adventure_id, x.adventure_id), coalesce(new.user_id, x.student_id)
      into new.adventure_id, new.user_id
    from attempt x where x.id = new.attempt_id;
  end if;
  if new.organization_id is null and new.adventure_id is not null then
    select a.organization_id into new.organization_id from adventure a where a.id = new.adventure_id;
  end if;
  return new;
end;
$$;

create trigger llm_usage_fill_context
  before insert on llm_usage
  for each row execute function llm_usage_fill_context();

revoke all on function llm_usage_fill_context() from public, anon, authenticated;

create or replace function platform_overview(p_since timestamptz)
returns table (
  schools bigint, admins bigint, teachers bigint, students bigint, removed_students bigint, sysadmins bigint,
  adventures bigint, published_adventures bigint, attempts bigint, attempts_since bigint,
  completed_since bigint, active_students_since bigint, play_seconds_since bigint,
  llm_calls_since bigint, llm_tokens_since bigint, llm_cost_since numeric, unpriced_calls_since bigint,
  image_cost_since numeric
)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from organization),
    (select count(*) from organization_member where status = 'active' and role = 'admin'),
    (select count(*) from organization_member where status = 'active' and role = 'teacher'),
    (select count(*) from organization_member where status = 'active' and role = 'student'),
    (select count(*) from organization_member where status = 'removed' and role = 'student'),
    (select count(*) from platform_admin),
    (select count(*) from adventure),
    (select count(*) from adventure where status = 'published'),
    (select count(*) from attempt),
    (select count(*) from attempt where created_at >= p_since),
    (select count(*) from attempt where status = 'completed' and updated_at >= p_since),
    (select count(distinct student_id) from attempt where updated_at >= p_since),
    (select coalesce(sum(duration_seconds), 0)::bigint from attempt_telemetry where recorded_at >= p_since),
    (select count(*) from llm_usage where occurred_at >= p_since),
    (select coalesce(sum(input_tokens + output_tokens), 0)::bigint from llm_usage where occurred_at >= p_since),
    (select coalesce(sum(llm_call_cost(model, input_tokens, cached_input_tokens, output_tokens)), 0) from llm_usage where occurred_at >= p_since),
    (select count(*) from llm_usage where occurred_at >= p_since and llm_call_cost(model, input_tokens, cached_input_tokens, output_tokens) is null),
    (select coalesce(sum(cost_usd), 0) from asset where updated_at >= p_since);
$$;

create or replace function platform_school_stats(p_since timestamptz)
returns table (
  organization_id uuid, name text, slug text, created_at timestamptz,
  admins bigint, teachers bigint, students bigint,
  adventures bigint, published bigint, attempts bigint, attempts_since bigint,
  llm_cost_since numeric, image_cost numeric
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.name, o.slug, o.created_at,
         m.admins, m.teachers, m.students,
         a.adventures, a.published, t.attempts, t.attempts_since,
         l.cost, i.cost
  from organization o
  cross join lateral (
    select count(*) filter (where role = 'admin') as admins,
           count(*) filter (where role = 'teacher') as teachers,
           count(*) filter (where role = 'student') as students
    from organization_member where organization_id = o.id and status = 'active'
  ) m
  cross join lateral (
    select count(*) as adventures, count(*) filter (where status = 'published') as published
    from adventure where organization_id = o.id
  ) a
  cross join lateral (
    select count(*) as attempts, count(*) filter (where x.created_at >= p_since) as attempts_since
    from attempt x join adventure ad on ad.id = x.adventure_id
    where ad.organization_id = o.id
  ) t
  cross join lateral (
    select coalesce(sum(llm_call_cost(u.model, u.input_tokens, u.cached_input_tokens, u.output_tokens)), 0) as cost
    from llm_usage u where u.organization_id = o.id and u.occurred_at >= p_since
  ) l
  cross join lateral (
    select coalesce(sum(s.cost_usd), 0) as cost
    from asset s
    join spec_version v on v.id = s.spec_version_id
    join adventure ad on ad.id = v.adventure_id
    where ad.organization_id = o.id
  ) i
  order by o.name;
$$;

create or replace function platform_llm_daily(p_since timestamptz)
returns table (day date, purpose text, calls bigint, tokens bigint, cost_usd numeric, unpriced_calls bigint)
language sql stable security definer set search_path = public
as $$
  select (occurred_at at time zone 'UTC')::date, purpose, count(*),
         coalesce(sum(input_tokens + output_tokens), 0)::bigint,
         coalesce(sum(llm_call_cost(model, input_tokens, cached_input_tokens, output_tokens)), 0),
         count(*) filter (where llm_call_cost(model, input_tokens, cached_input_tokens, output_tokens) is null)
  from llm_usage
  where occurred_at >= p_since
  group by 1, 2
  order by 1 desc, 2;
$$;

create or replace function platform_model_prices()
returns table (
  model text, input_usd_per_mtok numeric, cached_input_usd_per_mtok numeric,
  output_usd_per_mtok numeric, updated_at timestamptz,
  calls bigint, tokens bigint, last_used timestamptz
)
language sql stable security definer set search_path = public
as $$
  with usage_totals as (
    select u.model, count(*)::bigint as calls,
           coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint as tokens,
           max(u.occurred_at) as last_used
    from llm_usage u
    where u.model is not null
    group by u.model
  )
  select coalesce(p.model, u.model),
         p.input_usd_per_mtok, p.cached_input_usd_per_mtok, p.output_usd_per_mtok,
         p.updated_at, coalesce(u.calls, 0)::bigint, coalesce(u.tokens, 0)::bigint, u.last_used
  from model_price p
  full outer join usage_totals u on u.model = p.model
  order by (p.model is null and coalesce(u.calls, 0) > 0) desc,
           coalesce(u.calls, 0) desc,
           coalesce(p.model, u.model);
$$;

create or replace function platform_activity_daily(p_since timestamptz)
returns table (
  day date, attempts_started bigint, attempts_completed bigint,
  active_students bigint, play_seconds bigint, new_members bigint
)
language sql stable security definer set search_path = public
as $$
  with days as (
    select generate_series((p_since at time zone 'UTC')::date, (now() at time zone 'UTC')::date, interval '1 day')::date as day
  ),
  started as (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
    from attempt where created_at >= p_since group by 1
  ),
  completed as (
    select (updated_at at time zone 'UTC')::date as day, count(*) as n
    from attempt where status = 'completed' and updated_at >= p_since group by 1
  ),
  activity as (
    select (created_at at time zone 'UTC')::date as day, student_id from attempt where created_at >= p_since
    union
    select (updated_at at time zone 'UTC')::date, student_id from attempt where updated_at >= p_since
    union
    select (t.recorded_at at time zone 'UTC')::date, x.student_id
    from attempt_telemetry t join attempt x on x.id = t.attempt_id
    where t.recorded_at >= p_since
  ),
  active as (
    select day, count(distinct student_id) as n from activity group by 1
  ),
  played as (
    select (recorded_at at time zone 'UTC')::date as day, sum(duration_seconds)::bigint as n
    from attempt_telemetry where recorded_at >= p_since group by 1
  ),
  joined as (
    select (created_at at time zone 'UTC')::date as day, count(*) as n
    from organization_member where created_at >= p_since group by 1
  )
  select d.day,
         coalesce(s.n, 0), coalesce(c.n, 0), coalesce(a.n, 0), coalesce(p.n, 0), coalesce(j.n, 0)
  from days d
  left join started s on s.day = d.day
  left join completed c on c.day = d.day
  left join active a on a.day = d.day
  left join played p on p.day = d.day
  left join joined j on j.day = d.day
  order by d.day;
$$;

revoke all on function platform_overview(timestamptz) from public, anon, authenticated;
revoke all on function platform_school_stats(timestamptz) from public, anon, authenticated;
revoke all on function platform_llm_daily(timestamptz) from public, anon, authenticated;
revoke all on function platform_model_prices() from public, anon, authenticated;
revoke all on function platform_activity_daily(timestamptz) from public, anon, authenticated;
grant execute on function platform_overview(timestamptz) to service_role;
grant execute on function platform_school_stats(timestamptz) to service_role;
grant execute on function platform_llm_daily(timestamptz) to service_role;
grant execute on function platform_model_prices() to service_role;
grant execute on function platform_activity_daily(timestamptz) to service_role;
