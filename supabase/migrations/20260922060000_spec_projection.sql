-- The compiled spec is the private half of an adventure: it carries every
-- agent's private context, each decision's preconditions and its branch
-- target. Row-level access to spec_version and stage is legitimate (a student
-- needs the stage they are playing), so the private columns are withheld at
-- the column grant instead, the same way decision_option hides its branch
-- (FR-21). Server code reads them with the service role.

revoke all on spec_version from anon, authenticated;
grant select (id, adventure_id, version, generator_version, published_at, created_at)
  on spec_version to authenticated;

revoke all on stage from anon, authenticated;
grant select (id, spec_version_id, "index", title, shared_context, timer_seconds,
              ambient_overlay, overlay_intensity, created_at)
  on stage to authenticated;
