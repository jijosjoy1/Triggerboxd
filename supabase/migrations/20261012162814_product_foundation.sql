-- Additive product foundation. No notes or public individual contributor identities.
begin;
-- Managed postgres is not a superuser: function ownership transfer requires
-- CREATE for the new owner. Grant only inside this transaction and revoke below.
grant create on schema private,public to triggerboxd_writer,triggerboxd_reader;
alter table public.warning_categories drop constraint warning_categories_sort_order_check;
alter table public.warning_categories add constraint warning_categories_sort_order_check check(sort_order between 1 and 100);
insert into public.warning_categories values
 ('animal_harm','Animal harm','Animal distress, injury, cruelty or death.',7),
 ('drugs','Drugs','References, use, addiction or overdose. Assess presentation.',8),
 ('alcohol','Alcohol','Consumption, intoxication or alcohol abuse.',9),
 ('language','Language','Profanity or strong language.',10),
 ('physical_violence','Physical violence','Physical assault, torture or domestic violence.',11);
alter table public.category_ratings add column spoiler_level smallint not null default 0 check(spoiler_level between 0 and 2);
create table public.warning_descriptors (
 slug text primary key check(slug ~ '^[a-z][a-z0-9_]{1,79}$'),
 category_slug text not null references public.warning_categories(slug),
 label text not null check(char_length(label) between 1 and 100),
 unique(slug,category_slug)
);
create table public.rating_descriptors (
 contribution_id uuid not null,
 category_slug text not null,
 descriptor_slug text not null,
 primary key(contribution_id,category_slug,descriptor_slug),
 foreign key(contribution_id,category_slug) references public.category_ratings(contribution_id,category_slug) on delete cascade,
 foreign key(descriptor_slug,category_slug) references public.warning_descriptors(slug,category_slug)
);
insert into public.warning_descriptors values
 ('male_nudity','nudity','Male nudity'),('female_nudity','nudity','Female nudity'),
 ('partial_nudity','nudity','Partial nudity'),('full_frontal_nudity','nudity','Full-frontal nudity'),
 ('brief_nudity','nudity','Brief nudity'),('prolonged_nudity','nudity','Prolonged nudity'),
 ('sexual_nudity','nudity','Sexual nudity'),('non_sexual_nudity','nudity','Non-sexual nudity'),
 ('kissing','sexual_content','Kissing'),('intimacy','sexual_content','Intimacy'),('sexual_activity','sexual_content','Sexual activity'),
 ('rape','sexual_violence','Rape'),('attempted_rape','sexual_violence','Attempted rape'),
 ('sexual_assault','sexual_violence','Sexual assault'),('sexual_harassment','sexual_violence','Sexual harassment'),
 ('sexual_coercion','sexual_violence','Sexual coercion'),('implied_sexual_violence','sexual_violence','Implied sexual violence'),
 ('offscreen_sexual_violence','sexual_violence','Off-screen sexual violence'),('graphic_sexual_violence','sexual_violence','Graphic sexual violence'),
 ('blood','gore_graphic_violence','Blood'),('graphic_injury','gore_graphic_violence','Graphic injury'),
 ('animal_distress','animal_harm','Animal distress'),('animal_injury','animal_harm','Animal injury'),
 ('animal_cruelty','animal_harm','Animal cruelty'),('animal_death','animal_harm','Animal death'),
 ('recreational_drug_use','drugs','Recreational drug use'),('drug_addiction','drugs','Addiction'),('overdose','drugs','Overdose'),
 ('alcohol_consumption','alcohol','Alcohol consumption'),('intoxication','alcohol','Intoxication'),('alcohol_abuse','alcohol','Alcohol abuse'),
 ('profanity','language','Profanity'),('slurs','language','Slurs'),
 ('physical_assault','physical_violence','Physical assault'),('torture','physical_violence','Torture'),('domestic_violence','physical_violence','Domestic violence');
create table public.representation_definitions (
 slug text primary key, label text not null
);
insert into public.representation_definitions values
 ('lgbtq_characters','LGBTQ+ characters'),('same_sex_romance','Same-sex romance'),
 ('same_sex_kissing','Same-sex kissing'),('gender_identity','Gender identity themes');
create table public.representation_details (
 contribution_id uuid not null references public.contributions(id) on delete cascade,
 representation_slug text not null references public.representation_definitions(slug),
 spoiler_level smallint not null default 0 check(spoiler_level between 0 and 2),
 primary key(contribution_id,representation_slug)
);
create table public.family_votes (
 user_id uuid not null references auth.users(id) on delete cascade,
 movie_id uuid not null references public.movies(id) on delete restrict,
 value smallint not null check(value between 1 and 5),
 revision bigint not null check(revision between 1 and 9007199254740991),
 updated_at timestamptz not null default now(),
 primary key(user_id,movie_id)
);
alter table public.warning_descriptors enable row level security;
alter table public.rating_descriptors enable row level security;
alter table public.representation_definitions enable row level security;
alter table public.representation_details enable row level security;
alter table public.family_votes enable row level security;
revoke all on public.warning_descriptors,public.rating_descriptors,public.representation_definitions,
 public.representation_details,public.family_votes from public,anon,authenticated,service_role;
grant select on public.warning_descriptors,public.representation_definitions to anon,authenticated,triggerboxd_writer,triggerboxd_reader;
create policy descriptor_definitions_read on public.warning_descriptors for select to anon,authenticated,triggerboxd_writer,triggerboxd_reader using(true);
create policy representation_definitions_read on public.representation_definitions for select to anon,authenticated,triggerboxd_writer,triggerboxd_reader using(true);
grant select,insert,update,delete on public.rating_descriptors,public.representation_details,public.family_votes to triggerboxd_writer;
grant select on public.rating_descriptors,public.representation_details,public.family_votes to triggerboxd_reader;
create policy descriptors_internal on public.rating_descriptors to triggerboxd_writer using(true) with check(true);
create policy descriptors_summary on public.rating_descriptors for select to triggerboxd_reader using(true);
create policy representation_internal on public.representation_details to triggerboxd_writer using(true) with check(true);
create policy representation_summary on public.representation_details for select to triggerboxd_reader using(true);
create policy family_internal on public.family_votes to triggerboxd_writer using(true) with check(true);
create policy family_summary on public.family_votes for select to triggerboxd_reader using(true);
alter table private.idempotency_keys drop constraint idempotency_keys_operation_check;
alter table private.idempotency_keys add constraint idempotency_keys_operation_check check(operation in('put','delete','import','patch','family'));

-- Own responses may contain spoiler data; they must never enter public caches.
create or replace function private.read_own(p_actor uuid,p_movie_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object('contribution',(
 select jsonb_build_object('revision',c.revision,'watched',c.watched,'ratings',coalesce((
 select jsonb_agg(jsonb_build_object('category',r.category_slug,'severity',r.severity,
 'spoilerLevel',r.spoiler_level,'descriptors',coalesce((select jsonb_agg(d.descriptor_slug order by d.descriptor_slug)
 from public.rating_descriptors d where d.contribution_id=r.contribution_id and d.category_slug=r.category_slug),'[]'::jsonb)) order by w.sort_order)
 from public.category_ratings r join public.warning_categories w on w.slug=r.category_slug where r.contribution_id=c.id
 ),'[]'::jsonb)) from public.contributions c where c.user_id=p_actor and c.movie_id=p_movie_id))
$$;

-- Preserve extended categories and metadata for legacy clients doing full replacement.
-- Removing a historical category still means withdrawing that old assessment.
do $$ declare definition text; begin
 definition := pg_get_functiondef('private.put_contribution(uuid,bigint,boolean,jsonb,text)'::regprocedure);
 definition := replace(definition,'between 1 and 6','between 1 and 11');
 definition := replace(definition,'delete from public.category_ratings where contribution_id=v_id;',
 'delete from public.category_ratings r using public.warning_categories w where r.contribution_id=v_id and w.slug=r.category_slug and w.sort_order<=6 and not exists(select 1 from jsonb_array_elements(p_ratings) item where item->>''category''=r.category_slug);');
 definition := replace(definition,'select v_id,r ->> ''category'',(r ->> ''severity'')::smallint from jsonb_array_elements(p_ratings) r;',
 'select v_id,r ->> ''category'',(r ->> ''severity'')::smallint from jsonb_array_elements(p_ratings) r where true on conflict(contribution_id,category_slug) do update set severity=excluded.severity;');
 definition := replace(definition,'delete from public.category_ratings r using',
 'if exists(select 1 from jsonb_array_elements(p_ratings) item join public.rating_descriptors d on d.contribution_id=v_id and d.category_slug=item->>''category'' where item->>''severity''=''0'') then raise exception ''INVALID_REQUEST''; end if; delete from public.category_ratings r using');
 execute definition;
end $$;

create function private.patch_warning(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,
 p_category text,p_severity smallint,p_spoiler_level smallint,p_descriptors text[],p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.current_actor_id(); cid uuid; rev bigint; vis text;
 body jsonb; cached private.idempotency_keys%rowtype; response jsonb;
begin
 perform private.require_actor(actor);
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991
 or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$'
 or p_severity is null or p_severity not between 0 and 3 or p_spoiler_level is null or p_spoiler_level not between 0 and 2
 or p_descriptors is null or cardinality(p_descriptors)>30
 or cardinality(p_descriptors)<>(select count(distinct d) from unnest(p_descriptors) d)
 or not exists(select 1 from public.warning_categories where slug=p_category)
 or exists(select 1 from unnest(p_descriptors) d where not exists(select 1 from public.warning_descriptors w where w.slug=d and w.category_slug=p_category))
 or (p_severity=0 and cardinality(p_descriptors)>0) then raise exception 'INVALID_REQUEST'; end if;
 if p_watched is distinct from true then raise exception 'WATCH_CONFIRMATION_REQUIRED'; end if;
 body:=jsonb_build_object('movieId',p_movie_id,'expectedRevision',p_expected_revision,'watched',p_watched,
 'category',p_category,'severity',p_severity,'spoilerLevel',p_spoiler_level,'descriptors',array(select d from unnest(p_descriptors) d order by d));
 delete from private.idempotency_keys where actor_id=actor and operation='patch' and key=p_idempotency_key and expires_at<=statement_timestamp();
 select * into cached from private.idempotency_keys where actor_id=actor and operation='patch' and key=p_idempotency_key;
 if found then if cached.body<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return cached.response; end if;
 perform 1 from public.movies where id=p_movie_id and visibility='published' for share;
 if not found then raise exception 'NOT_FOUND'; end if;
 select id,revision,visibility into cid,rev,vis from public.contributions where user_id=actor and movie_id=p_movie_id for update;
 if coalesce(rev,0)<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 if vis='hidden' then raise exception 'FORBIDDEN'; end if;
 perform private.consume_quota('contribution',actor::text,10,60);
 perform private.consume_quota('contribution',actor::text,100,86400);
 rev:=nextval('private.contribution_revision');
 if cid is null then insert into public.contributions(user_id,movie_id,revision,watched) values(actor,p_movie_id,rev,true) returning id into cid;
 else update public.contributions set revision=rev,updated_at=statement_timestamp() where id=cid; end if;
 insert into public.category_ratings(contribution_id,category_slug,severity,spoiler_level) values(cid,p_category,p_severity,p_spoiler_level)
 on conflict(contribution_id,category_slug) do update set severity=excluded.severity,spoiler_level=excluded.spoiler_level;
 delete from public.rating_descriptors where contribution_id=cid and category_slug=p_category;
 insert into public.rating_descriptors select cid,p_category,d from unnest(p_descriptors) d;
 response:=private.read_own(actor,p_movie_id);
 insert into private.idempotency_keys(actor_id,operation,key,body,response) values(actor,'patch',p_idempotency_key,body,response);
 return response;
end $$;
alter function private.patch_warning(uuid,bigint,boolean,text,smallint,smallint,text[],text) owner to triggerboxd_writer;
create function public.patch_warning(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_category text,
 p_severity smallint,p_spoiler_level smallint,p_descriptors text[],p_idempotency_key text) returns jsonb
language sql security invoker set search_path = '' as $$
 select private.patch_warning(p_movie_id,p_expected_revision,p_watched,p_category,p_severity,p_spoiler_level,p_descriptors,p_idempotency_key)
$$;

-- Category-hidden and unassessed bins serialize identically. A universal reveal
-- control, never a hidden-count indicator, is required by the consuming UI.
create function private.summary_at_level(p_movie_id uuid,p_categories text[],p_level smallint) returns jsonb
language sql stable security definer set search_path = '' as $$
 with movie as(select * from public.movies where id=p_movie_id and visibility='published'),
 eligible as materialized(select c.id from public.contributions c join private.user_access a on a.user_id=c.user_id
 where c.movie_id=p_movie_id and c.visibility='active' and a.status='active'),
 levels as(select r.category_slug,max(r.spoiler_level) effective from public.category_ratings r join eligible e on e.id=r.contribution_id group by r.category_slug),
 exposed as materialized(select w.slug,w.sort_order,coalesce(l.effective,0) effective,
 (coalesce(l.effective,0)<2 or (p_level=2 and w.slug=any(p_categories))) visible
 from public.warning_categories w left join levels l on l.category_slug=w.slug),
 bins as(select x.slug,x.sort_order,x.effective,x.visible,count(r.severity)::integer n,
 count(*) filter(where r.severity=0)::integer b0,count(*) filter(where r.severity=1)::integer b1,
 count(*) filter(where r.severity=2)::integer b2,count(*) filter(where r.severity=3)::integer b3,
 (array_agg(r.severity order by r.severity) filter(where r.severity is not null))[count(r.severity)::integer/2+1] severity
 from exposed x left join(select r.* from public.category_ratings r join eligible e on e.id=r.contribution_id) r
 on r.category_slug=x.slug and x.visible group by x.slug,x.sort_order,x.effective,x.visible)
 select jsonb_build_object('id',m.id,'tmdbId',m.tmdb_id,'title',m.title,'originalTitle',m.original_title,
 'year',extract(year from m.release_date)::integer,'language',m.original_language,'posterPath',m.poster_path,
 'synopsis',null,'metadataFetchedAt',m.metadata_fetched_at,
 'contributorCount',(select count(distinct r.contribution_id)::integer from public.category_ratings r join eligible e on e.id=r.contribution_id
 join exposed x on x.slug=r.category_slug and x.visible),
 'warnings',(select jsonb_agg(jsonb_build_object('category',b.slug,'severity',b.severity,'count',b.n,
 'distribution',jsonb_build_array(b.b0,b.b1,b.b2,b.b3),'provisional',b.n between 1 and 2,
 'disputed',b.n>=2 and ((b.b0>=ceil(b.n*0.25) and b.b2+b.b3>=ceil(b.n*0.25)) or (b.b0+b.b1>=ceil(b.n*0.25) and b.b3>=ceil(b.n*0.25))),
 'descriptors',case when b.visible and (b.effective=0 or (p_level>=1 and b.slug=any(p_categories))) then coalesce((
 select jsonb_agg(d.descriptor_slug order by d.descriptor_slug) from(select distinct rd.descriptor_slug from public.rating_descriptors rd
 join eligible e on e.id=rd.contribution_id where rd.category_slug=b.slug) d),'[]'::jsonb) else '[]'::jsonb end)
 order by b.sort_order) from bins b)) from movie m
$$;
alter function private.summary_at_level(uuid,text[],smallint) owner to triggerboxd_reader;
create or replace function private.get_movie_summary(p_movie_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select private.summary_at_level(p_movie_id,'{}'::text[],0::smallint)
$$;
-- Both definer entry points have the same narrow reader; direct helper forbidden.
grant execute on function private.summary_at_level(uuid,text[],smallint) to triggerboxd_reader;
create function private.reveal_movie_warnings(p_movie_id uuid,p_categories text[],p_level smallint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if p_level is null or p_level not between 1 and 2 or p_categories is null or cardinality(p_categories) not between 1 and 11
 or cardinality(p_categories)<>(select count(distinct c) from unnest(p_categories) c)
 or exists(select 1 from unnest(p_categories) c where not exists(select 1 from public.warning_categories w where w.slug=c))
 then raise exception 'INVALID_REQUEST'; end if;
 return private.summary_at_level(p_movie_id,p_categories,p_level);
end $$;
alter function private.reveal_movie_warnings(uuid,text[],smallint) owner to triggerboxd_reader;
create function public.reveal_movie_warnings(p_movie_id uuid,p_categories text[],p_level smallint) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select private.reveal_movie_warnings(p_movie_id,p_categories,p_level)
$$;
-- Sitemap eligibility cannot count contributions whose only reports are hidden.
create or replace function private.get_indexable_movies(p_limit integer default 500,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset not between 0 and 10000 then raise exception 'INVALID_REQUEST'; end if;
 with eligible as(select c.id,c.movie_id,c.updated_at,a.changed_at from public.contributions c
 join private.user_access a on a.user_id=c.user_id and a.status='active' where c.visibility='active'),
 hidden as(select e.movie_id,r.category_slug from public.category_ratings r join eligible e on e.id=r.contribution_id group by e.movie_id,r.category_slug having max(r.spoiler_level)=2),
 safe as(select e.* from eligible e where exists(select 1 from public.category_ratings r where r.contribution_id=e.id
 and not exists(select 1 from hidden h where h.movie_id=e.movie_id and h.category_slug=r.category_slug)))
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'updatedAt',v.updated_at) order by v.id),'[]'::jsonb) into result from(
 select m.id,greatest(m.metadata_fetched_at,max(s.updated_at),max(s.changed_at)) updated_at from public.movies m join safe s on s.movie_id=m.id
 where m.visibility='published' group by m.id having count(*)>=3 order by m.id limit p_limit offset p_offset) v;
 return result;
end $$;

-- Independent opinion; no derived public family aggregate until its spoiler
-- disclosure policy is settled. Own writes/reads remain available.
create function private.get_my_family_vote(p_movie_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.current_actor_id(); begin
 perform private.require_actor(actor);
 if not exists(select 1 from public.movies where id=p_movie_id and visibility='published') then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('familyVote',(select jsonb_build_object('revision',revision,'value',value) from public.family_votes where user_id=actor and movie_id=p_movie_id));
end $$;
alter function private.get_my_family_vote(uuid) owner to triggerboxd_writer;
create function public.get_my_family_vote(p_movie_id uuid) returns jsonb language sql security invoker set search_path = '' as $$
 select private.get_my_family_vote(p_movie_id)
$$;
create function private.put_family_vote(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_value smallint,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.current_actor_id(); rev bigint; body jsonb; cached private.idempotency_keys%rowtype; response jsonb;
begin
 perform private.require_actor(actor);
 if p_value is null or p_value not between 1 and 5 or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991
 or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'INVALID_REQUEST'; end if;
 if p_watched is distinct from true then raise exception 'WATCH_CONFIRMATION_REQUIRED'; end if;
 body:=jsonb_build_object('movieId',p_movie_id,'expectedRevision',p_expected_revision,'watched',p_watched,'value',p_value);
 delete from private.idempotency_keys where actor_id=actor and operation='family' and key=p_idempotency_key and expires_at<=statement_timestamp();
 select * into cached from private.idempotency_keys where actor_id=actor and operation='family' and key=p_idempotency_key;
 if found then if cached.body<>body then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return cached.response; end if;
 perform 1 from public.movies where id=p_movie_id and visibility='published' for share;
 if not found then raise exception 'NOT_FOUND'; end if;
 select revision into rev from public.family_votes where user_id=actor and movie_id=p_movie_id for update;
 if coalesce(rev,0)<>p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 perform private.consume_quota('contribution',actor::text,10,60);
 perform private.consume_quota('contribution',actor::text,100,86400);
 rev:=nextval('private.contribution_revision');
 insert into public.family_votes(user_id,movie_id,value,revision) values(actor,p_movie_id,p_value,rev)
 on conflict(user_id,movie_id) do update set value=excluded.value,revision=excluded.revision,updated_at=statement_timestamp();
 response:=private.get_my_family_vote(p_movie_id);
 insert into private.idempotency_keys(actor_id,operation,key,body,response) values(actor,'family',p_idempotency_key,body,response);
 return response;
end $$;
alter function private.put_family_vote(uuid,bigint,boolean,smallint,text) owner to triggerboxd_writer;
create function public.put_family_vote(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_value smallint,p_idempotency_key text) returns jsonb
language sql security invoker set search_path = '' as $$
 select private.put_family_vote(p_movie_id,p_expected_revision,p_watched,p_value,p_idempotency_key)
$$;
revoke all on function private.patch_warning(uuid,bigint,boolean,text,smallint,smallint,text[],text),public.patch_warning(uuid,bigint,boolean,text,smallint,smallint,text[],text),
 private.summary_at_level(uuid,text[],smallint),private.reveal_movie_warnings(uuid,text[],smallint),public.reveal_movie_warnings(uuid,text[],smallint),
 private.get_my_family_vote(uuid),public.get_my_family_vote(uuid),private.put_family_vote(uuid,bigint,boolean,smallint,text),public.put_family_vote(uuid,bigint,boolean,smallint,text)
 from public,anon,authenticated,service_role;
grant execute on function private.patch_warning(uuid,bigint,boolean,text,smallint,smallint,text[],text),public.patch_warning(uuid,bigint,boolean,text,smallint,smallint,text[],text),
 private.get_my_family_vote(uuid),public.get_my_family_vote(uuid),private.put_family_vote(uuid,bigint,boolean,smallint,text),public.put_family_vote(uuid,bigint,boolean,smallint,text) to authenticated;
grant execute on function private.reveal_movie_warnings(uuid,text[],smallint),public.reveal_movie_warnings(uuid,text[],smallint) to anon,authenticated;
revoke create on schema private,public from triggerboxd_writer,triggerboxd_reader;
commit;
