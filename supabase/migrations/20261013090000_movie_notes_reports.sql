-- Phase 3: private plaintext notes, lazy disclosure, reports and operator audit.
begin;
grant create on schema private,public to triggerboxd_writer,triggerboxd_reader;
create table private.movie_notes (
 id uuid primary key,
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 movie_id uuid not null references public.movies(id) on delete restrict,
 category_slug text not null references public.warning_categories(slug),
 comment text check(comment is null or char_length(btrim(comment)) between 1 and 280),
 start_seconds integer check(start_seconds between 0 and 86400),
 end_seconds integer check(end_seconds between 0 and 86400),
 version text check(version is null or char_length(btrim(version)) between 1 and 80),
 spoiler_level smallint not null check(spoiler_level between 0 and 2),
 severity smallint check(severity between 0 and 3),
 revision bigint not null check(revision between 1 and 9007199254740991),
 visibility text not null default 'active' check(visibility in('active','hidden','deleted')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(end_seconds is null or (start_seconds is not null and end_seconds>=start_seconds)),
 check(comment is not null or start_seconds is not null)
);
create index movie_notes_movie_idx on private.movie_notes(movie_id,visibility,created_at,id);
create index movie_notes_owner_idx on private.movie_notes(user_id,movie_id);
create table private.note_reports (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid not null references public.profiles(user_id) on delete cascade,
 note_id uuid not null references private.movie_notes(id) on delete cascade,
 target_revision bigint not null check(target_revision>0),
 reason text not null check(reason in('incorrect','spoiler','abuse')),
 correction text check(correction is null or char_length(btrim(correction)) between 1 and 280),
 status text not null default 'open' check(status in('open','resolved','dismissed')),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 unique(reporter_id,note_id,target_revision)
);
create index note_reports_open_idx on private.note_reports(created_at) where status='open';
create table private.note_operator_actions (
 id uuid primary key default gen_random_uuid(),
 operator_reference text not null check(char_length(btrim(operator_reference)) between 1 and 100),
 note_id uuid references private.movie_notes(id) on delete set null,
 report_id uuid references private.note_reports(id) on delete set null,
 action text not null check(action in('hide','restore','resolve','dismiss')),
 reason text not null check(char_length(btrim(reason)) between 1 and 200),
 target_revision bigint not null,
 created_at timestamptz not null default now()
);
alter table private.movie_notes enable row level security;
alter table private.note_reports enable row level security;
alter table private.note_operator_actions enable row level security;
revoke all on private.movie_notes,private.note_reports,private.note_operator_actions from public,anon,authenticated,service_role;
grant select,insert,update on private.movie_notes,private.note_reports to triggerboxd_writer;
grant select on private.movie_notes to triggerboxd_reader;
create policy notes_writer on private.movie_notes to triggerboxd_writer using(true) with check(true);
create policy notes_reader on private.movie_notes for select to triggerboxd_reader using(true);
create policy reports_writer on private.note_reports to triggerboxd_writer using(true) with check(true);
alter table private.idempotency_keys drop constraint idempotency_keys_operation_check;
alter table private.idempotency_keys add constraint idempotency_keys_operation_check check(operation in('put','delete','import','patch','family','note_put','note_delete','note_report'));

-- One category's strongest active note OR rating governs all summaries/notes.
create function private.note_category_levels(p_movie_id uuid) returns table(category_slug text,effective smallint)
language sql stable security invoker set search_path='' as $$
 select x.category_slug,max(x.spoiler_level)::smallint from(
 select r.category_slug,r.spoiler_level from public.category_ratings r join public.contributions c on c.id=r.contribution_id
 join private.user_access a on a.user_id=c.user_id and a.status='active'
 where c.movie_id=p_movie_id and c.visibility='active'
 union all
 select n.category_slug,n.spoiler_level from private.movie_notes n join private.user_access a on a.user_id=n.user_id and a.status='active'
 where n.movie_id=p_movie_id and n.visibility='active') x group by x.category_slug
$$;
grant execute on function private.note_category_levels(uuid) to triggerboxd_reader;
revoke all on function private.note_category_levels(uuid) from public,anon,authenticated,service_role;
-- Atomic upgrade of old endpoints; wrappers already use this narrow reader.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.summary_at_level(uuid,text[],smallint)'::regprocedure);
 definition:=replace(definition,'levels as(select r.category_slug,max(r.spoiler_level) effective from public.category_ratings r join eligible e on e.id=r.contribution_id group by r.category_slug)',
 'levels as(select category_slug,effective from private.note_category_levels(p_movie_id))');
 if definition=pg_get_functiondef('private.summary_at_level(uuid,text[],smallint)'::regprocedure) then raise exception 'SUMMARY_UPGRADE_FAILED'; end if;
 execute definition;
 definition:=pg_get_functiondef('private.get_indexable_movies(integer,integer)'::regprocedure);
 definition:=replace(definition,'having max(r.spoiler_level)=2)',
 'having max(r.spoiler_level)=2 union select n.movie_id,n.category_slug from private.movie_notes n join private.user_access a on a.user_id=n.user_id and a.status=''active'' where n.visibility=''active'' and n.spoiler_level=2)');
 if definition=pg_get_functiondef('private.get_indexable_movies(integer,integer)'::regprocedure) then raise exception 'SITEMAP_UPGRADE_FAILED'; end if;
 execute definition;
end $$;

create function private.note_json(p_note private.movie_notes) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_note.id,'revision',p_note.revision,'category',p_note.category_slug,
 'comment',p_note.comment,'startSeconds',p_note.start_seconds,'endSeconds',p_note.end_seconds,
 'version',p_note.version,'spoilerLevel',p_note.spoiler_level,'severity',p_note.severity)
$$;
revoke all on function private.note_json(private.movie_notes) from public,anon,authenticated,service_role;
grant execute on function private.note_json(private.movie_notes) to triggerboxd_writer;

create function private.get_my_movie_notes(p_movie_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id(); begin
 perform private.require_actor(actor);
 if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('notes',coalesce((select jsonb_agg(private.note_json(n) order by n.created_at,n.id)
 from private.movie_notes n where n.movie_id=p_movie_id and n.user_id=actor and n.visibility='active'),'[]'::jsonb));
end $$;
alter function private.get_my_movie_notes(uuid) owner to triggerboxd_writer;
create function public.get_my_movie_notes(p_movie_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.get_my_movie_notes(p_movie_id) $$;

create function private.put_movie_note(p_movie_id uuid,p_note_id uuid,p_expected_revision bigint,p_watched boolean,
 p_category text,p_comment text,p_start_seconds integer,p_end_seconds integer,p_version text,p_spoiler_level smallint,p_idempotency_key text,p_severity smallint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id(); current_note private.movie_notes%rowtype; body jsonb; cached private.idempotency_keys%rowtype; response jsonb; rev bigint;
begin
 perform private.require_actor(actor);
 if p_movie_id is null or p_note_id is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991
 or (p_comment is not null and char_length(btrim(p_comment)) not between 1 and 280)
 or (p_comment is null and p_start_seconds is null)
 or (p_version is not null and char_length(btrim(p_version)) not between 1 and 80)
 or (p_start_seconds is not null and p_start_seconds not between 0 and 86400)
 or (p_end_seconds is not null and (p_end_seconds not between 0 and 86400 or p_start_seconds is null or p_end_seconds<p_start_seconds))
 or (p_severity is not null and p_severity not between 0 and 3)
 or p_spoiler_level is null or p_spoiler_level not between 0 and 2
 or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$'
 or not exists(select 1 from public.warning_categories where slug=p_category) then raise exception 'INVALID_REQUEST'; end if;
 if p_watched is distinct from true then raise exception 'WATCH_CONFIRMATION_REQUIRED'; end if;
 body:=jsonb_build_object('movieId',p_movie_id,'noteId',p_note_id,'expectedRevision',p_expected_revision,'watched',p_watched,
 'category',p_category,'comment',p_comment,'startSeconds',p_start_seconds,'endSeconds',p_end_seconds,'version',p_version,'spoilerLevel',p_spoiler_level,'severity',p_severity);
 delete from private.idempotency_keys where actor_id=actor and operation='note_put' and key=p_idempotency_key and expires_at<=statement_timestamp();
 select * into cached from private.idempotency_keys where actor_id=actor and operation='note_put' and key=p_idempotency_key;
 if found then if cached.body<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return cached.response; end if;
 perform 1 from public.movies where id=p_movie_id and visibility='published' for share;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into current_note from private.movie_notes where id=p_note_id for update;
 if found and (current_note.user_id<>actor or current_note.movie_id<>p_movie_id or current_note.visibility<>'active') then raise exception 'FORBIDDEN'; end if;
 if coalesce(current_note.revision,0)<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 if current_note.id is null and (select count(*) from private.movie_notes where user_id=actor and movie_id=p_movie_id and visibility='active')>=20 then raise exception 'RATE_LIMITED'; end if;
 perform private.consume_quota('contribution',actor::text,10,60);
 perform private.consume_quota('contribution',actor::text,100,86400);
 rev:=nextval('private.contribution_revision');
 if current_note.id is null then
 insert into private.movie_notes(id,user_id,movie_id,category_slug,comment,start_seconds,end_seconds,version,spoiler_level,revision,severity)
 values(p_note_id,actor,p_movie_id,p_category,p_comment,p_start_seconds,p_end_seconds,p_version,p_spoiler_level,rev,p_severity) returning * into current_note;
 else
 update private.movie_notes set category_slug=p_category,comment=p_comment,start_seconds=p_start_seconds,end_seconds=p_end_seconds,
 version=p_version,spoiler_level=p_spoiler_level,severity=p_severity,revision=rev,updated_at=statement_timestamp() where id=p_note_id returning * into current_note;
 end if;
 response:=jsonb_build_object('note',private.note_json(current_note));
 insert into private.idempotency_keys(actor_id,operation,key,body,response) values(actor,'note_put',p_idempotency_key,body,response);
 return response;
end $$;
alter function private.put_movie_note(uuid,uuid,bigint,boolean,text,text,integer,integer,text,smallint,text,smallint) owner to triggerboxd_writer;
create function public.put_movie_note(p_movie_id uuid,p_note_id uuid,p_expected_revision bigint,p_watched boolean,p_category text,p_comment text,p_start_seconds integer,p_end_seconds integer,p_version text,p_spoiler_level smallint,p_idempotency_key text,p_severity smallint default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.put_movie_note(p_movie_id,p_note_id,p_expected_revision,p_watched,p_category,p_comment,p_start_seconds,p_end_seconds,p_version,p_spoiler_level,p_idempotency_key,p_severity) $$;

create function private.delete_movie_note(p_movie_id uuid,p_note_id uuid,p_expected_revision bigint,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id(); n private.movie_notes%rowtype; body jsonb; cached private.idempotency_keys%rowtype; response jsonb:='{"deleted":true}'::jsonb;
begin
 perform private.require_actor(actor);
 if p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991 or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'INVALID_REQUEST'; end if;
 body:=jsonb_build_object('movieId',p_movie_id,'noteId',p_note_id,'expectedRevision',p_expected_revision);
 delete from private.idempotency_keys where actor_id=actor and operation='note_delete' and key=p_idempotency_key and expires_at<=statement_timestamp();
 select * into cached from private.idempotency_keys where actor_id=actor and operation='note_delete' and key=p_idempotency_key;
 if found then if cached.body<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return cached.response; end if;
 perform 1 from public.movies where id=p_movie_id and visibility='published' for share;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into n from private.movie_notes where id=p_note_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if n.user_id<>actor or n.movie_id<>p_movie_id or n.visibility<>'active' then raise exception 'FORBIDDEN'; end if;
 if n.revision<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 perform private.consume_quota('contribution',actor::text,10,60);
 perform private.consume_quota('contribution',actor::text,100,86400);
 -- Tombstone prevents a deleted UUID/revision being reused and retains moderation audit.
 update private.movie_notes set visibility='deleted',revision=nextval('private.contribution_revision'),updated_at=statement_timestamp() where id=p_note_id;
 insert into private.idempotency_keys(actor_id,operation,key,body,response) values(actor,'note_delete',p_idempotency_key,body,response);
 return response;
end $$;
alter function private.delete_movie_note(uuid,uuid,bigint,text) owner to triggerboxd_writer;
create function public.delete_movie_note(p_movie_id uuid,p_note_id uuid,p_expected_revision bigint,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.delete_movie_note(p_movie_id,p_note_id,p_expected_revision,p_idempotency_key) $$;

create function private.get_movie_notes(p_movie_id uuid,p_categories text[],p_level smallint,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare response jsonb; begin
 if p_categories is null or cardinality(p_categories)>11 or cardinality(p_categories)<>(select count(distinct c) from unnest(p_categories) c)
 or exists(select 1 from unnest(p_categories) c where not exists(select 1 from public.warning_categories w where w.slug=c))
 or p_level is null or p_level not between 0 and 2 or (p_level>0 and cardinality(p_categories)=0)
 or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'INVALID_REQUEST'; end if;
 if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND'; end if;
 with levels as(select * from private.note_category_levels(p_movie_id)), eligible as(
 select n.*,l.effective,case when l.effective=0 or (p_level>=1 and n.category_slug=any(p_categories)) then n.start_seconds else null end safe_start from private.movie_notes n join private.user_access a on a.user_id=n.user_id and a.status='active'
 join levels l on l.category_slug=n.category_slug where n.movie_id=p_movie_id and n.visibility='active'
 and (cardinality(p_categories)=0 or n.category_slug=any(p_categories))
 and (l.effective<2 or (p_level=2 and n.category_slug=any(p_categories)))
 ), page as(select * from eligible order by safe_start nulls last,created_at,id limit p_limit+1 offset p_offset), displayed as(select * from page order by safe_start nulls last,created_at,id limit p_limit)
 select jsonb_build_object('notes',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'revision',d.revision,'category',d.category_slug,
 'severity',d.severity,
 'comment',case when d.effective=0 or (p_level>=1 and d.category_slug=any(p_categories)) then d.comment else null end,
 'startSeconds',case when d.effective=0 or (p_level>=1 and d.category_slug=any(p_categories)) then d.start_seconds else null end,
 'endSeconds',case when d.effective=0 or (p_level>=1 and d.category_slug=any(p_categories)) then d.end_seconds else null end,
 'version',case when d.effective=0 or (p_level>=1 and d.category_slug=any(p_categories)) then d.version else null end) order by d.safe_start nulls last,d.created_at,d.id) from displayed d),'[]'::jsonb),
 'nextOffset',case when (select count(*) from page)>p_limit then p_offset+p_limit else null end) into response;
 return response;
end $$;
alter function private.get_movie_notes(uuid,text[],smallint,integer,integer) owner to triggerboxd_reader;
create function public.get_movie_notes(p_movie_id uuid,p_categories text[] default '{}',p_level smallint default 0,p_limit integer default 20,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.get_movie_notes(p_movie_id,p_categories,p_level,p_limit,p_offset) $$;

create function private.report_movie_note(p_movie_id uuid,p_note_id uuid,p_target_revision bigint,p_reason text,p_correction text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id(); n private.movie_notes%rowtype; body jsonb; cached private.idempotency_keys%rowtype; response jsonb:='{"reported":true}'::jsonb;
begin
 perform private.require_actor(actor);
 if p_target_revision is null or p_target_revision not between 1 and 9007199254740991 or p_reason is null or p_reason not in('incorrect','spoiler','abuse')
 or (p_correction is not null and char_length(btrim(p_correction)) not between 1 and 280)
 or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'INVALID_REQUEST'; end if;
 body:=jsonb_build_object('movieId',p_movie_id,'noteId',p_note_id,'revision',p_target_revision,'reason',p_reason,'correction',p_correction);
 delete from private.idempotency_keys where actor_id=actor and operation='note_report' and key=p_idempotency_key and expires_at<=statement_timestamp();
 select * into cached from private.idempotency_keys where actor_id=actor and operation='note_report' and key=p_idempotency_key;
 if found then if cached.body<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return cached.response; end if;
 perform 1 from public.movies where id=p_movie_id and visibility='published' for share;
 if not found then raise exception 'NOT_FOUND'; end if;
 select n0.* into n from private.movie_notes n0 join private.user_access a on a.user_id=n0.user_id and a.status='active' where n0.id=p_note_id and n0.movie_id=p_movie_id and n0.visibility='active' for share of n0;
 if not found then raise exception 'NOT_FOUND'; end if;
 if n.user_id=actor then raise exception 'FORBIDDEN'; end if;
 if n.revision<>p_target_revision then raise exception 'REVISION_CONFLICT'; end if;
 if not exists(select 1 from private.note_reports where reporter_id=actor and note_id=p_note_id and target_revision=p_target_revision) then
 perform private.consume_quota('contribution',actor::text,10,60);
 perform private.consume_quota('contribution',actor::text,100,86400);
 insert into private.note_reports(reporter_id,note_id,target_revision,reason,correction) values(actor,p_note_id,p_target_revision,p_reason,p_correction);
 end if;
 insert into private.idempotency_keys(actor_id,operation,key,body,response) values(actor,'note_report',p_idempotency_key,body,response);
 return response;
end $$;
alter function private.report_movie_note(uuid,uuid,bigint,text,text,text) owner to triggerboxd_writer;
create function public.report_movie_note(p_movie_id uuid,p_note_id uuid,p_target_revision bigint,p_reason text,p_correction text,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.report_movie_note(p_movie_id,p_note_id,p_target_revision,p_reason,p_correction,p_idempotency_key) $$;

revoke all on function private.get_my_movie_notes(uuid),public.get_my_movie_notes(uuid),
 private.put_movie_note(uuid,uuid,bigint,boolean,text,text,integer,integer,text,smallint,text,smallint),public.put_movie_note(uuid,uuid,bigint,boolean,text,text,integer,integer,text,smallint,text,smallint),
 private.delete_movie_note(uuid,uuid,bigint,text),public.delete_movie_note(uuid,uuid,bigint,text),
 private.get_movie_notes(uuid,text[],smallint,integer,integer),public.get_movie_notes(uuid,text[],smallint,integer,integer),
 private.report_movie_note(uuid,uuid,bigint,text,text,text),public.report_movie_note(uuid,uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.get_my_movie_notes(uuid),public.get_my_movie_notes(uuid),
 private.put_movie_note(uuid,uuid,bigint,boolean,text,text,integer,integer,text,smallint,text,smallint),public.put_movie_note(uuid,uuid,bigint,boolean,text,text,integer,integer,text,smallint,text,smallint),
 private.delete_movie_note(uuid,uuid,bigint,text),public.delete_movie_note(uuid,uuid,bigint,text),
 private.report_movie_note(uuid,uuid,bigint,text,text,text),public.report_movie_note(uuid,uuid,bigint,text,text,text) to authenticated;
grant execute on function private.get_movie_notes(uuid,text[],smallint,integer,integer),public.get_movie_notes(uuid,text[],smallint,integer,integer) to anon,authenticated;
revoke create on schema private,public from triggerboxd_writer,triggerboxd_reader;
commit;
