-- Dedicated disposable-fixture checks, no live movie/user data.
begin;
create schema evolution_test;
create table evolution_test.results(name text primary key,passed boolean not null);
create table evolution_test.state(k text primary key,v jsonb);
grant usage on schema evolution_test to anon,authenticated;
grant select,insert,update on all tables in schema evolution_test to anon,authenticated;
create function evolution_test.assert(name text,ok boolean) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',name; end if;
insert into evolution_test.results values(name,true); end $$;
create function evolution_test.denied(name text,command text,expected text) returns void language plpgsql as $$
declare caught boolean:=false; begin begin execute command; exception when others then
if sqlerrm not like '%'||expected||'%' then raise; end if; caught:=true; end;
perform evolution_test.assert(name,caught); end $$;
insert into auth.users(id,email_confirmed_at) values
('80000000-0000-4000-8000-000000000001',now()),('80000000-0000-4000-8000-000000000002',now());
insert into public.movies(id,tmdb_id,title,original_title,synopsis) values
('80000000-0000-4000-8000-000000000003',88888,'Evolution fixture','Evolution fixture','Plot twist must not leak');
set local role anon;
insert into evolution_test.state values('empty',public.get_movie_summary('80000000-0000-4000-8000-000000000003'));
select evolution_test.denied('anonymous cannot read descriptors raw','select * from public.rating_descriptors','permission denied');
select evolution_test.denied('anonymous cannot read representation raw','select * from public.representation_details','permission denied');
select evolution_test.denied('anonymous cannot read family votes','select * from public.family_votes','permission denied');
select evolution_test.denied('anonymous cannot bypass helper','select private.summary_at_level(null,null,0::smallint)','permission denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
insert into evolution_test.state values('first',public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',3::smallint,2::smallint,array['animal_death'],'patch-first'));
select evolution_test.assert('owner can read extended own assessment',((select v from evolution_test.state where k='first')->'contribution'->'ratings'->0) @> '{"category":"animal_harm","severity":3,"spoilerLevel":2,"descriptors":["animal_death"]}');
select evolution_test.assert('idempotent patch returns same revision',public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',3::smallint,2::smallint,array['animal_death'],'patch-first')=(select v from evolution_test.state where k='first'));
select evolution_test.denied('stale patch rejects',$cmd$select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',2::smallint,2::smallint,'{}','patch-stale')$cmd$,'REVISION_CONFLICT');
select evolution_test.denied('cross category descriptor rejects',$cmd$select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'nudity',1::smallint,0::smallint,array['animal_death'],'patch-cross')$cmd$,'INVALID_REQUEST');
select evolution_test.denied('None cannot contain positive descriptors',$cmd$select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',0::smallint,0::smallint,array['animal_death'],'patch-none')$cmd$,'INVALID_REQUEST');
select evolution_test.denied('duplicate descriptors reject',$cmd$select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',1::smallint,0::smallint,array['animal_death','animal_death'],'patch-dupe')$cmd$,'INVALID_REQUEST');
select evolution_test.denied('invalid spoiler level rejects',$cmd$select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',1::smallint,3::smallint,'{}','patch-spoiler')$cmd$,'INVALID_REQUEST');
set local role anon;
select evolution_test.assert('hidden-only public JSON exactly equals empty movie JSON',public.get_movie_summary('80000000-0000-4000-8000-000000000003')=(select v from evolution_test.state where k='empty'));
select evolution_test.assert('level1 cannot reveal hidden category',public.reveal_movie_warnings('80000000-0000-4000-8000-000000000003',array['animal_harm'],1::smallint)=(select v from evolution_test.state where k='empty'));
select evolution_test.assert('unrelated reveal does not reveal hidden category',public.reveal_movie_warnings('80000000-0000-4000-8000-000000000003',array['nudity'],2::smallint)=(select v from evolution_test.state where k='empty'));
select evolution_test.assert('selected reveal returns actual hidden assessment',exists(select 1 from jsonb_array_elements(public.reveal_movie_warnings('80000000-0000-4000-8000-000000000003',array['animal_harm'],2::smallint)->'warnings') w where w @> '{"category":"animal_harm","severity":3,"count":1,"descriptors":["animal_death"]}'));
select evolution_test.denied('unknown reveal category rejects',$cmd$select public.reveal_movie_warnings('80000000-0000-4000-8000-000000000003',array['evil'],2::smallint)$cmd$,'INVALID_REQUEST');
select evolution_test.denied('duplicate reveal categories reject',$cmd$select public.reveal_movie_warnings('80000000-0000-4000-8000-000000000003',array['nudity','nudity'],2::smallint)$cmd$,'INVALID_REQUEST');
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
select evolution_test.assert('other user cannot read assessment',public.get_my_contribution('80000000-0000-4000-8000-000000000003')='{"contribution":null}'::jsonb);
select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'animal_harm',0::smallint,0::smallint,'{}','second-user');
set local role anon;
select evolution_test.assert('mixed contributors remain conservatively category hidden',public.get_movie_summary('80000000-0000-4000-8000-000000000003')=(select v from evolution_test.state where k='empty'));
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
insert into evolution_test.state values('legacy',public.put_contribution('80000000-0000-4000-8000-000000000003',(select (v->'contribution'->>'revision')::bigint from evolution_test.state where k='first'),true,'[{"category":"nudity","severity":1}]','legacy-put'));
select evolution_test.assert('legacy replacement preserves extended category',exists(select 1 from jsonb_array_elements((select v from evolution_test.state where k='legacy')->'contribution'->'ratings') r where r @> '{"category":"animal_harm","spoilerLevel":2,"descriptors":["animal_death"]}'));
insert into evolution_test.state values('detail',public.patch_warning('80000000-0000-4000-8000-000000000003',(select (v->'contribution'->>'revision')::bigint from evolution_test.state where k='legacy'),true,'nudity',2::smallint,1::smallint,array['brief_nudity'],'detail-patch'));
select evolution_test.assert('partial patch preserves other assessments',jsonb_array_length((select v from evolution_test.state where k='detail')->'contribution'->'ratings')=2);
select evolution_test.denied('legacy None cannot silently contradict retained descriptor',$cmd$select public.put_contribution('80000000-0000-4000-8000-000000000003',(select (v->'contribution'->>'revision')::bigint from evolution_test.state where k='detail'),true,'[{"category":"nudity","severity":0}]','legacy-none')$cmd$,'INVALID_REQUEST');
insert into evolution_test.state values('legacy-detail',public.put_contribution('80000000-0000-4000-8000-000000000003',(select (v->'contribution'->>'revision')::bigint from evolution_test.state where k='detail'),true,'[{"category":"nudity","severity":3}]','legacy-retain'));
select evolution_test.assert('legacy update retains existing detail spoiler level',exists(select 1 from jsonb_array_elements((select v from evolution_test.state where k='legacy-detail')->'contribution'->'ratings') r where r @> '{"category":"nudity","severity":3,"spoilerLevel":1,"descriptors":["brief_nudity"]}'));
insert into evolution_test.state values('family',public.put_family_vote('80000000-0000-4000-8000-000000000003',0,true,5::smallint,'family-first'));
select evolution_test.assert('family idempotent replay same vote',public.put_family_vote('80000000-0000-4000-8000-000000000003',0,true,5::smallint,'family-first')=(select v from evolution_test.state where k='family'));
select evolution_test.denied('family duplicate cannot increase weight',$cmd$select public.put_family_vote('80000000-0000-4000-8000-000000000003',0,true,4::smallint,'family-dupe')$cmd$,'REVISION_CONFLICT');
select evolution_test.denied('family zero invalid',$cmd$select public.put_family_vote('80000000-0000-4000-8000-000000000003',0,true,0::smallint,'family-zero')$cmd$,'INVALID_REQUEST');
select evolution_test.assert('family update uses global new revision',
 (public.put_family_vote('80000000-0000-4000-8000-000000000003',(select (v->'familyVote'->>'revision')::bigint from evolution_test.state where k='family'),true,2::smallint,'family-update')->'familyVote'->>'revision')::bigint
 > (select (v->'familyVote'->>'revision')::bigint from evolution_test.state where k='family'));
select evolution_test.denied('family requires watched confirmation',$cmd$select public.put_family_vote('80000000-0000-4000-8000-000000000003',0,false,2::smallint,'family-watch')$cmd$,'WATCH_CONFIRMATION_REQUIRED');
select evolution_test.denied('raw descriptor updates denied','delete from public.rating_descriptors','permission denied');
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',true);
select evolution_test.assert('family ownership isolated',public.get_my_family_vote('80000000-0000-4000-8000-000000000003')='{"familyVote":null}'::jsonb);
set local role anon;
select evolution_test.assert('detail-level severity visible but descriptors absent',exists(select 1 from jsonb_array_elements(public.get_movie_summary('80000000-0000-4000-8000-000000000003')->'warnings') w where w @> '{"category":"nudity","severity":3,"descriptors":[]}'));
select evolution_test.assert('selected level1 descriptors revealed',exists(select 1 from jsonb_array_elements(public.reveal_movie_warnings('80000000-0000-4000-8000-000000000003',array['nudity'],1::smallint)->'warnings') w where w @> '{"category":"nudity","descriptors":["brief_nudity"]}'));
select evolution_test.assert('family never derived or exposed before policy',not(public.get_movie_summary('80000000-0000-4000-8000-000000000003') ? 'familyVote'));
select evolution_test.assert('TMDb synopsis absent from safe warning summary',public.get_movie_summary('80000000-0000-4000-8000-000000000003')->'synopsis'='null'::jsonb);
reset role;
select evolution_test.assert('one family vote per user movie',(select count(*)=1 from public.family_votes where movie_id='80000000-0000-4000-8000-000000000003'));
update private.user_access set status='suspended' where user_id='80000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select evolution_test.denied('suspended actor cannot patch',$cmd$select public.patch_warning('80000000-0000-4000-8000-000000000003',0,true,'nudity',1::smallint,0::smallint,'{}','suspended-patch')$cmd$,'ACCOUNT_SUSPENDED');
select evolution_test.denied('suspended actor cannot family vote',$cmd$select public.put_family_vote('80000000-0000-4000-8000-000000000003',0,true,2::smallint,'suspended-family')$cmd$,'ACCOUNT_SUSPENDED');
set local role anon;
select evolution_test.assert('suspended spoiler report removed from effective policy',exists(select 1 from jsonb_array_elements(public.get_movie_summary('80000000-0000-4000-8000-000000000003')->'warnings') w where w @> '{"category":"animal_harm","severity":0,"count":1}'));
reset role;
select name,passed from evolution_test.results order by name;
rollback;
