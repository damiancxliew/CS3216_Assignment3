-- ---------------------------------------------------------------------------
-- The teacher's stage plan lives on the adventure (PRD §6)
-- ---------------------------------------------------------------------------
-- The brief is now agreed in conversation before the adventure exists, and
-- that conversation settles what each stage is about. The planner honours
-- this outline, so it belongs on the row next to the rest of the brief.

alter table adventure
  add column stage_outline jsonb not null default '[]'::jsonb;

alter table adventure
  add constraint adventure_stage_outline_shape
  check (
    jsonb_typeof(stage_outline) = 'array'
    and jsonb_array_length(stage_outline) <= 3
  );

comment on column adventure.stage_outline is 'Teacher''s stage plan: [{ title, focus }] in stage order, at most three. Empty for adventures created before the brief conversation.';
