-- Row level security (P2).
--
-- Model: a teacher reads and writes only their own adventures; a student reads
-- only the published content of an adventure they have an attempt on, and only
-- their own attempts. Everything the player must not see — private agent
-- context, agent memory, resolver rolls and rationale — lives in tables with
-- RLS enabled and no policy at all, so only the service role can reach them
-- (FR-21).
--
-- All gameplay writes go through server route handlers using the service role;
-- clients get SELECT only, except for the teacher's own adventure row.

-- ---------------------------------------------------------------------------
-- helpers (security definer so policies do not recurse through RLS)
-- ---------------------------------------------------------------------------

create or replace function is_adventure_owner(p_adventure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from adventure a
    where a.id = p_adventure_id and a.owner_id = auth.uid()
  );
$$;

-- True when the current user has an attempt on this adventure, i.e. they were
-- admitted to a published version of it.
create or replace function has_attempt_on_adventure(p_adventure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from attempt t
    where t.adventure_id = p_adventure_id and t.student_id = auth.uid()
  );
$$;

-- A student may read a spec version only if it is the exact published version
-- one of their attempts is pinned to: a teacher editing after publish creates a
-- new version, which stays invisible to an in-flight attempt (P4).
create or replace function can_read_spec_version(p_spec_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from spec_version sv
    where sv.id = p_spec_version_id
      and (
        is_adventure_owner(sv.adventure_id)
        or exists (
          select 1 from attempt t
          where t.adventure_id = sv.adventure_id
            and t.student_id = auth.uid()
            and t.published_version = sv.version
        )
      )
  );
$$;

create or replace function can_read_stage(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from stage s
    where s.id = p_stage_id and can_read_spec_version(s.spec_version_id)
  );
$$;

create or replace function owns_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from attempt t
    where t.id = p_attempt_id and t.student_id = auth.uid()
  );
$$;

create or replace function teaches_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from attempt t
    join adventure a on a.id = t.adventure_id
    where t.id = p_attempt_id and a.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table profile enable row level security;
alter table adventure enable row level security;
alter table source enable row level security;
alter table source_chunk enable row level security;
alter table spec_version enable row level security;
alter table stage enable row level security;
alter table room enable row level security;
alter table agent enable row level security;
alter table agent_private_context enable row level security;
alter table evidence enable row level security;
alter table objective enable row level security;
alter table decision_option enable row level security;
alter table map_artifact enable row level security;
alter table attempt enable row level security;
alter table attempt_state enable row level security;
alter table agent_memory enable row level security;
alter table message enable row level security;
alter table resolution enable row level security;

-- Deny-all tables: RLS on, no policies. Only the service role reads these.
revoke all on agent_private_context from anon, authenticated;
revoke all on agent_memory from anon, authenticated;
revoke all on resolution from anon, authenticated;

-- ---------------------------------------------------------------------------
-- profile
-- ---------------------------------------------------------------------------

create policy profile_select_self on profile
  for select to authenticated
  using (id = auth.uid());

create policy profile_update_self on profile
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- authoring: teacher owns, student reads published content of their attempt
-- ---------------------------------------------------------------------------

create policy adventure_select on adventure
  for select to authenticated
  using (owner_id = auth.uid() or (status = 'published' and has_attempt_on_adventure(id)));

create policy adventure_insert_own on adventure
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy adventure_update_own on adventure
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy adventure_delete_own on adventure
  for delete to authenticated
  using (owner_id = auth.uid());

-- Sources and their chunks are teacher-only: they are the raw material, not
-- part of the published projection a student plays.
create policy source_select_owner on source
  for select to authenticated
  using (is_adventure_owner(adventure_id));

create policy source_chunk_select_owner on source_chunk
  for select to authenticated
  using (exists (
    select 1 from source s
    where s.id = source_chunk.source_id and is_adventure_owner(s.adventure_id)
  ));

create policy spec_version_select on spec_version
  for select to authenticated
  using (can_read_spec_version(id));

create policy stage_select on stage
  for select to authenticated
  using (can_read_spec_version(spec_version_id));

create policy room_select on room
  for select to authenticated
  using (can_read_stage(stage_id));

-- Only the public half of an agent is in this table; the private context lives
-- in agent_private_context, which no client role can read.
create policy agent_select on agent
  for select to authenticated
  using (can_read_stage(stage_id));

create policy evidence_select on evidence
  for select to authenticated
  using (can_read_stage(stage_id));

create policy objective_select on objective
  for select to authenticated
  using (can_read_stage(stage_id));

-- The label is public; the preconditions and the branch target are the hidden
-- half of the decision and are withheld at the column grant (FR-21), so a
-- client cannot read future branches out of the table.
revoke all on decision_option from anon, authenticated;
grant select (id, stage_id, label) on decision_option to authenticated;

create policy decision_option_select on decision_option
  for select to authenticated
  using (can_read_stage(stage_id));

create policy map_artifact_select on map_artifact
  for select to authenticated
  using (can_read_stage(stage_id));

-- ---------------------------------------------------------------------------
-- play: a student sees only their own attempts, a teacher only attempts on
-- their own adventures
-- ---------------------------------------------------------------------------

create policy attempt_select on attempt
  for select to authenticated
  using (student_id = auth.uid() or is_adventure_owner(adventure_id));

create policy attempt_state_select on attempt_state
  for select to authenticated
  using (owns_attempt(attempt_id) or teaches_attempt(attempt_id));

-- Private messages are agent-to-agent traffic behind a closed door: never
-- readable by a client, even on your own attempt (FR-12a/FR-21).
create policy message_select on message
  for select to authenticated
  using (
    visibility = 'room'
    and (owns_attempt(attempt_id) or teaches_attempt(attempt_id))
  );
