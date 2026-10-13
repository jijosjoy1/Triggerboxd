begin;
create schema import_test;
create table import_test.results(name text primary key,passed boolean not null);
create function import_test.assert(name text,ok boolean) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',name; end if;
insert into import_test.results values(name,true); end $$;
create function import_test.denied(name text,command text,expected text) returns void language plpgsql as $$
declare caught boolean:=false; begin begin execute command; exception when others then
if sqlerrm not like '%'||expected||'%' then raise; end if; caught:=true; end;
perform import_test.assert(name,caught); end $$;
grant usage on schema import_test to anon,authenticated,service_role;
grant select,insert on import_test.results to anon,authenticated,service_role;
create table import_test.metadata(v jsonb);
insert into import_test.metadata values('{"title":"Public film","originalTitle":"Public film","releaseDate":null,"language":"ml","productionCountries":["IN"],"posterPath":null,"synopsis":null}');
grant select on import_test.metadata to anon,authenticated,service_role;
set local role anon;
select import_test.denied('anon RPC denied','select public.import_public_movie(1234567,(select v from import_test.metadata))','permission denied');
select import_test.denied('anon quota denied','select public.consume_public_import_quota(repeat(''a'',64))','permission denied');
set local role authenticated;
select import_test.denied('auth RPC denied','select public.import_public_movie(1234567,(select v from import_test.metadata))','permission denied');
set local role service_role;
select import_test.assert('actorless import works',public.import_public_movie(1234567,(select v from import_test.metadata))->>'created'='true');
select import_test.assert('retry same TMDb id is idempotent',public.import_public_movie(1234567,(select v from import_test.metadata)||'{"title":"Changed title"}')->>'created'='false');
select import_test.denied('invalid metadata rejected','select public.import_public_movie(1234568,''{}'')','INVALID_REQUEST');
select import_test.denied('invalid id rejected','select public.import_public_movie(0,(select v from import_test.metadata))','INVALID_REQUEST');
select import_test.denied('invalid hash rejected','select public.consume_public_import_quota(''bad'')','INVALID_REQUEST');
select public.consume_public_import_quota(repeat('a',64)) from generate_series(1,5);
select import_test.denied('subject minute quota rejects sixth','select public.consume_public_import_quota(repeat(''a'',64))','RATE_LIMITED');
reset role;
select import_test.assert('one movie only',(select count(*)=1 from public.movies where tmdb_id=1234567));
select import_test.assert('existing metadata untouched',(select title='Public film' from public.movies where tmdb_id=1234567));
select import_test.assert('no fake users',(select not exists(select 1 from auth.users where raw_user_meta_data->>'name'='Public film')));
update public.movies set visibility='hidden' where tmdb_id=1234567;
set local role service_role;
select import_test.denied('hidden cannot republish','select public.import_public_movie(1234567,(select v from import_test.metadata))','NOT_FOUND');
reset role;
select import_test.assert('hidden remains hidden',(select visibility='hidden' from public.movies where tmdb_id=1234567));
select import_test.assert('importer cannot update',not has_table_privilege('triggerboxd_public_importer','public.movies','UPDATE'));
select import_test.assert('importer cannot create',not has_schema_privilege('triggerboxd_public_importer','public','CREATE'));
select import_test.assert('importer cannot login or bypass RLS',(select not rolcanlogin and not rolbypassrls from pg_roles where rolname='triggerboxd_public_importer'));
update private.request_buckets set count=100 where action='public_import' and subject_hash='global' and window_seconds=60;
set local role service_role;
select import_test.denied('global quota bounds distributed traffic','select public.consume_public_import_quota(repeat(''c'',64))','RATE_LIMITED');
reset role;
select name,passed from import_test.results order by name;
rollback;

