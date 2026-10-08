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
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  -- null when the model has no entry in the price table
  cost_usd numeric(12, 6)
);

create index llm_usage_occurred_idx on llm_usage (occurred_at);
create index llm_usage_organization_idx on llm_usage (organization_id, occurred_at);

alter table llm_usage enable row level security;
-- no policies: written and read by the service role only

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
    (select coalesce(sum(cost_usd), 0) from llm_usage where occurred_at >= p_since),
    (select count(*) from llm_usage where occurred_at >= p_since and cost_usd is null),
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
    select coalesce(sum(u.cost_usd), 0) as cost
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
         coalesce(sum(cost_usd), 0),
         count(*) filter (where cost_usd is null)
  from llm_usage
  where occurred_at >= p_since
  group by 1, 2
  order by 1 desc, 2;
$$;

revoke all on function platform_overview(timestamptz) from public, anon, authenticated;
revoke all on function platform_school_stats(timestamptz) from public, anon, authenticated;
revoke all on function platform_llm_daily(timestamptz) from public, anon, authenticated;
grant execute on function platform_overview(timestamptz) to service_role;
grant execute on function platform_school_stats(timestamptz) to service_role;
grant execute on function platform_llm_daily(timestamptz) to service_role;
