create table sources_v3 (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures_v3 (id) on delete cascade,
  source_key text not null,
  origin text not null check (origin in ('upload', 'outside')),
  kind source_kind not null,
  title text not null,
  storage_key text,
  url text,
  content_hash text not null,
  pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (adventure_id, source_key),
  check (
    (origin = 'upload' and storage_key is not null)
    or (origin = 'outside' and url is not null)
  )
);

comment on column sources_v3.source_key is 'Document id cited by the spec (ExtractedDocument.id / OutsideSource.id).';
comment on column sources_v3.pages is 'ExtractedPage[]: [{ page, text }], the unit of citation.';

alter table sources_v3 enable row level security;
revoke all on table sources_v3 from anon, authenticated;
grant select on table sources_v3 to authenticated;
grant all on table sources_v3 to service_role;

create policy sources_v3_staff_select on sources_v3
  for select to authenticated
  using (can_staff_adventure_v3(adventure_id));

alter table llm_usage
  add column adventure_v3_id uuid references adventures_v3 (id) on delete set null;

create index llm_usage_adventure_v3_id_idx on llm_usage (adventure_v3_id);
