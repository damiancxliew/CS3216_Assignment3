-- Preserve historical schema integers as semantic-version aliases. Content
-- revisions and publication pins remain integers and are never rewritten.
alter table upgrade_runs_v3
 drop constraint upgrade_runs_v3_source_schema_version_check,
 drop constraint if exists upgrade_runs_v3_target_schema_version_check,
 drop constraint if exists upgrade_runs_v3_check;
alter table upgrade_runs_v3
 alter column source_schema_version type text using case source_schema_version when 1 then '1.0.0' when 2 then '2.0.0' else source_schema_version::text end,
 alter column target_schema_version type text using case target_schema_version when 1 then '1.0.0' when 2 then '2.0.0' else target_schema_version::text end;
alter table upgrade_runs_v3
 add constraint upgrade_runs_v3_source_schema_semver check(source_schema_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
 add constraint upgrade_runs_v3_target_schema_semver check(target_schema_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
 add constraint upgrade_runs_v3_schema_increasing check(string_to_array(target_schema_version,'.')::numeric[] > string_to_array(source_schema_version,'.')::numeric[]);

create or replace function start_upgrade_v3(p_run jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a adventures_v3; r upgrade_runs_v3;
begin
 select * into a from adventures_v3 where id=(p_run->>'adventure_id')::uuid for update;
 if not found or a.spec_version<>(p_run->>'source_revision')::integer or a.status not in ('draft','published','archived') then raise exception 'stale adventure';end if;
 select * into r from upgrade_runs_v3 where adventure_id=a.id and source_revision=a.spec_version and target_schema_version=p_run->>'target_schema_version' and status not in ('discarded','stale');
 if found then return jsonb_build_object('run',to_jsonb(r),'created',false);end if;
 insert into upgrade_runs_v3(id,adventure_id,school_id,requester_id,source_revision,source_schema_version,target_schema_version,status,summary,progress)
 values((p_run->>'id')::uuid,a.id,a.school_id,(p_run->>'requester_id')::uuid,a.spec_version,p_run->>'source_schema_version',p_run->>'target_schema_version','running',p_run->'summary',p_run->'progress') returning * into r;
 return jsonb_build_object('run',to_jsonb(r),'created',true);
end $$;

create or replace function apply_upgrade_v3(p_run_id uuid,p_proposal_revision integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare r upgrade_runs_v3; a adventures_v3; candidate_version text;
begin
 select a0.* into a from adventures_v3 a0 join upgrade_runs_v3 r0 on r0.adventure_id=a0.id where r0.id=p_run_id for update of a0;
 if not found then return null;end if;
 select * into r from upgrade_runs_v3 where id=p_run_id for update;
 if r.proposal_revision<>p_proposal_revision then return null;end if;
 if r.status='applied' then return to_jsonb(r);end if;
 if r.status<>'ready' or r.candidate is null or r.findings<>'[]'::jsonb then return null;end if;
 if a.spec_version<>r.source_revision or a.status not in ('draft','published','archived') then
 update upgrade_runs_v3 set status='stale',error='The saved adventure changed. Start a new upgrade.' where id=r.id;return null;
 end if;
 candidate_version:=case r.candidate->>'schemaVersion' when '1' then '1.0.0' when '2' then '2.0.0' else r.candidate->>'schemaVersion' end;
 if candidate_version is distinct from r.target_schema_version then raise exception 'candidate version mismatch';end if;
 update adventures_v3 set spec=r.candidate where id=a.id returning * into a;
 update upgrade_runs_v3 set status='applied',applied_revision=a.spec_version where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function start_upgrade_v3(jsonb),apply_upgrade_v3(uuid,integer) from public,anon,authenticated;
grant execute on function start_upgrade_v3(jsonb),apply_upgrade_v3(uuid,integer) to service_role;
