begin;
grant create on schema private,public to triggerboxd_writer,triggerboxd_reader;
insert into public.representation_definitions values ('same_sex_intimacy','Same-sex intimacy'),('transgender_characters','Transgender characters'),('lgbtq_themes','LGBTQ+ themes');
alter table private.idempotency_keys drop constraint idempotency_keys_operation_check;
alter table private.idempotency_keys add constraint idempotency_keys_operation_check check(operation in('put','delete','import','patch','family','note_put','note_delete','note_report','representation'));
create function private.get_representation(p_movie_id uuid,p_slugs text[],p_level smallint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
 if p_level is null or p_level not between 0 and 2 or p_slugs is null or cardinality(p_slugs)>7 or cardinality(p_slugs)<>(select count(distinct s) from unnest(p_slugs) s) or exists(select 1 from unnest(p_slugs) s where not exists(select 1 from public.representation_definitions d where d.slug=s)) or (p_level>0 and cardinality(p_slugs)=0) then raise exception 'INVALID_REQUEST'; end if;
 if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND'; end if;
 with eligible as materialized(select d.* from public.representation_details d join public.contributions c on c.id=d.contribution_id join private.user_access a on a.user_id=c.user_id where c.movie_id=p_movie_id and c.visibility='active' and c.watched and a.status='active'),
 effective as(select coalesce(max(spoiler_level),0) level from eligible), bins as(select representation_slug slug,count(*)::integer n from eligible where (cardinality(p_slugs)=0 or representation_slug=any(p_slugs)) and (select level from effective)<=p_level group by representation_slug)
 select jsonb_build_object('representation',coalesce(jsonb_agg(jsonb_build_object('slug',slug,'count',n,'provisional',n<3) order by slug),'[]'::jsonb)) into result from bins; return result;
end $$;
alter function private.get_representation(uuid,text[],smallint) owner to triggerboxd_reader;
create function public.get_representation(p_movie_id uuid,p_slugs text[],p_level smallint) returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_representation(p_movie_id,p_slugs,p_level) $$;
create function private.get_my_representation(p_movie_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id(); begin
 perform private.require_actor(actor);
 if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('representation',(select jsonb_build_object('revision',c.revision,'watched',c.watched,'details',coalesce((select jsonb_agg(jsonb_build_object('slug',d.representation_slug,'spoilerLevel',d.spoiler_level) order by d.representation_slug) from public.representation_details d where d.contribution_id=c.id),'[]'::jsonb)) from public.contributions c where c.movie_id=p_movie_id and c.user_id=actor));
end $$;
alter function private.get_my_representation(uuid) owner to triggerboxd_writer;
create function public.get_my_representation(p_movie_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.get_my_representation(p_movie_id) $$;
create function private.put_representation(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_slug text,p_spoiler_level smallint,p_remove boolean,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_actor_id(); cid uuid; rev bigint; vis text; body jsonb; cached private.idempotency_keys%rowtype; response jsonb;
begin
 perform private.require_actor(actor);
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991 or p_spoiler_level is null or p_spoiler_level not between 0 and 2 or p_remove is null or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' or not exists(select 1 from public.representation_definitions where slug=p_slug) then raise exception 'INVALID_REQUEST'; end if;
 if p_watched is distinct from true then raise exception 'WATCH_CONFIRMATION_REQUIRED'; end if;
 body:=jsonb_build_object('movieId',p_movie_id,'expectedRevision',p_expected_revision,'watched',p_watched,'slug',p_slug,'spoilerLevel',p_spoiler_level,'remove',p_remove);
 delete from private.idempotency_keys where actor_id=actor and operation='representation' and key=p_idempotency_key and expires_at<=statement_timestamp();
 select * into cached from private.idempotency_keys where actor_id=actor and operation='representation' and key=p_idempotency_key;
 if found then if cached.body<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return cached.response; end if;
 perform 1 from public.movies where id=p_movie_id and visibility='published' for share; if not found then raise exception 'NOT_FOUND'; end if;
 select id,revision,visibility into cid,rev,vis from public.contributions where user_id=actor and movie_id=p_movie_id for update;
 if coalesce(rev,0)<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 if vis='hidden' then raise exception 'FORBIDDEN'; end if;
 if p_remove and (cid is null or not exists(select 1 from public.representation_details where contribution_id=cid and representation_slug=p_slug)) then raise exception 'NOT_FOUND'; end if;
 perform private.consume_quota('contribution',actor::text,10,60); perform private.consume_quota('contribution',actor::text,100,86400);
 rev:=nextval('private.contribution_revision');
 if cid is null then insert into public.contributions(user_id,movie_id,revision,watched) values(actor,p_movie_id,rev,true) returning id into cid; else update public.contributions set revision=rev,watched=true,updated_at=statement_timestamp() where id=cid; end if;
 if p_remove then delete from public.representation_details where contribution_id=cid and representation_slug=p_slug; else insert into public.representation_details values(cid,p_slug,p_spoiler_level) on conflict(contribution_id,representation_slug) do update set spoiler_level=excluded.spoiler_level; end if;
 response:=private.get_my_representation(p_movie_id);
 insert into private.idempotency_keys(actor_id,operation,key,body,response) values(actor,'representation',p_idempotency_key,body,response); return response;
end $$;
alter function private.put_representation(uuid,bigint,boolean,text,smallint,boolean,text) owner to triggerboxd_writer;
create function public.put_representation(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_slug text,p_spoiler_level smallint,p_remove boolean,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.put_representation(p_movie_id,p_expected_revision,p_watched,p_slug,p_spoiler_level,p_remove,p_idempotency_key) $$;
create function private.get_family_summary(p_movie_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
 if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND'; end if;
 with votes as(select v.value from public.family_votes v join private.user_access a on a.user_id=v.user_id and a.status='active' where v.movie_id=p_movie_id), bins as(select count(*)::integer n,(array_agg(value order by value))[count(*)::integer/2+1] value,count(*) filter(where value=1)::integer b1,count(*) filter(where value=2)::integer b2,count(*) filter(where value=3)::integer b3,count(*) filter(where value=4)::integer b4,count(*) filter(where value=5)::integer b5 from votes)
 select jsonb_build_object('familySummary',jsonb_build_object('value',value,'count',n,'distribution',jsonb_build_array(b1,b2,b3,b4,b5),'provisional',n between 1 and 2)) into result from bins; return result;
end $$;
alter function private.get_family_summary(uuid) owner to triggerboxd_reader;
create function public.get_family_summary(p_movie_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_family_summary(p_movie_id) $$;
create or replace function private.reveal_movie_warnings(p_movie_id uuid,p_categories text[],p_level smallint) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin if p_level is null or p_level not between 1 and 2 or p_categories is null or cardinality(p_categories) not between 1 and 11 or cardinality(p_categories)<>(select count(distinct c) from unnest(p_categories) c) or exists(select 1 from unnest(p_categories) c where not exists(select 1 from public.warning_categories w where w.slug=c)) then raise exception 'INVALID_REQUEST'; end if; return case when exists(select 1 from public.movies where id=p_movie_id and visibility='published') then private.summary_at_level(p_movie_id,p_categories,p_level) || private.get_representation(p_movie_id,'{}',0::smallint) else null end; end $$;
-- Default summary exposes only fully safe representation; family is lazy only.
create or replace function private.get_movie_summary(p_movie_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select case when exists(select 1 from public.movies where id=p_movie_id and visibility='published') then private.summary_at_level(p_movie_id,'{}',0::smallint) || private.get_representation(p_movie_id,'{}',0::smallint) else null end $$;
revoke all on function private.get_representation(uuid,text[],smallint),public.get_representation(uuid,text[],smallint),private.get_family_summary(uuid),public.get_family_summary(uuid),private.get_my_representation(uuid),public.get_my_representation(uuid),private.put_representation(uuid,bigint,boolean,text,smallint,boolean,text),public.put_representation(uuid,bigint,boolean,text,smallint,boolean,text) from public,anon,authenticated,service_role;
grant execute on function private.get_representation(uuid,text[],smallint),public.get_representation(uuid,text[],smallint),private.get_family_summary(uuid),public.get_family_summary(uuid) to anon,authenticated,triggerboxd_reader;
grant execute on function private.get_my_representation(uuid),public.get_my_representation(uuid),private.put_representation(uuid,bigint,boolean,text,smallint,boolean,text),public.put_representation(uuid,bigint,boolean,text,smallint,boolean,text) to authenticated,triggerboxd_writer;
revoke create on schema private,public from triggerboxd_writer,triggerboxd_reader;
commit;



