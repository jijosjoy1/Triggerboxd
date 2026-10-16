begin;
-- Private job state. No subtitle text, provider credentials or URLs are accepted.
create role triggerboxd_subtitle_worker nologin noinherit nobypassrls;
grant triggerboxd_subtitle_worker to postgres;
grant usage on schema public,private to triggerboxd_subtitle_worker;
grant create on schema private to triggerboxd_subtitle_worker,triggerboxd_admin_reader;
create table private.subtitle_jobs (
 id uuid primary key default gen_random_uuid(),
 movie_id uuid not null unique references public.movies(id) on delete cascade,
 state text not null default 'queued' check(state in('queued','processing','needs_review','approved','rejected','failed')),
 revision integer not null default 1 check(revision>0),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_until timestamptz,
 available_at timestamptz not null default now(),
 result jsonb check(result is null or octet_length(result::text)<=4096),
 approved_rating integer check(approved_rating between 1 and 5),
 requested_by uuid references auth.users(id) on delete set null,
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 note text check(note is null or char_length(note) between 1 and 280),
 failure_reason text check(failure_reason in('subtitle_unavailable','quota_exhausted','provider_error','analysis_failed')),
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index subtitle_jobs_claim on private.subtitle_jobs(available_at,created_at) where state in('queued','processing');
create table private.subtitle_review_events (
 id bigint generated always as identity primary key,
 job_id uuid not null references private.subtitle_jobs(id) on delete cascade,
 actor uuid references auth.users(id) on delete set null,
 action text not null check(action in('enqueue','approve','reject','reopen')),
 revision integer not null,
 rating integer check(rating between 1 and 5),
 note text,
 created_at timestamptz not null default now()
);
alter table private.subtitle_jobs enable row level security;
alter table private.subtitle_review_events enable row level security;
revoke all on private.subtitle_jobs,private.subtitle_review_events from public,anon,authenticated,service_role;
grant select,insert,update on private.subtitle_jobs to triggerboxd_admin_reader,triggerboxd_subtitle_worker;
grant select,insert on private.subtitle_review_events to triggerboxd_admin_reader;
grant usage,select on sequence private.subtitle_review_events_id_seq to triggerboxd_admin_reader;
create policy subtitle_jobs_internal on private.subtitle_jobs to triggerboxd_admin_reader,triggerboxd_subtitle_worker using(true) with check(true);
create policy subtitle_events_internal on private.subtitle_review_events to triggerboxd_admin_reader using(true) with check(true);
grant select on public.movies to triggerboxd_subtitle_worker;
create policy subtitle_movies_worker on public.movies for select to triggerboxd_subtitle_worker using(true);

create function private.admin_subtitle_jobs(p_query text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin_owner();
 if char_length(p_query)>100 then raise exception 'INVALID_REQUEST';end if;
 return jsonb_build_object('jobs',coalesce((select jsonb_agg(x.value order by x.updated_at desc) from (
  select j.updated_at,jsonb_build_object('id',j.id,'movieId',m.id,'tmdbId',m.tmdb_id,'title',m.title,'year',extract(year from m.release_date),
   'state',j.state,'revision',j.revision,'attempts',j.attempts,'result',j.result,'approvedRating',j.approved_rating,
   'reviewer',p.display_name,'reviewedAt',j.reviewed_at,'note',j.note,'failureReason',j.failure_reason,'updatedAt',j.updated_at) value
  from private.subtitle_jobs j join public.movies m on m.id=j.movie_id left join public.profiles p on p.user_id=j.reviewed_by
  where nullif(btrim(p_query),'') is null or position(lower(btrim(p_query)) in lower(m.title))>0
  order by j.updated_at desc limit 25) x),'[]'::jsonb),
 'movies',case when nullif(btrim(p_query),'') is null then '[]'::jsonb else coalesce((select jsonb_agg(x.value) from (
  select jsonb_build_object('id',m.id,'tmdbId',m.tmdb_id,'title',m.title,'year',extract(year from m.release_date),'state',j.state) value
  from public.movies m left join private.subtitle_jobs j on j.movie_id=m.id
  where m.visibility='published' and position(lower(btrim(p_query)) in lower(m.title))>0 order by m.title limit 15) x),'[]'::jsonb) end);
end $$;
alter function private.admin_subtitle_jobs(text) owner to triggerboxd_admin_reader;
create function public.get_admin_subtitle_jobs(p_query text default null) returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_subtitle_jobs(p_query) $$;
revoke all on function private.admin_subtitle_jobs(text),public.get_admin_subtitle_jobs(text) from public,anon,authenticated,service_role;
grant execute on function private.admin_subtitle_jobs(text),public.get_admin_subtitle_jobs(text) to authenticated;

create function private.admin_subtitle_action(p_action text,p_movie_id uuid,p_id uuid,p_expected_revision integer,p_rating integer,p_watched boolean,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; job private.subtitle_jobs%rowtype; reason text:=nullif(btrim(p_note),'');begin
 actor:=private.require_admin_owner();
 if p_action is null or p_action not in('enqueue','approve','reject','reopen') or char_length(p_note)>280 or p_note ~ '[[:cntrl:]]' then raise exception 'INVALID_REQUEST';end if;
 if p_action='enqueue' then
  if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND';end if;
  perform pg_advisory_xact_lock(hashtextextended('subtitle:'||p_movie_id::text,0));
  select * into job from private.subtitle_jobs where movie_id=p_movie_id;
  if found then return private.admin_subtitle_jobs(null);end if;
  if (select count(*) from private.subtitle_jobs where requested_by=actor and created_at>now()-interval '1 hour')>=20
   or (select count(*) from private.subtitle_jobs where state in('queued','processing'))>=100 then raise exception 'RATE_LIMITED';end if;
  insert into private.subtitle_jobs(movie_id,requested_by) values(p_movie_id,actor) returning * into job;
 else
  select * into job from private.subtitle_jobs where id=p_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_expected_revision is null or job.revision<>p_expected_revision then raise exception 'REVISION_CONFLICT';end if;
  if p_action='approve' then
   if job.state<>'needs_review' then raise exception 'REVISION_CONFLICT';end if;
   if p_watched is distinct from true then raise exception 'WATCH_CONFIRMATION_REQUIRED';end if;
   if p_rating is null or p_rating not between 1 and 5 or ((job.result->>'rating')::integer is distinct from p_rating and reason is null) then raise exception 'INVALID_REQUEST';end if;
   update private.subtitle_jobs set state='approved',approved_rating=p_rating,reviewed_by=actor,reviewed_at=now(),note=reason,revision=revision+1,updated_at=now() where id=job.id returning * into job;
  elsif p_action='reject' then
   if job.state<>'needs_review' then raise exception 'REVISION_CONFLICT';end if;
   if reason is null then raise exception 'INVALID_REQUEST';end if;
   update private.subtitle_jobs set state='rejected',approved_rating=null,reviewed_by=actor,reviewed_at=now(),note=reason,revision=revision+1,updated_at=now() where id=job.id returning * into job;
  else
   if job.state not in('approved','rejected','failed') then raise exception 'REVISION_CONFLICT';end if;
   if reason is null then raise exception 'INVALID_REQUEST';end if;
   update private.subtitle_jobs set state=case when result is null then 'queued' else 'needs_review' end,approved_rating=null,attempts=0,available_at=now(),failure_reason=null,
    reviewed_by=null,reviewed_at=null,note=reason,revision=revision+1,updated_at=now() where id=job.id returning * into job;
  end if;
 end if;
 insert into private.subtitle_review_events(job_id,actor,action,revision,rating,note) values(job.id,actor,p_action,job.revision,p_rating,reason);
 return private.admin_subtitle_jobs(null);
end $$;
alter function private.admin_subtitle_action(text,uuid,uuid,integer,integer,boolean,text) owner to triggerboxd_admin_reader;
create function public.admin_subtitle_action(p_action text,p_movie_id uuid default null,p_id uuid default null,p_expected_revision integer default null,p_rating integer default null,p_watched boolean default false,p_note text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_subtitle_action(p_action,p_movie_id,p_id,p_expected_revision,p_rating,p_watched,p_note) $$;
revoke all on function private.admin_subtitle_action(text,uuid,uuid,integer,integer,boolean,text),public.admin_subtitle_action(text,uuid,uuid,integer,integer,boolean,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_subtitle_action(text,uuid,uuid,integer,integer,boolean,text),public.admin_subtitle_action(text,uuid,uuid,integer,integer,boolean,text) to authenticated;

create function private.claim_subtitle_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.subtitle_jobs%rowtype;begin
 -- One global pipeline lease, not just one lease per job. Also serializes claims.
 perform pg_advisory_xact_lock(hashtextextended('subtitle-worker',0));
 if exists(select 1 from private.subtitle_jobs where state='processing' and lease_until>now()) then return null;end if;
 update private.subtitle_jobs set state='failed',failure_reason='analysis_failed',revision=revision+1,updated_at=now(),lease_token=null,lease_until=null
 where state='processing' and lease_until<=now() and attempts>=3;
 select * into job from private.subtitle_jobs where (state='queued' and available_at<=now() or state='processing' and lease_until<=now()) and attempts<3 order by available_at,created_at for update skip locked limit 1;
 if not found then return null;end if;
 update private.subtitle_jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '30 minutes',revision=revision+1,updated_at=now() where id=job.id returning * into job;
 return (select jsonb_build_object('id',job.id,'movieId',job.movie_id,'tmdbId',m.tmdb_id,'title',m.title,'leaseToken',job.lease_token) from public.movies m where m.id=job.movie_id);
end $$;
alter function private.claim_subtitle_job() owner to triggerboxd_subtitle_worker;
create function public.claim_subtitle_job() returns jsonb language sql security invoker set search_path='' as $$ select private.claim_subtitle_job() $$;
revoke all on function private.claim_subtitle_job(),public.claim_subtitle_job() from public,anon,authenticated,service_role;
grant execute on function private.claim_subtitle_job(),public.claim_subtitle_job() to service_role;

create function private.finish_subtitle_job(p_id uuid,p_lease_token uuid,p_result jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.subtitle_jobs%rowtype; factor text; value jsonb;begin
 select * into job from private.subtitle_jobs where id=p_id for update;
 if not found or job.state<>'processing' or p_lease_token is null or job.lease_token is distinct from p_lease_token or job.lease_until<=now() then raise exception 'REVISION_CONFLICT';end if;
 if p_reason is not null then
  if p_reason not in('subtitle_unavailable','quota_exhausted','provider_error','analysis_failed') or p_result is not null then raise exception 'INVALID_REQUEST';end if;
  update private.subtitle_jobs set state=case when p_reason='quota_exhausted' or p_reason='provider_error' and attempts<3 then 'queued' else 'failed' end,
   attempts=case when p_reason='quota_exhausted' then greatest(0,attempts-1) else attempts end,
   available_at=case when p_reason='quota_exhausted' then date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day' else now()+interval '15 minutes' end,
   failure_reason=p_reason,lease_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=p_id;
 else
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>4096
   or not p_result ?& array['rating','verdict','factors','rulesVersion','scorerVersion','subtitleLanguage','subtitleHash','cueCount']
   or (p_result-array['rating','verdict','factors','rulesVersion','scorerVersion','subtitleLanguage','subtitleHash','cueCount'])<>'{}'::jsonb
   or p_result->>'subtitleLanguage'<>'EN' or coalesce(p_result->>'subtitleHash','')!~'^[a-f0-9]{64}$'
   or coalesce(p_result->>'rulesVersion','')!~'^[A-Za-z0-9._-]{1,64}$' or coalesce(p_result->>'scorerVersion','')!~'^[A-Za-z0-9._-]{1,64}$'
   or coalesce(p_result->>'cueCount','')!~'^[0-9]{1,5}$' then raise exception 'INVALID_REQUEST';end if;
  if (p_result->>'cueCount')::integer not between 1 and 10000 or (p_result->'rating'<>'null'::jsonb and (jsonb_typeof(p_result->'rating')<>'number' or p_result->>'rating'!~'^[1-5]$')) then raise exception 'INVALID_REQUEST';end if;
  if jsonb_typeof(p_result->'factors')<>'object' or not (p_result->'factors') ?& array['mildProfanityCues','strongProfanityCues','slurCues','sexualContentCues','sexualViolenceReferenceCues']
   or ((p_result->'factors')-array['mildProfanityCues','strongProfanityCues','slurCues','sexualContentCues','sexualViolenceReferenceCues'])<>'{}'::jsonb then raise exception 'INVALID_REQUEST';end if;
  for factor,value in select * from jsonb_each(p_result->'factors') loop
   if jsonb_typeof(value)<>'number' or value::text!~'^[0-9]{1,5}$' then raise exception 'INVALID_REQUEST';end if;
   if value::text::integer>(p_result->>'cueCount')::integer then raise exception 'INVALID_REQUEST';end if;
  end loop;
  update private.subtitle_jobs set state='needs_review',result=p_result,lease_token=null,lease_until=null,failure_reason=null,revision=revision+1,updated_at=now() where id=p_id;
 end if;
 return jsonb_build_object('accepted',true);
end $$;
alter function private.finish_subtitle_job(uuid,uuid,jsonb,text) owner to triggerboxd_subtitle_worker;
create function public.finish_subtitle_job(p_id uuid,p_lease_token uuid,p_result jsonb default null,p_reason text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.finish_subtitle_job(p_id,p_lease_token,p_result,p_reason) $$;
revoke all on function private.finish_subtitle_job(uuid,uuid,jsonb,text),public.finish_subtitle_job(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.finish_subtitle_job(uuid,uuid,jsonb,text),public.finish_subtitle_job(uuid,uuid,jsonb,text) to service_role;

create function private.public_subtitle_estimate(p_movie_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('rating',j.approved_rating,'subtitleLanguage',j.result->>'subtitleLanguage','rulesVersion',j.result->>'rulesVersion','scorerVersion',j.result->>'scorerVersion','reviewedAt',j.reviewed_at)
 from private.subtitle_jobs j join public.movies m on m.id=j.movie_id where j.movie_id=p_movie_id and j.state='approved' and m.visibility='published'
$$;
alter function private.public_subtitle_estimate(uuid) owner to triggerboxd_admin_reader;
create function public.get_subtitle_estimate(p_movie_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.public_subtitle_estimate(p_movie_id) $$;
revoke all on function private.public_subtitle_estimate(uuid),public.get_subtitle_estimate(uuid) from public,anon,authenticated,service_role;
grant execute on function private.public_subtitle_estimate(uuid),public.get_subtitle_estimate(uuid) to anon,authenticated;
revoke create on schema private from triggerboxd_subtitle_worker,triggerboxd_admin_reader;
commit;
