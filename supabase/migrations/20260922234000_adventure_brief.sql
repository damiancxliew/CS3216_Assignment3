-- ---------------------------------------------------------------------------
-- The teacher's brief lives on the adventure (PRD §6, FR-1a)
-- ---------------------------------------------------------------------------
-- An adventure cannot be created without a reading level: the planner writes
-- to it and the validator checks against it, so it belongs on the row, not
-- only on the generate form. Role and objectives ride along so every
-- generation of the same adventure starts from the same brief.

alter table adventure
  add column reading_level jsonb,
  add column student_role text,
  add column learning_objectives text[] not null default '{}';

alter table adventure
  add constraint adventure_reading_level_shape
  check (
    reading_level is null
    or (
      jsonb_typeof(reading_level) = 'object'
      and reading_level ? 'band'
      and reading_level ? 'ageMin'
      and reading_level ? 'ageMax'
    )
  );

comment on column adventure.reading_level is 'ReadingLevel from Spec v2: { band, ageMin, ageMax }. Required for adventures created after this migration; older rows may be null until edited.';
