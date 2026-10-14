-- Disposable database assertions for the two independent topics and six-bin scale.
begin;
create schema warning_scale_test;
create table warning_scale_test.results(name text primary key,passed boolean not null);
create table warning_scale_test.state(key text primary key,value jsonb not null);
grant usage on schema warning_scale_test to anon,authenticated;
grant select,insert on all tables in schema warning_scale_test to anon,authenticated;
create function warning_scale_test.assert(name text,ok boolean) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'ASSERTION FAILED: %',name; end if;
 insert into warning_scale_test.results values(name,true);
end $$;
create function warning_scale_test.denied(name text,command text,expected text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
 begin execute command; exception when others then
  if sqlerrm not like '%'||expected||'%' then raise; end if;
  caught:=true;
 end;
 perform warning_scale_test.assert(name,caught);
end $$;
insert into auth.users(id,email_confirmed_at) values
 ('81000000-0000-4000-8000-000000000001',now()),
 ('81000000-0000-4000-8000-000000000002',now());
insert into public.movies(id,tmdb_id,title,original_title) values
 ('81000000-0000-4000-8000-000000000003',81000,'Warning scale fixture','Warning scale fixture'),
 ('81000000-0000-4000-8000-000000000004',81001,'Full replacement fixture','Full replacement fixture');

set local role anon;
select warning_scale_test.assert('new categories start unrated, not None',
 (select count(*)=2 from jsonb_array_elements(public.get_movie_summary('81000000-0000-4000-8000-000000000003')->'warnings') w
  where w->>'category' in ('graphic_violence','horror') and w->>'count'='0' and w->'severity'='null'::jsonb));
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
insert into warning_scale_test.state values('full',public.put_contribution(
 '81000000-0000-4000-8000-000000000004',0,true,
 (select jsonb_agg(jsonb_build_object('category',slug,'severity',5) order by sort_order) from public.warning_categories),
 'scale-full-thirteen'));
select warning_scale_test.assert('full replacement accepts thirteen topics at level five',
 jsonb_array_length((select value from warning_scale_test.state where key='full')->'contribution'->'ratings')=13);
select warning_scale_test.denied('fourteen ratings still rejected',
 $cmd$select public.put_contribution('81000000-0000-4000-8000-000000000004',0,true,
  (select jsonb_agg(jsonb_build_object('category',slug,'severity',5)) || '[{"category":"nudity","severity":5}]'::jsonb
   from public.warning_categories),'scale-fourteen')$cmd$,'INVALID_REQUEST');
insert into warning_scale_test.state values('gore',public.patch_warning(
 '81000000-0000-4000-8000-000000000003',0,true,'gore_graphic_violence',3::smallint,0::smallint,array['graphic_injury'],'scale-old-gore'));
insert into warning_scale_test.state values('graphic',public.patch_warning(
 '81000000-0000-4000-8000-000000000003',
 (select (value->'contribution'->>'revision')::bigint from warning_scale_test.state where key='gore'),
 true,'graphic_violence',4::smallint,0::smallint,array['visible_bloodshed'],'scale-graphic'));
insert into warning_scale_test.state values('horror',public.patch_warning(
 '81000000-0000-4000-8000-000000000003',
 (select (value->'contribution'->>'revision')::bigint from warning_scale_test.state where key='graphic'),
 true,'horror',5::smallint,0::smallint,array['jump_scare'],'scale-horror'));
select warning_scale_test.assert('scene note persists extreme horror independently',
 (public.put_movie_note('81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000005',0,true,'horror','A frightening moment.',
  null,null,null,0::smallint,'scale-horror-note',5::smallint)->'note'->>'severity')='5');
select warning_scale_test.assert('three independent rows persist without reclassifying old gore',
 (select count(*)=3 and min(severity) filter(where category_slug='gore_graphic_violence')=3
  and min(severity) filter(where category_slug='graphic_violence')=4
  and min(severity) filter(where category_slug='horror')=5
  from public.category_ratings r join public.contributions c on c.id=r.contribution_id
  where c.movie_id='81000000-0000-4000-8000-000000000003'));
select warning_scale_test.assert('physical violence remains an untouched separate category',
 not exists(select 1 from public.category_ratings r join public.contributions c on c.id=r.contribution_id
  where c.movie_id='81000000-0000-4000-8000-000000000003' and r.category_slug='physical_violence'));
set local role anon;
select warning_scale_test.assert('high bins appear independently in public summary',
 (select count(*)=3 from jsonb_array_elements(public.get_movie_summary('81000000-0000-4000-8000-000000000003')->'warnings') w
  where (w->>'category'='gore_graphic_violence' and w->'distribution'='[0,0,0,1,0,0]'::jsonb)
  or (w->>'category'='graphic_violence' and w->'distribution'='[0,0,0,0,1,0]'::jsonb)
  or (w->>'category'='horror' and w->'distribution'='[0,0,0,0,0,1]'::jsonb)));
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select public.patch_warning('81000000-0000-4000-8000-000000000003',0,true,'horror',0::smallint,0::smallint,'{}','scale-horror-none');
set local role anon;
select warning_scale_test.assert('None and Extreme remain disputed with visible high tail',
 (select w->>'severity'='5' and w->>'disputed'='true' and w->'distribution'='[1,0,0,0,0,1]'::jsonb
  from jsonb_array_elements(public.get_movie_summary('81000000-0000-4000-8000-000000000003')->'warnings') w
  where w->>'category'='horror'));
reset role;
select * from warning_scale_test.results order by name;
rollback;
