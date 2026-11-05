create table adventure_media_v3 (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures_v3(id) on delete cascade,
  creator_id uuid not null references auth.users(id),
  target_kind text not null check (target_kind in ('stage','portrait','playerSprite','characterSprite')),
  target_key text not null,
  origin text not null check (origin in ('upload','commons','loc','un','ai')),
  state text not null default 'pending' check (state in ('pending','ready','failed')),
  snapshot jsonb,
  private_permission jsonb,
  input jsonb not null default '{}',
  spec_version integer not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  input_hash text not null,
  failure text,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(adventure_id, creator_id, idempotency_key),
  check ((state = 'ready') = (snapshot is not null))
);
create index adventure_media_v3_inventory on adventure_media_v3(adventure_id, target_kind, target_key, created_at);
alter table adventure_media_v3 enable row level security;
revoke all on adventure_media_v3 from anon, authenticated;
grant select on adventure_media_v3 to authenticated;
grant all on adventure_media_v3 to service_role;
create policy adventure_media_v3_staff on adventure_media_v3 for select to authenticated using (can_staff_adventure_v3(adventure_id));
create function immutable_ready_media_v3() returns trigger language plpgsql set search_path = public as $$
begin
  if old.state = 'ready' and new is distinct from old then raise exception 'Ready media is immutable'; end if;
  return new;
end $$;
create trigger immutable_ready_media_v3 before update on adventure_media_v3 for each row execute function immutable_ready_media_v3();
revoke all on function immutable_ready_media_v3() from public,anon,authenticated;
grant execute on function immutable_ready_media_v3() to service_role;

create function reserve_media_v3(p_adventure_id uuid, p_creator_id uuid, p_target_kind text, p_target_key text,
  p_origin text, p_version integer, p_key text, p_hash text, p_input jsonb, p_permission jsonb)
returns adventure_media_v3 language plpgsql security definer set search_path = public as $$
declare item adventure_media_v3;
begin
  insert into adventure_media_v3(adventure_id,creator_id,target_kind,target_key,origin,spec_version,idempotency_key,input_hash,input,private_permission)
    values(p_adventure_id,p_creator_id,p_target_kind,p_target_key,p_origin,p_version,p_key,p_hash,p_input,p_permission)
    on conflict(adventure_id,creator_id,idempotency_key) do nothing;
  select * into strict item from adventure_media_v3 where adventure_id=p_adventure_id and creator_id=p_creator_id and idempotency_key=p_key for update;
  if item.input_hash <> p_hash then raise exception 'Idempotency conflict'; end if;
  if item.origin='ai' and item.state='pending' and not exists(select 1 from job_steps where job_id=p_adventure_id and name='media:'||item.id::text) then
    perform enqueue_job_steps(p_adventure_id,jsonb_build_array(jsonb_build_object('name','media:'||item.id::text,'step','v3.media.generate',
      'input',jsonb_build_object('adventureId',p_adventure_id,'candidateId',item.id),'deps','[]'::jsonb,'maxAttempts',2)));
  end if;
  return item;
end $$;
revoke all on function reserve_media_v3(uuid,uuid,text,text,text,integer,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function reserve_media_v3(uuid,uuid,text,text,text,integer,text,text,jsonb,jsonb) to service_role;
create function fail_media_job_v3() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status='failed' and new.step='v3.media.generate' then
    update adventure_media_v3 set state='failed', failure='Image job did not finish. Create another candidate.', updated_at=now()
      where id=(new.input->>'candidateId')::uuid and adventure_id=new.job_id and state='pending';
  end if;
  return new;
end $$;
create trigger fail_media_job_v3 after update of status on job_steps for each row execute function fail_media_job_v3();
revoke all on function fail_media_job_v3() from public,anon,authenticated;
