-- Flags are private review requests, not rating edits or automatic verdicts.
begin;
grant create on schema private to triggerboxd_admin_reader;
create table private.admin_review_flags (
 review_id uuid primary key references public.contributions(id) on delete cascade,
 status text not null check(status in('open','resolved')),
 reason text not null check(reason in('spam','coordinated_activity','abusive_content','other')),
 note text check(note is null or char_length(note) between 1 and 280),
 review_revision bigint not null check(review_revision between 1 and 9007199254740991),
 flagged_by uuid references auth.users(id) on delete set null,
 resolved_by uuid references auth.users(id) on delete set null,
 flagged_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 resolved_at timestamptz
);
create index admin_review_flags_open_idx on private.admin_review_flags(flagged_at desc,review_id) where status='open';
alter table private.admin_review_flags enable row level security;
revoke all on private.admin_review_flags from public,anon,authenticated,service_role;
grant select,insert,update on private.admin_review_flags to triggerboxd_admin_reader;
create policy flags_internal on private.admin_review_flags to triggerboxd_admin_reader using(true) with check(true);

create function private.require_admin_owner() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.admin_actor(); status text;begin
 status:=private.admin_actor_status(actor);
 if status<>'ACTIVE' then raise exception '%',status;end if;
 if not exists(select 1 from private.admin_owners where user_id=actor) then raise exception 'FORBIDDEN';end if;
 return actor;
end $$;
alter function private.require_admin_owner() owner to triggerboxd_admin_reader;
revoke all on function private.require_admin_owner() from public,anon,authenticated,service_role;

create function private.admin_review(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 perform private.require_admin_owner();
 select jsonb_build_object('id',c.id,'movieId',m.id,'filmTitle',m.title,'nickname',p.display_name,
 'revision',c.revision,'submittedAt',c.created_at,'updatedAt',c.updated_at,'watched',c.watched,'visibility',c.visibility,
 'categories',coalesce((select jsonb_agg(jsonb_build_object('category',r.category_slug,'severity',r.severity,'spoilerLevel',r.spoiler_level) order by w.sort_order,r.category_slug)
 from public.category_ratings r join public.warning_categories w on w.slug=r.category_slug where r.contribution_id=c.id),'[]'::jsonb),
 'flag',(select jsonb_build_object('status',f.status,'reason',f.reason,'note',f.note,'flaggedAt',f.flagged_at,'updatedAt',f.updated_at,'reviewRevision',f.review_revision) from private.admin_review_flags f where f.review_id=c.id))
 into result from public.contributions c join public.movies m on m.id=c.movie_id join public.profiles p on p.user_id=c.user_id where c.id=p_id;
 if result is null then raise exception 'NOT_FOUND';end if;
 return result;
end $$;
alter function private.admin_review(uuid) owner to triggerboxd_admin_reader;
create function public.get_admin_review(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_review(p_id) $$;
revoke all on function private.admin_review(uuid),public.get_admin_review(uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_review(uuid),public.get_admin_review(uuid) to authenticated;

create function private.set_admin_review_flag(p_id uuid,p_expected_revision bigint,p_action text,p_reason text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; revision bigint;begin
 actor:=private.require_admin_owner();
 if p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991 or p_action is null or p_action not in('flag','resolve') then raise exception 'INVALID_REQUEST';end if;
 if p_action='flag' and (p_reason is null or p_reason not in('spam','coordinated_activity','abusive_content','other') or char_length(p_note)>280 or p_note ~ '[[:cntrl:]]') then raise exception 'INVALID_REQUEST';end if;
 if p_action='resolve' and (p_reason is not null or p_note is not null) then raise exception 'INVALID_REQUEST';end if;
 -- Serialize owner moderation without granting write access to ratings.
 perform pg_advisory_xact_lock(hashtextextended('review-flag:'||p_id::text,0));
 select c.revision into revision from public.contributions c where c.id=p_id;
 if revision is null then raise exception 'NOT_FOUND';end if;
 if revision<>p_expected_revision then raise exception 'REVISION_CONFLICT';end if;
 if p_action='flag' then
  insert into private.admin_review_flags(review_id,status,reason,note,review_revision,flagged_by)
  values(p_id,'open',p_reason,nullif(btrim(p_note),''),revision,actor)
  on conflict(review_id) do update set status='open',reason=excluded.reason,note=excluded.note,
   review_revision=excluded.review_revision,flagged_by=actor,flagged_at=now(),updated_at=now(),resolved_by=null,resolved_at=null;
 else
  update private.admin_review_flags set status='resolved',resolved_by=actor,resolved_at=now(),updated_at=now() where review_id=p_id;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 return private.admin_review(p_id);
end $$;
alter function private.set_admin_review_flag(uuid,bigint,text,text,text) owner to triggerboxd_admin_reader;
create function public.set_admin_review_flag(p_id uuid,p_expected_revision bigint,p_action text,p_reason text default null,p_note text default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.set_admin_review_flag(p_id,p_expected_revision,p_action,p_reason,p_note) $$;
revoke all on function private.set_admin_review_flag(uuid,bigint,text,text,text),public.set_admin_review_flag(uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.set_admin_review_flag(uuid,bigint,text,text,text),public.set_admin_review_flag(uuid,bigint,text,text,text) to authenticated;

create function private.admin_flagged_reviews(p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_admin_owner();
 if p_limit is null or p_limit not between 1 and 25 or p_offset is null or p_offset not between 0 and 5000 then raise exception 'INVALID_REQUEST';end if;
 return jsonb_build_object('total',(select count(*) from private.admin_review_flags where status='open'),
 'reviews',coalesce((select jsonb_agg(row.value order by row.flagged_at desc,row.review_id) from (
 select f.flagged_at,f.review_id,jsonb_build_object('id',c.id,'movieId',m.id,'filmTitle',m.title,'reason',f.reason,'note',f.note,'flaggedAt',f.flagged_at,'reviewChanged',c.revision<>f.review_revision) value
 from private.admin_review_flags f join public.contributions c on c.id=f.review_id join public.movies m on m.id=c.movie_id
 where f.status='open' order by f.flagged_at desc,f.review_id limit p_limit offset p_offset) row),'[]'::jsonb));
end $$;
alter function private.admin_flagged_reviews(integer,integer) owner to triggerboxd_admin_reader;
create function public.get_admin_flagged_reviews(p_limit integer default 10,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.admin_flagged_reviews(p_limit,p_offset) $$;
revoke all on function private.admin_flagged_reviews(integer,integer),public.get_admin_flagged_reviews(integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.admin_flagged_reviews(integer,integer),public.get_admin_flagged_reviews(integer,integer) to authenticated;

-- Add only the identifiers required for owner-only navigation.
do $$ declare original text; updated text;begin
 original:=pg_get_functiondef('private.admin_overview(integer,integer)'::regprocedure);
 updated:=replace(original,'''title'', m.title, ''year''','''id'', m.id, ''title'', m.title, ''year''');
 updated:=replace(updated,'''filmTitle'', m.title,','''id'', c.id, ''movieId'', m.id, ''filmTitle'', m.title,');
 if updated=original then raise exception 'ADMIN_NAVIGATION_UPGRADE_FAILED';end if;
 execute updated;
end $$;
revoke create on schema private from triggerboxd_admin_reader;
commit;
