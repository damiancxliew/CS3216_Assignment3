-- ---------------------------------------------------------------------------
-- Generated assets (PRD D4 / D5 / D6)
-- ---------------------------------------------------------------------------
-- The one place AI-generated art is allowed: portraits, landmarks and props
-- for a published version, at most 8 per adventure, cached by prompt hash so
-- a re-publish with the same subject costs nothing. Terrain and UI art are
-- curated and never appear here. Publish does not wait on any of this: every
-- row starts `pending` with a placeholder url, and the play view swaps the
-- generated image in when a row reaches `ready` (or `cached`).

create table asset (
  id uuid primary key default gen_random_uuid(),
  spec_version_id uuid not null references spec_version (id) on delete cascade,
  -- the spec's assetEligibility entry and the entity it depicts (slugs)
  asset_id text not null,
  entity_id text not null,
  kind text not null check (kind in ('portrait', 'landmark', 'prop')),
  status text not null check (status in ('pending', 'ready', 'cached', 'failed', 'filtered', 'skipped-cap')),
  url text not null,
  placeholder_url text not null,
  prompt_hash text not null,
  model text,
  cost_usd numeric(10, 5) not null default 0,
  error text,
  updated_at timestamptz not null default now(),
  unique (spec_version_id, asset_id)
);

create index asset_version_idx on asset (spec_version_id);

-- Prompt-hash cache: the same subject described the same way is one image, ever.
create table asset_cache (
  prompt_hash text primary key,
  url text not null,
  model text not null,
  created_at timestamptz not null default now()
);

alter table asset enable row level security;
alter table asset_cache enable row level security;

-- Whoever may read the version may see what its entities look like: the
-- teacher, and a student with an attempt pinned to it. Writes are server-only.
create policy asset_select on asset
  for select to authenticated
  using (can_read_spec_version(spec_version_id));

-- The cache is an implementation detail of the generator.
revoke all on asset_cache from anon, authenticated;

-- Where the image bytes live. Public read: the urls are handed to the client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', true, 10485760, array['image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;
