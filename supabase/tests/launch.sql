-- Execute only against a disposable local database; fixtures and helpers roll back.
begin;
create schema test;
create table test.results(name text primary key, passed boolean not null);
grant usage on schema test to anon, authenticated, service_role;
grant select, insert on test.results to anon, authenticated, service_role;
create function test.assert(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERTION FAILED: %', name; end if;
  insert into test.results values (name, true);
end $$;
create function test.denied(name text, command text, expected text) returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin
    execute command;
  exception when others then
    if sqlerrm not like '%' || expected || '%' then raise; end if;
    caught := true;
  end;
  perform test.assert(name, caught);
end $$;
select test.assert('internal writer uses narrow auth bridge', has_function_privilege('triggerboxd_writer','private.actor_auth_record(uuid)','execute'));
select test.assert('anonymous cannot call auth bridge', not has_function_privilege('anon','private.actor_auth_record(uuid)','execute'));
select test.assert('signed-in users cannot call auth bridge', not has_function_privilege('authenticated','private.actor_auth_record(uuid)','execute'));
select test.assert('service role cannot call auth bridge', not has_function_privilege('service_role','private.actor_auth_record(uuid)','execute'));
select test.assert('internal writer has no auth schema create permission', not has_schema_privilege('triggerboxd_writer','auth','create'));
select test.assert('all exposed tables have RLS', not exists (
  select 1 from pg_tables where schemaname='public' and not rowsecurity
));
select test.assert('private state has RLS', not exists(select 1 from pg_tables where schemaname='private' and not rowsecurity));
select test.assert('public RPCs are invokers', not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef));
select test.assert('definers have fixed empty search path', not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prosecdef and not ('search_path=""'=any(p.proconfig))));
select test.assert('app functions revoke default public execute', not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where n.nspname in ('public','private') and acl.grantee=0 and acl.privilege_type='EXECUTE'));
select test.assert('definer owners cannot log in or bypass RLS', not exists(select 1 from pg_roles where rolname in ('triggerboxd_writer','triggerboxd_reader') and (rolcanlogin or rolbypassrls or rolsuper)));
select test.assert('no notes reports or moderator tables', not exists(select 1 from pg_tables where schemaname in ('public','private') and tablename in ('contribution_notes','reports','moderation_actions')));
create table test.state(key text primary key,value jsonb);
grant select,insert,update on test.state to anon,authenticated,service_role;
insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000001',now(),'{"display_name":"User A","role":"moderator"}'),
 ('00000000-0000-4000-8000-000000000002',now(),'{"display_name":"User B"}'),
 ('00000000-0000-4000-8000-000000000003',null,'{}'),
 ('00000000-0000-4000-8000-000000000004',now(),'{}');
update auth.users set is_anonymous=true where id='00000000-0000-4000-8000-000000000004';
insert into public.movies(id,tmdb_id,title,original_title,original_language) values
 ('10000000-0000-4000-8000-000000000001',1,'Test movie','Test movie','en'),
 ('10000000-0000-4000-8000-000000000002',2,'Quota fixture','Quota fixture','en');
select test.assert('metadata cannot assign account privileges', (select status='active' from private.user_access where user_id='00000000-0000-4000-8000-000000000001'));
select test.assert('migration backfills existing profiles without touching auth',exists(select 1 from public.profiles where user_id='00000000-0000-4000-8000-000000000099')
  and exists(select 1 from private.user_access where user_id='00000000-0000-4000-8000-000000000099'));

set local role anon;
select test.assert('anonymous sees eleven categories', (select count(*)=11 from public.warning_categories));
select test.assert('new movie has eleven Unknown warnings', (select jsonb_array_length(value->'warnings')=11 and (value->>'contributorCount')::integer=0
  and not exists(select 1 from jsonb_array_elements(value->'warnings') w where w->'severity'<>'null'::jsonb or w->>'count'<>'0' or w->>'provisional'<>'false')
  from (select public.get_movie_summary('10000000-0000-4000-8000-000000000001') value) s));
select test.denied('anon cannot read raw contributions','select * from public.contributions','permission denied');
select test.denied('anon cannot read raw ratings','select * from public.category_ratings','permission denied');
select test.denied('anon cannot read account state','select * from private.user_access','permission denied');
select test.denied('anon cannot invoke contribution RPC',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0}]','anon-key-1')$cmd$,'permission denied');
select test.denied('anon cannot import metadata',$cmd$select public.import_movie('00000000-0000-4000-8000-000000000001',4,'{}','import-key-1')$cmd$,'permission denied');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select test.denied('authenticated role without identity is rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0}]','no-actor-1')$cmd$,'AUTH_REQUIRED');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select test.denied('unconfirmed email cannot bypass app through RPC',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0}]','unverified-1')$cmd$,'EMAIL_NOT_VERIFIED');
select test.assert('own account exposes verification state',public.get_my_account_status()->>'emailVerified'='false');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select test.denied('anonymous auth user with authenticated role cannot write',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0}]','anonymous-1')$cmd$,'EMAIL_NOT_VERIFIED');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select test.denied('user cannot directly insert contribution',$cmd$insert into public.contributions(user_id,movie_id,revision,watched) values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,true)$cmd$,'permission denied');
select test.denied('user cannot directly change ratings','update public.category_ratings set severity=3','permission denied');
select test.denied('user cannot promote account','update private.user_access set status=''active''','permission denied');
select test.denied('user cannot directly insert movies',$cmd$insert into public.movies(tmdb_id,title,original_title,original_language) values(8,'Spoof','Spoof','en')$cmd$,'permission denied');
select test.denied('user cannot write operator log',$cmd$insert into private.operator_actions(operator_reference,action,reason) values('spoof','suspend_account','spoof')$cmd$,'permission denied');
select test.denied('user cannot call quota internals',$cmd$select private.consume_quota('contribution','spoof',10000,60)$cmd$,'permission denied');
select test.denied('user cannot read idempotency bodies','select * from private.idempotency_keys','permission denied');
select test.denied('user cannot invoke privileged import',$cmd$select public.import_movie('00000000-0000-4000-8000-000000000001',4,'{}','import-key-2')$cmd$,'permission denied');
select test.denied('watched confirmation is required',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,false,'[{"category":"nudity","severity":0}]','watched-bad')$cmd$,'WATCH_CONFIRMATION_REQUIRED');
select test.denied('empty rating set cannot create misleading contribution',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[]','empty-bad-1')$cmd$,'INVALID_REQUEST');
select test.denied('duplicate categories rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0},{"category":"nudity","severity":1}]','duplicate-1')$cmd$,'INVALID_REQUEST');
select test.denied('invalid category rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"unknown","severity":0}]','invalid-cat')$cmd$,'INVALID_REQUEST');
select test.denied('out of range severity rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":4}]','invalid-sev')$cmd$,'INVALID_REQUEST');
select test.denied('fractional severity rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":1.5}]','decimal-sev')$cmd$,'INVALID_REQUEST');
select test.denied('string severity rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":"0"}]','string-sev')$cmd$,'INVALID_REQUEST');
select test.denied('rating identity or note fields rejected',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0,"note":"no","user_id":"spoof"}]','extra-field')$cmd$,'INVALID_REQUEST');
select test.denied('scalar rating element is invalid',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[null]','scalar-rating')$cmd$,'INVALID_REQUEST');
select test.denied('unknown movie is not writable',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000099',0,true,'[{"category":"nudity","severity":0}]','missing-mov')$cmd$,'NOT_FOUND');
insert into test.state values('a-put',public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0},{"category":"sexual_content","severity":2}]','a-first-put'));
select test.assert('owner can read own contribution',(select count(*)=1 from public.contributions));
select test.assert('explicit zero persists as None',(select severity=0 from public.category_ratings where category_slug='nudity'));
select test.assert('unanswered category has no rating row',(select count(*)=2 from public.category_ratings));
select test.assert('exact retry replays response',public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"sexual_content","severity":2},{"category":"nudity","severity":0}]','a-first-put')=(select value from test.state where key='a-put'));
select test.denied('different body with same key conflicts',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":3}]','a-first-put')$cmd$,'IDEMPOTENCY_CONFLICT');
select test.denied('second insert loses revision check',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":3}]','a-racing-put')$cmd$,'REVISION_CONFLICT');
insert into test.state values('a-edit',public.put_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='a-put'),true,'[{"category":"nudity","severity":3}]','a-second-put'));
select test.assert('full replacement removes omitted category',(select count(*)=1 and min(category_slug)='nudity' and min(severity)=3 from public.category_ratings));
select test.denied('stale edit cannot overwrite current vote',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='a-put'),true,'[{"category":"nudity","severity":0}]','a-stale-put')$cmd$,'REVISION_CONFLICT');
select test.denied('invalid edit rolls back complete set',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='a-edit'),true,'[{"category":"nudity","severity":0},{"category":"spoof","severity":2}]','a-invalid-edit')$cmd$,'INVALID_REQUEST');
select test.assert('invalid edit preserves revision and ratings',public.get_my_contribution('10000000-0000-4000-8000-000000000001')=(select value from test.state where key='a-edit'));
select test.assert('edit never increases unique count',public.get_movie_summary('10000000-0000-4000-8000-000000000001')->>'contributorCount'='1');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select test.assert('B cannot read A raw contribution',(select count(*)=0 from public.contributions));
select test.assert('B cannot read A raw ratings',(select count(*)=0 from public.category_ratings));
select test.assert('B cannot read A profile',(select count(*)=1 and min(user_id::text)='00000000-0000-4000-8000-000000000002' from public.profiles));
select test.assert('own RPC returns null for B',public.get_my_contribution('10000000-0000-4000-8000-000000000001')='{"contribution":null}'::jsonb);
select test.denied('B cannot delete A via movie ID',$cmd$select public.delete_contribution('10000000-0000-4000-8000-000000000001',1,'b-delete-a')$cmd$,'NOT_FOUND');
insert into test.state values('b-put',public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":0}]','b-first-put'));
select test.assert('[0,3] is Severe provisional disputed',(select w->>'severity'='3' and w->>'provisional'='true' and w->>'disputed'='true' and w->'distribution'='[1,0,0,1]'::jsonb
  from jsonb_array_elements(public.get_movie_summary('10000000-0000-4000-8000-000000000001')->'warnings') w where w->>'category'='nudity'));
reset role;
select test.assert('idempotent retry consumes quota only once',(select count=2 from private.request_buckets where action='contribution' and subject_hash='00000000-0000-4000-8000-000000000001' and window_seconds=60));
select test.assert('invalid writes do not create contributions',(select count(*)=2 from public.contributions));
update private.user_access set status='suspended' where user_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
select test.denied('suspended user denied despite still-present identity',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='b-put'),true,'[{"category":"nudity","severity":3}]','b-suspended')$cmd$,'ACCOUNT_SUSPENDED');
select test.assert('suspension excludes votes immediately',public.get_movie_summary('10000000-0000-4000-8000-000000000001')->>'contributorCount'='1');
reset role;
update private.user_access set status='active' where user_id='00000000-0000-4000-8000-000000000002';
update public.contributions set visibility='hidden' where user_id='00000000-0000-4000-8000-000000000002';
set local role authenticated;
select test.denied('hidden vote cannot be restored by owner edit',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='b-put'),true,'[{"category":"nudity","severity":3}]','b-hidden-edit')$cmd$,'FORBIDDEN');
select test.assert('owner removal excludes vote immediately',public.get_movie_summary('10000000-0000-4000-8000-000000000001')->>'contributorCount'='1');
select test.assert('owner can delete hidden contribution',public.delete_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='b-put'),'b-delete-hidden')='{"deleted":true}'::jsonb);
select test.assert('delete retry is idempotent',public.delete_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='b-put'),'b-delete-hidden')='{"deleted":true}'::jsonb);
insert into test.state values('b-recreated',public.put_contribution('10000000-0000-4000-8000-000000000001',0,true,'[{"category":"nudity","severity":1}]','b-recreate'));
select test.denied('stale pre-delete revision cannot mutate recreated row',$cmd$select public.delete_contribution('10000000-0000-4000-8000-000000000001',(select (value->'contribution'->>'revision')::bigint from test.state where key='b-put'),'b-stale-delete')$cmd$,'REVISION_CONFLICT');
reset role;
update public.movies set visibility='hidden' where id='10000000-0000-4000-8000-000000000001';
set local role anon;
select test.assert('hidden movie summary returns null',public.get_movie_summary('10000000-0000-4000-8000-000000000001') is null);
select test.assert('hidden movies absent from public raw metadata',(select count(*)=0 from public.movies where id='10000000-0000-4000-8000-000000000001'));
reset role;
update public.movies set visibility='published' where id='10000000-0000-4000-8000-000000000001';

-- Verify actual 10/min and 100/day mutation quotas without sleeping.
update private.request_buckets set count=10 where action='contribution' and subject_hash='00000000-0000-4000-8000-000000000002' and window_seconds=60;
set local role authenticated;
select test.denied('direct RPC cannot bypass minute quota',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000002',0,true,'[{"category":"nudity","severity":0}]','quota-minute')$cmd$,'RATE_LIMITED');
reset role;
update private.request_buckets set count=1 where action='contribution' and subject_hash='00000000-0000-4000-8000-000000000002' and window_seconds=60;
update private.request_buckets set count=100 where action='contribution' and subject_hash='00000000-0000-4000-8000-000000000002' and window_seconds=86400;
set local role authenticated;
select test.denied('direct RPC cannot bypass day quota',$cmd$select public.put_contribution('10000000-0000-4000-8000-000000000002',0,true,'[{"category":"nudity","severity":0}]','quota-day-1')$cmd$,'RATE_LIMITED');
reset role;
select test.assert('failed daily quota rolls back minute increment',(select count=1 from private.request_buckets where action='contribution' and subject_hash='00000000-0000-4000-8000-000000000002' and window_seconds=60));
select test.assert('quota failure writes no contribution',(select count(*)=0 from public.contributions where movie_id='10000000-0000-4000-8000-000000000002'));

-- Server import is isolated to service_role and never manufactures warning values.
set local role service_role;
select test.denied('gateway service cannot directly write protected movie tables',$cmd$insert into public.movies(tmdb_id,title,original_title,original_language) values(1000,'Spoof','Spoof','en')$cmd$,'permission denied');
select test.denied('service import rechecks unconfirmed actor',$cmd$select public.import_movie('00000000-0000-4000-8000-000000000003',99,'{}','service-bad')$cmd$,'EMAIL_NOT_VERIFIED');
select test.denied('search quota requires hashed subject',$cmd$select public.consume_search_quota('127.0.0.1')$cmd$,'INVALID_REQUEST');
select public.consume_search_quota(repeat('a',64));
insert into test.state values('import',public.import_movie('00000000-0000-4000-8000-000000000001',99,
  '{"title":"Import fixture","originalTitle":"Import fixture","releaseDate":null,"language":"en","productionCountries":[],"posterPath":null,"synopsis":null}','service-import'));
select test.assert('selected import returns created and ID',(select value->>'created'='true' and value->>'tmdbId'='99' from test.state where key='import'));
select test.assert('import retry identity ignores refreshed metadata',public.import_movie('00000000-0000-4000-8000-000000000001',99,
  '{"title":"Changed upstream title","originalTitle":"Import fixture","releaseDate":null,"language":"en","productionCountries":[],"posterPath":null,"synopsis":null}','service-import')=(select value from test.state where key='import'));
select test.assert('existing TMDb selection returns same ID without duplicate',public.import_movie('00000000-0000-4000-8000-000000000002',99,
  '{"title":"Import fixture refreshed","originalTitle":"Import fixture","releaseDate":null,"language":null,"productionCountries":[],"posterPath":null,"synopsis":null}','second-import')=
  (select jsonb_set(value,'{created}','false'::jsonb) from test.state where key='import'));
select test.denied('same import key for another ID conflicts',$cmd$select public.import_movie('00000000-0000-4000-8000-000000000001',100,'{"title":"Import fixture","originalTitle":"Import fixture","releaseDate":null,"language":"en","productionCountries":[],"posterPath":null,"synopsis":null}','service-import')$cmd$,'IDEMPOTENCY_CONFLICT');
select test.denied('invalid calendar date is rejected',$cmd$select public.import_movie('00000000-0000-4000-8000-000000000001',100,'{"title":"Import fixture","originalTitle":"Import fixture","releaseDate":"2026-02-31","language":"en","productionCountries":[],"posterPath":null,"synopsis":null}','bad-date-1')$cmd$,'INVALID_REQUEST');
select test.denied('poster cannot be attacker URL',$cmd$select public.import_movie('00000000-0000-4000-8000-000000000001',100,'{"title":"Import fixture","originalTitle":"Import fixture","releaseDate":null,"language":"en","productionCountries":[],"posterPath":"https://evil.example/a.jpg","synopsis":null}','bad-poster')$cmd$,'INVALID_REQUEST');
reset role;
set local role anon;
select test.assert('imported movie remains Unknown',(select value->>'contributorCount'='0' and not exists(select 1 from jsonb_array_elements(value->'warnings') w where w->'severity'<>'null'::jsonb)
  from (select public.get_movie_summary((select (value->>'id')::uuid from test.state where key='import')) value) s));
select test.assert('unknown upstream language remains null',public.get_movie_summary((select (value->>'id')::uuid from test.state where key='import'))->'language'='null'::jsonb);
select test.assert('public DTO contains no contributor identities or notes',not (public.get_movie_summary('10000000-0000-4000-8000-000000000001') ?| array['userId','profiles','notes','approvedNotes','contributions']));
reset role;
select test.assert('import idempotent replay charged once',(select count=1 from private.request_buckets where action='import' and subject_hash='00000000-0000-4000-8000-000000000001' and window_seconds=60));
update private.request_buckets set count=30 where action='search' and subject_hash=repeat('a',64);
set local role service_role;
select test.denied('shared search quota cannot exceed 30/min',$cmd$select public.consume_search_quota(repeat('a',64))$cmd$,'RATE_LIMITED');
reset role;

-- Regression vectors run against authoritative database aggregate, not a JS copy.
create function test.vector(p_values smallint[],p_expected jsonb) returns boolean language plpgsql as $$
declare i integer; actor uuid; contribution uuid; actual jsonb;
begin
  delete from public.contributions where movie_id='10000000-0000-4000-8000-000000000002';
  for i in 1..coalesce(cardinality(p_values),0) loop
    actor:=md5('aggregate-vector-user-'||i)::uuid;
    insert into auth.users(id,email_confirmed_at) values(actor,now()) on conflict(id) do nothing;
    insert into public.contributions(user_id,movie_id,revision,watched) values(actor,'10000000-0000-4000-8000-000000000002',nextval('private.contribution_revision'),true) returning id into contribution;
    insert into public.category_ratings(contribution_id,category_slug,severity) values(contribution,'nudity',p_values[i]);
  end loop;
  select w - 'category' - 'descriptors' into actual from jsonb_array_elements(public.get_movie_summary('10000000-0000-4000-8000-000000000002')->'warnings') w where w->>'category'='nudity';
  return actual=p_expected;
end $$;
select test.assert('[] -> Unknown',test.vector('{}','{"severity":null,"count":0,"distribution":[0,0,0,0],"provisional":false,"disputed":false}'));
select test.assert('[0] -> None provisional',test.vector('{0}','{"severity":0,"count":1,"distribution":[1,0,0,0],"provisional":true,"disputed":false}'));
select test.assert('[0,3] -> Severe provisional disputed',test.vector('{0,3}','{"severity":3,"count":2,"distribution":[1,0,0,1],"provisional":true,"disputed":true}'));
select test.assert('[0,1] -> Mild provisional not disputed',test.vector('{0,1}','{"severity":1,"count":2,"distribution":[1,1,0,0],"provisional":true,"disputed":false}'));
select test.assert('[0,0,2,2] -> Moderate disputed',test.vector('{0,0,2,2}','{"severity":2,"count":4,"distribution":[2,0,2,0],"provisional":false,"disputed":true}'));
select test.assert('[0,0,0,0,3] -> None extreme still visible',test.vector('{0,0,0,0,3}','{"severity":0,"count":5,"distribution":[4,0,0,1],"provisional":false,"disputed":false}'));
select test.assert('[0,0,1,3,3] second cut detects dispute',test.vector('{0,0,1,3,3}','{"severity":1,"count":5,"distribution":[2,1,0,2],"provisional":false,"disputed":true}'));
delete from auth.users where id=md5('aggregate-vector-user-1')::uuid;
select test.assert('account deletion cascades vote exclusion',public.get_movie_summary('10000000-0000-4000-8000-000000000002')->>'contributorCount'='4');
select test.assert('account deletion cascades profile and access',not exists(select 1 from public.profiles where user_id=md5('aggregate-vector-user-1')::uuid)
  and not exists(select 1 from private.user_access where user_id=md5('aggregate-vector-user-1')::uuid));
set local role anon;
select test.assert('sitemap includes movie with three or more eligible users',jsonb_array_length(public.get_indexable_movies())=1);
select test.assert('sitemap reveals only IDs and update dates',not exists(select 1 from jsonb_array_elements(public.get_indexable_movies()) m where m-'id'-'updatedAt'<>'{}'::jsonb));
select test.assert('sitemap pagination is deterministic and bounded',public.get_indexable_movies(1,1)='[]'::jsonb);
select test.denied('sitemap rejects unbounded limit','select public.get_indexable_movies(1001,0)','INVALID_REQUEST');
select test.denied('sitemap rejects negative offset','select public.get_indexable_movies(500,-1)','INVALID_REQUEST');
reset role;
update private.user_access set status='suspended' where user_id in (md5('aggregate-vector-user-2')::uuid,md5('aggregate-vector-user-3')::uuid);
set local role anon;
select test.assert('sitemap removes movies when eligible count drops below three',public.get_indexable_movies()='[]'::jsonb);
reset role;
update private.user_access set status='active' where user_id in (md5('aggregate-vector-user-2')::uuid,md5('aggregate-vector-user-3')::uuid);
update public.movies set visibility='hidden' where id='10000000-0000-4000-8000-000000000002';
set local role anon;
select test.assert('sitemap excludes hidden movies',public.get_indexable_movies()='[]'::jsonb);
reset role;
update private.request_buckets set expires_at=now()-interval '1 minute';
update private.idempotency_keys set expires_at=now()-interval '1 minute';
set local role service_role;
select public.expire_request_state();
reset role;
select test.assert('service cleanup deletes expired quota state',not exists(select 1 from private.request_buckets));
select test.assert('service cleanup deletes expired idempotency state',not exists(select 1 from private.idempotency_keys));

-- Explain the indexed lookup with a larger disposable fixture, not tiny-table assumptions.
insert into auth.users(id,email_confirmed_at) select md5('plan-user-'||i)::uuid,now() from generate_series(1,5000) i;
insert into public.contributions(user_id,movie_id,revision,watched)
  select md5('plan-user-'||i)::uuid,'10000000-0000-4000-8000-000000000002',nextval('private.contribution_revision'),true from generate_series(1,5000) i;
analyze public.contributions;
create function test.lookup_uses_index() returns boolean language plpgsql as $$
declare plan json;
begin
  execute 'explain (format json) select id from public.contributions where movie_id=''10000000-0000-4000-8000-000000000001'' and visibility=''active''' into plan;
  return plan::text like '%contributions_movie_eligible_idx%';
end $$;
select test.assert('movie lookup uses eligibility index with 5000 unrelated contributions',test.lookup_uses_index());
select name, passed from test.results order by name;
rollback;
