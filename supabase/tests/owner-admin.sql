begin;
create schema owner_admin_test;
create table owner_admin_test.results(name text primary key, passed boolean not null);
create function owner_admin_test.assert(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERTION FAILED: %', name; end if;
  insert into owner_admin_test.results values (name, true);
end $$;
create function owner_admin_test.expect(name text, expected text, sql text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm = expected then insert into owner_admin_test.results values (name, true); return; end if;
    raise exception 'ASSERTION FAILED: % (got "%")', name, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (no error raised)', name;
end $$;
create function owner_admin_test.expect_failure(name text, sql text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then insert into owner_admin_test.results values (name, true); return;
  end;
  raise exception 'ASSERTION FAILED: % (no error raised)', name;
end $$;
grant usage on schema owner_admin_test to anon, authenticated;
grant select, insert on owner_admin_test.results to anon, authenticated;
grant execute on function owner_admin_test.assert(text,boolean), owner_admin_test.expect(text,text,text),
  owner_admin_test.expect_failure(text,text) to anon, authenticated;

-- Fixtures: the account trigger seeds a profile for each auth user.
insert into auth.users(id, email_confirmed_at, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', now(), '{}'),
  ('e0000000-0000-4000-8000-000000000002', now(), '{}'),
  ('e0000000-0000-4000-8000-000000000003', now(), '{}');
update public.profiles set display_name = 'Owner Nick' where user_id = 'e0000000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'Cinema Fan' where user_id = 'e0000000-0000-4000-8000-000000000002';
update public.profiles set display_name = 'Third Viewer' where user_id = 'e0000000-0000-4000-8000-000000000003';
insert into public.movies(id, tmdb_id, title, original_title, release_date) values
  ('e1000000-0000-4000-8000-000000000001', 700001, 'Owner Fixture Film', 'Owner Fixture Film', '2022-05-01');
insert into public.contributions(id, user_id, movie_id, revision, watched) values
  ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
   'e1000000-0000-4000-8000-000000000001', 1, true);
insert into public.category_ratings(contribution_id, category_slug, severity) values
  ('e2000000-0000-4000-8000-000000000001', 'nudity', 2),
  ('e2000000-0000-4000-8000-000000000001', 'language', 1);
-- Provisioning is an operator action through the migration role.
insert into private.admin_owners(user_id, note) values ('e0000000-0000-4000-8000-000000000001', 'fixture owner');

select owner_admin_test.assert('anon cannot execute the overview',
  not has_function_privilege('anon', 'public.get_admin_overview(integer,integer)', 'EXECUTE'));
select owner_admin_test.assert('anon and service_role cannot reach the private aggregate',
  not has_function_privilege('anon', 'private.admin_overview(integer,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.admin_overview(integer,integer)', 'EXECUTE'));
select owner_admin_test.assert('the owner guard helper is not callable by browser roles',
  not has_function_privilege('anon', 'private.admin_is_owner(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.admin_is_owner(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.admin_is_owner(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.admin_actor_status(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.admin_actor_status(uuid)', 'EXECUTE'));
select owner_admin_test.assert('service_role cannot reach the private aggregate',
  not has_function_privilege('service_role', 'private.admin_overview(integer,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_admin_overview(integer,integer)', 'EXECUTE'));
select owner_admin_test.assert('no browser or service role can read the owner allowlist',
  not has_table_privilege('anon', 'private.admin_owners', 'SELECT')
  and not has_table_privilege('authenticated', 'private.admin_owners', 'SELECT')
  and not has_table_privilege('service_role', 'private.admin_owners', 'SELECT'));
select owner_admin_test.assert('no role can write the owner allowlist',
  not has_table_privilege('anon', 'private.admin_owners', 'INSERT')
  and not has_table_privilege('authenticated', 'private.admin_owners', 'INSERT')
  and not has_table_privilege('service_role', 'private.admin_owners', 'INSERT')
  and not has_table_privilege('authenticated', 'private.admin_owners', 'UPDATE'));
select owner_admin_test.assert('owner list retains no provider identity columns',
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'private' and table_name = 'admin_owners') = 'user_id,provisioned_at,note');
select owner_admin_test.assert('existing reader grants are unchanged',
  has_table_privilege('triggerboxd_reader', 'public.contributions', 'SELECT')
  and not has_table_privilege('triggerboxd_reader', 'private.admin_owners', 'SELECT'));

-- Anonymous caller: denied at the privilege layer, before any authorisation logic.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select owner_admin_test.expect_failure('anonymous caller cannot reach the overview', 'select public.get_admin_overview(1,0)');
reset role;

-- Authenticated but no actor in the token: the guard still refuses.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select owner_admin_test.expect('caller without an actor is refused', 'AUTH_REQUIRED', 'select public.get_admin_overview(1,0)');
reset role;

-- Authenticated but not an owner.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000003', true);
select owner_admin_test.expect('non-owner is refused', 'FORBIDDEN', 'select public.get_admin_overview(1,0)');
select owner_admin_test.expect_failure('non-owner cannot promote themselves',
  'insert into private.admin_owners(user_id) values (''e0000000-0000-4000-8000-000000000003'')');
reset role;

-- Owner caller.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select owner_admin_test.assert('owner receives accurate counts',
  (public.get_admin_overview(25,0)->'assessments'->>'total')::int = 1
  and (public.get_admin_overview(25,0)->'assessments'->>'categoryRatings')::int = 2
  and (public.get_admin_overview(25,0)->'films'->>'total')::int = 1
  and (public.get_admin_overview(25,0)->'accounts'->>'total')::int >= 3);
select owner_admin_test.assert('an assessment is not counted as its category ratings',
  (public.get_admin_overview(25,0)->'assessments'->>'total')::int
  <> (public.get_admin_overview(25,0)->'assessments'->>'categoryRatings')::int);
select owner_admin_test.assert('a brand new assessment counts as never edited',
  (public.get_admin_overview(25,0)->'assessments'->>'neverEdited')::int = 1
  and (public.get_admin_overview(25,0)->'assessments'->>'edited')::int = 0);
select owner_admin_test.assert('recent accounts are the newest first and bounded',
  jsonb_array_length(public.get_admin_overview(1,0)->'recentAccounts') = 1
  and (public.get_admin_overview(3,0)->'recentAccounts'->0->>'nickname') = 'Owner Nick'
  and (public.get_admin_overview(3,0)->'recentAccounts'->1->>'nickname') = 'Cinema Fan'
  and (public.get_admin_overview(3,0)->'recentAccounts'->2->>'nickname') = 'Third Viewer'
  and (public.get_admin_overview(1,0)->'recentAccounts'->0->>'nickname')
      <> (public.get_admin_overview(1,1)->'recentAccounts'->0->>'nickname'));
select owner_admin_test.assert('assessment summary carries category and severity',
  (public.get_admin_overview(25,0)->'recentAssessments'->0->'categories'->0->>'category') is not null
  and (public.get_admin_overview(25,0)->'recentAssessments'->0->'categories'->0->>'severity') is not null
  and (public.get_admin_overview(25,0)->'recentAssessments'->0->>'filmTitle') = 'Owner Fixture Film'
  and (public.get_admin_overview(25,0)->'recentAssessments'->0->>'edited')::boolean = false);
select owner_admin_test.assert('recent film reports title, year and import time',
  (public.get_admin_overview(25,0)->'recentFilms'->0->>'title') = 'Owner Fixture Film'
  and (public.get_admin_overview(25,0)->'recentFilms'->0->>'year')::int = 2022
  and (public.get_admin_overview(25,0)->'recentFilms'->0->>'importedAt') is not null);
select owner_admin_test.assert('response carries only allowlisted top-level fields',
  (select string_agg(key, ',' order by key) from jsonb_object_keys(public.get_admin_overview(25,0)) k(key))
  = 'accounts,assessments,films,generatedAt,recentAccounts,recentAssessments,recentFilms');
select owner_admin_test.assert('recent rows carry only public summary fields',
  (select string_agg(key, ',' order by key) from jsonb_object_keys(public.get_admin_overview(25,0)->'recentAccounts'->0) k(key)) = 'joinedAt,nickname'
  and (select string_agg(key, ',' order by key) from jsonb_object_keys(public.get_admin_overview(25,0)->'recentFilms'->0) k(key)) = 'importedAt,title,year'
  and (select string_agg(key, ',' order by key) from jsonb_object_keys(public.get_admin_overview(25,0)->'recentAssessments'->0) k(key)) = 'categories,categoryCount,edited,filmTitle,submittedAt,updatedAt'
  and (select string_agg(key, ',' order by key) from jsonb_object_keys(public.get_admin_overview(25,0)->'recentAssessments'->0->'categories'->0) k(key)) = 'category,severity');
select owner_admin_test.assert('response never leaks provider name, email or text content',
  (public.get_admin_overview(25,0))::text not like '%Google%'
  and (public.get_admin_overview(25,0))::text not like '%@%'
  and (public.get_admin_overview(25,0))::text not like '%synopsis%');
select owner_admin_test.expect('pagination limit is bounded', 'INVALID_REQUEST', 'select public.get_admin_overview(0,0)');
select owner_admin_test.expect('pagination limit upper bound is enforced', 'INVALID_REQUEST', 'select public.get_admin_overview(26,0)');
select owner_admin_test.expect('negative offset is refused', 'INVALID_REQUEST', 'select public.get_admin_overview(1,-1)');
reset role;

-- An edit after the first submission is distinguishable.
update public.contributions set updated_at = now() + interval '1 hour'
where id = 'e2000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select owner_admin_test.assert('an edited assessment is reported as edited',
  (public.get_admin_overview(25,0)->'assessments'->>'edited')::int = 1
  and (public.get_admin_overview(25,0)->'assessments'->>'neverEdited')::int = 0
  and (public.get_admin_overview(25,0)->'recentAssessments'->0->>'edited')::boolean = true);
reset role;

-- Direct RPC calls must enforce the same account status as the HTTP handler.
update private.user_access set status = 'suspended' where user_id = 'e0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select owner_admin_test.expect('suspended owner is refused by the database', 'ACCOUNT_SUSPENDED', 'select public.get_admin_overview(1,0)');
reset role;
update private.user_access set status = 'active' where user_id = 'e0000000-0000-4000-8000-000000000001';
update auth.users set email_confirmed_at = null where id = 'e0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select owner_admin_test.expect('unverified owner is refused by the database', 'EMAIL_NOT_VERIFIED', 'select public.get_admin_overview(1,0)');
reset role;
update auth.users set email_confirmed_at = now() where id = 'e0000000-0000-4000-8000-000000000001';

-- Revoking the trusted allowlist row takes effect on the next request.
delete from private.admin_owners where user_id = 'e0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select owner_admin_test.expect('revoked owner is immediately refused', 'FORBIDDEN', 'select public.get_admin_overview(1,0)');
reset role;

select name, passed from owner_admin_test.results;
rollback;
