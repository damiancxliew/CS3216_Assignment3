-- Core schema for AI-Generated Historical Adventures (PRD §6).
-- Everything the product stores is defined here so a fresh database can be
-- rebuilt from migrations alone (`npm run db:reset`).

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type adventure_status as enum ('draft', 'published', 'archived');
create type source_kind as enum ('pdf', 'text');
create type door_state as enum ('open', 'closed');
create type model_tier as enum ('frontier', 'mid', 'cheap');
create type ambient_overlay as enum ('clear', 'clouds', 'rain', 'fog', 'night', 'dust', 'snow');
create type attempt_status as enum ('active', 'spectating', 'completed', 'abandoned');
create type message_author_type as enum ('player', 'agent', 'system');
create type message_visibility as enum ('room', 'private');

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------

create table profile (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- authoring
-- ---------------------------------------------------------------------------

create table adventure (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  setting text,
  status adventure_status not null default 'draft',
  published_version integer,
  content_hash text,
  -- adventure-wide timer default in seconds; 0 disables timers for every stage
  -- that does not override it (D12/FR-16)
  default_timer_seconds integer not null default 600 check (default_timer_seconds >= 0),
  share_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index adventure_owner_idx on adventure (owner_id);

create table source (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventure (id) on delete cascade,
  kind source_kind not null,
  title text,
  storage_key text not null,
  page_map jsonb not null default '{}'::jsonb,
  content_hash text,
  created_at timestamptz not null default now()
);

create index source_adventure_idx on source (adventure_id);

create table source_chunk (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source (id) on delete cascade,
  chunk_index integer not null,
  body text not null,
  page_from integer,
  page_to integer,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create table spec_version (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventure (id) on delete cascade,
  version integer not null,
  json jsonb not null,
  generator_version text not null,
  created_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (adventure_id, version)
);

create index spec_version_adventure_idx on spec_version (adventure_id);

create table stage (
  id uuid primary key default gen_random_uuid(),
  spec_version_id uuid not null references spec_version (id) on delete cascade,
  index integer not null check (index between 0 and 2),
  title text not null,
  shared_context text not null default '',
  -- null inherits adventure.default_timer_seconds, 0 disables the timer (D12/FR-16)
  timer_seconds integer check (timer_seconds is null or timer_seconds >= 0),
  branch_map jsonb not null default '{}'::jsonb,
  ambient_overlay ambient_overlay not null default 'clear',
  overlay_intensity smallint not null default 1 check (overlay_intensity between 0 and 3),
  created_at timestamptz not null default now(),
  unique (spec_version_id, index)
);

create table room (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stage (id) on delete cascade,
  name text not null,
  purpose text,
  door_default door_state not null default 'open'
);

create index room_stage_idx on room (stage_id);

create table agent (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stage (id) on delete cascade,
  name text not null,
  role text,
  public_position text,
  model_tier model_tier not null default 'mid',
  start_room_id uuid references room (id) on delete set null
);

create index agent_stage_idx on agent (stage_id);

-- Private persona/motivation/knowledge horizon (D8). Split into its own table so
-- that it is impossible for a client-side query to project it: this table has RLS
-- enabled and no policies, so only the service role can read it (FR-21).
create table agent_private_context (
  agent_id uuid primary key references agent (id) on delete cascade,
  private_context text not null,
  knowledge_horizon text
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stage (id) on delete cascade,
  room_id uuid references room (id) on delete set null,
  text text not null,
  source_span jsonb
);

create index evidence_stage_idx on evidence (stage_id);

create table objective (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stage (id) on delete cascade,
  title text not null,
  requires uuid[] not null default '{}',
  target_id uuid
);

create index objective_stage_idx on objective (stage_id);

create table decision_option (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references stage (id) on delete cascade,
  label text not null,
  preconditions jsonb not null default '[]'::jsonb,
  branch_target uuid references stage (id) on delete set null
);

create index decision_option_stage_idx on decision_option (stage_id);

create table map_artifact (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null unique references stage (id) on delete cascade,
  seed bigint not null,
  generator_version text not null,
  json jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- play
-- ---------------------------------------------------------------------------

create table attempt (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventure (id) on delete cascade,
  published_version integer not null,
  student_id uuid not null references auth.users (id) on delete cascade,
  current_stage_id uuid references stage (id) on delete set null,
  status attempt_status not null default 'active',
  -- server-held deadline; the client only renders a countdown from it (D12/FR-16)
  stage_deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attempt_student_idx on attempt (student_id);
create index attempt_adventure_idx on attempt (adventure_id);

create table attempt_state (
  attempt_id uuid primary key references attempt (id) on delete cascade,
  world_state jsonb not null default '{}'::jsonb,
  journal jsonb not null default '[]'::jsonb,
  player_pos jsonb,
  updated_at timestamptz not null default now()
);

-- Per-agent transcript and private notes. Service-role only (FR-21).
create table agent_memory (
  attempt_id uuid not null references attempt (id) on delete cascade,
  agent_id uuid not null references agent (id) on delete cascade,
  transcript jsonb not null default '[]'::jsonb,
  private_notes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, agent_id)
);

create table message (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempt (id) on delete cascade,
  room_id uuid references room (id) on delete set null,
  author_type message_author_type not null,
  author_id uuid,
  body text not null,
  visibility message_visibility not null default 'room',
  created_at timestamptz not null default now()
);

create index message_attempt_idx on message (attempt_id, created_at);

-- Resolver output. `rolls` and the resolver rationale inside `outcome` never
-- reach a client, so this table is service-role only (FR-21); the API serves a
-- public projection instead.
create table resolution (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempt (id) on delete cascade,
  stage_id uuid not null references stage (id) on delete cascade,
  actions jsonb not null default '{}'::jsonb,
  outcome jsonb not null,
  rolls jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index resolution_attempt_idx on resolution (attempt_id, created_at);

-- ---------------------------------------------------------------------------
-- timers (D12/FR-16)
-- ---------------------------------------------------------------------------

-- null stage timer inherits the adventure default; 0 disables the timer.
create or replace function effective_timer_seconds(p_stage_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.timer_seconds, a.default_timer_seconds)
  from stage s
  join spec_version sv on sv.id = s.spec_version_id
  join adventure a on a.id = sv.adventure_id
  where s.id = p_stage_id;
$$;

-- ---------------------------------------------------------------------------
-- housekeeping
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger adventure_set_updated_at
  before update on adventure
  for each row execute function set_updated_at();

create trigger attempt_set_updated_at
  before update on attempt
  for each row execute function set_updated_at();

create trigger attempt_state_set_updated_at
  before update on attempt_state
  for each row execute function set_updated_at();

create trigger agent_memory_set_updated_at
  before update on agent_memory
  for each row execute function set_updated_at();

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
