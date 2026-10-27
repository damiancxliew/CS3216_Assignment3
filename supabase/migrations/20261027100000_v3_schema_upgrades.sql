-- Proposals are server-authored; teachers review through the application. Existing
-- publication snapshots and attempts never change when an upgrade is applied.
create table upgrade_runs_v3 (
 id uuid primary key default gen_random_uuid(),
 adventure_id uuid not null references adventures_v3(id) on delete cascade,
 school_id uuid not null references organization(id),
 requester_id uuid not null references auth.users(id),
 source_revision integer not null,
 source_schema_version integer not null check (source_schema_version>0),
 target_schema_version integer not null check (target_schema_version>source_schema_version),
 proposal_revision integer not null default 1 check (proposal_revision>0),
 status text not null check(status in ('running','blocked','ready','applied','discarded','failed','stale')),
 candidate jsonb, migration_state jsonb not null default '{}',
 findings jsonb not null default '[]', summary jsonb not null default '{}',progress jsonb not null default '{}',
 instruction text not null default '', error text, applied_revision integer,
 created_at timestamptz not null default now(),
 foreign key(adventure_id,source_revision) references adventure_versions_v3(adventure_id,version),
 foreign key(adventure_id,applied_revision) references adventure_versions_v3(adventure_id,version)
);
create index upgrade_runs_v3_adventure on upgrade_runs_v3(adventure_id,created_at desc);
create unique index upgrade_runs_v3_active on upgrade_runs_v3(adventure_id,source_revision,target_schema_version) where status not in ('discarded','stale');
alter table upgrade_runs_v3 enable row level security;
revoke all on upgrade_runs_v3 from anon,authenticated;
grant select on upgrade_runs_v3 to authenticated;
grant all on upgrade_runs_v3 to service_role;
create policy upgrade_runs_v3_staff on upgrade_runs_v3 for select to authenticated using(can_staff_adventure_v3(adventure_id));

create function start_upgrade_v3(p_run jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a adventures_v3; r upgrade_runs_v3;
begin
 select * into a from adventures_v3 where id=(p_run->>'adventure_id')::uuid for update;
 if not found or a.spec_version<>(p_run->>'source_revision')::integer or a.status not in ('draft','published','archived') then raise exception 'stale adventure';end if;
 select * into r from upgrade_runs_v3 where adventure_id=a.id and source_revision=a.spec_version and target_schema_version=(p_run->>'target_schema_version')::integer and status not in ('discarded','stale');
 if found then return jsonb_build_object('run',to_jsonb(r),'created',false);end if;
 insert into upgrade_runs_v3(id,adventure_id,school_id,requester_id,source_revision,source_schema_version,target_schema_version,status,summary,progress)
 values((p_run->>'id')::uuid,a.id,a.school_id,(p_run->>'requester_id')::uuid,a.spec_version,(p_run->>'source_schema_version')::integer,(p_run->>'target_schema_version')::integer,'running',p_run->'summary',p_run->'progress') returning * into r;
 return jsonb_build_object('run',to_jsonb(r),'created',true);
end $$;

create function apply_upgrade_v3(p_run_id uuid,p_proposal_revision integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r upgrade_runs_v3; a adventures_v3;
begin
 -- All upgrade transactions lock adventure then run, matching start/save order.
 select a0.* into a from adventures_v3 a0 join upgrade_runs_v3 r0 on r0.adventure_id=a0.id where r0.id=p_run_id for update of a0;
 if not found then return null;end if;
 select * into r from upgrade_runs_v3 where id=p_run_id for update;
 if r.proposal_revision<>p_proposal_revision then return null;end if;
 if r.status='applied' then return to_jsonb(r);end if;
 if r.status<>'ready' or r.candidate is null or r.findings<>'[]'::jsonb then return null;end if;
 if a.spec_version<>r.source_revision or a.status not in ('draft','published','archived') then
 update upgrade_runs_v3 set status='stale',error='The saved adventure changed. Start a new upgrade.' where id=r.id;return null;
 end if;
 if (r.candidate->>'schemaVersion')::integer is distinct from r.target_schema_version then raise exception 'candidate version mismatch';end if;
 update adventures_v3 set spec=r.candidate where id=a.id returning * into a;
 update upgrade_runs_v3 set status='applied',applied_revision=a.spec_version where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function start_upgrade_v3(jsonb),apply_upgrade_v3(uuid,integer) from public,anon,authenticated;
grant execute on function start_upgrade_v3(jsonb),apply_upgrade_v3(uuid,integer) to service_role;
