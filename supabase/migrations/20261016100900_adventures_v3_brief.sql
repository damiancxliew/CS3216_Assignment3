-- Guided brief chat and skeleton review for v3 authoring (#223).
-- The row exists from the chat's first question (status 'briefing') so sources
-- uploaded mid-chat have somewhere to live; brief_state holds the chat until
-- generation starts, skeleton_draft holds the teacher's skeleton edits while
-- status is 'needs_review', and title labels the row before a spec exists.
-- Writes stay service-role only (after an explicit owner check in the app);
-- the existing select policy covers reads.

alter table adventures_v3 drop constraint adventures_v3_status_check;
alter table adventures_v3 add constraint adventures_v3_status_check
  check (status in ('briefing', 'generating', 'needs_review', 'draft', 'published', 'failed', 'archived'));

alter table adventures_v3
  add column brief_state jsonb,
  add column skeleton_draft jsonb,
  add column title text check (title is null or char_length(title) <= 200);

comment on column adventures_v3.brief_state is 'The guided brief chat in progress (status briefing); cleared when generation starts.';
comment on column adventures_v3.skeleton_draft is 'The teacher''s saved skeleton edits while status is needs_review; cleared on approve.';
comment on column adventures_v3.title is 'Shown in the teacher''s list before a spec exists: the agreed episode.';
