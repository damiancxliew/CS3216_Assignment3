-- ---------------------------------------------------------------------------
-- The brief conversation lives on the adventure while it is being agreed
-- ---------------------------------------------------------------------------
-- Sources are uploaded during the conversation (FR-1a: the reading level and
-- the rest of the brief arrive with the sources), and a source row needs an
-- adventure to hang off. So the adventure row is created when the
-- conversation starts and the conversation itself is kept here until the
-- teacher confirms the brief, at which point it is cleared. A row with a
-- non-null brief_state is an unfinished brief the teacher can resume or
-- discard; it is never listed as an adventure.

alter table adventure
  add column brief_state jsonb;

comment on column adventure.brief_state is 'BriefState of an in-progress brief conversation; null once the brief is confirmed.';
