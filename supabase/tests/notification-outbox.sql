begin;
create schema notification_test;
create table notification_test.results(name text primary key, passed boolean not null);
create function notification_test.assert(name text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERTION FAILED: %', name; end if;
  insert into notification_test.results values (name, true);
end $$;
grant usage on schema notification_test to service_role;
grant select, insert on notification_test.results to service_role;
grant execute on function notification_test.assert(text,boolean) to service_role;
-- The dispatcher receives event ids from the queue payload; this helper lets the
-- service-role assertions resolve one without granting it any table access.
create function notification_test.event_id(p_key text) returns uuid language sql security definer set search_path = '' as $$
  select id from private.notification_outbox where event_key = p_key
$$;
grant execute on function notification_test.event_id(text) to service_role;

select notification_test.assert('no events are backfilled for rows created before the triggers',
  (select count(*) from private.notification_outbox) = 0);

insert into auth.users(id, email_confirmed_at, raw_user_meta_data) values
  ('f0000000-0000-4000-8000-000000000001', now(), '{"display_name":"Provider Real Name"}');
insert into public.movies(id, tmdb_id, title, original_title) values
  ('f1000000-0000-4000-8000-000000000001', 800001, 'Notification Fixture Film', 'Notification Fixture Film');

select notification_test.assert('a new account queues exactly one account event',
  (select count(*) from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000001') = 1);
select notification_test.assert('a first import queues exactly one film event',
  (select count(*) from private.notification_outbox where event_key = 'film_imported:f1000000-0000-4000-8000-000000000001') = 1);
select notification_test.assert('film event carries only the title a notification needs',
  (select film_title = 'Notification Fixture Film' and event_type = 'film_imported'
   from private.notification_outbox where event_key = 'film_imported:f1000000-0000-4000-8000-000000000001'));
select notification_test.assert('account event carries no film title',
  (select film_title is null from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000001'));
select notification_test.assert('the outbox has no identity or content columns',
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'private' and table_name = 'notification_outbox')
  = 'id,event_key,event_type,occurred_at,film_title,attempts,status,next_attempt_at,lease_token,lease_until,last_error_code,completed_at,created_at');

-- Re-queueing the same key must not create a second event.
insert into private.notification_outbox(event_key, event_type) values
  ('account_created:f0000000-0000-4000-8000-000000000001', 'account_created')
  on conflict (event_key) do nothing;
select notification_test.assert('duplicate event keys never create a second row',
  (select count(*) from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000001') = 1);

-- A second, unrelated account still gets its own event.
insert into auth.users(id, email_confirmed_at) values ('f0000000-0000-4000-8000-000000000002', now());
select notification_test.assert('a second account queues its own event',
  (select count(*) from private.notification_outbox where event_type = 'account_created') = 2);

select notification_test.assert('only the service role may read due events',
  has_function_privilege('service_role', 'private.notification_events(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.notification_events(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.notification_events(integer)', 'EXECUTE'));
select notification_test.assert('only the service role may record results or clean up',
  has_function_privilege('service_role', 'private.record_notification_result(uuid,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'private.cleanup_notifications(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.record_notification_result(uuid,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.cleanup_notifications(integer)', 'EXECUTE'));
select notification_test.assert('the outbox is not reachable by any browser or service role',
  not has_table_privilege('anon', 'private.notification_outbox', 'SELECT')
  and not has_table_privilege('authenticated', 'private.notification_outbox', 'INSERT')
  and not has_table_privilege('service_role', 'private.notification_outbox', 'SELECT'));

set local role service_role;
create temporary table notification_claims as select private.notification_events(5) as payload;
select notification_test.assert('service role atomically claims due events',
  (select jsonb_array_length(payload) = 3 from notification_claims));
select notification_test.assert('a second concurrent style read sees no unexpired leases',
  jsonb_array_length(private.notification_events(5)) = 0);
select notification_test.assert('the queue exposes only allowlisted fields',
  (select string_agg(key, ',' order by key) from jsonb_object_keys((select payload->0 from notification_claims)) k(key))
  = 'attempts,eventType,filmTitle,id,leaseToken,occurredAt');
select notification_test.assert('the queue payload never carries an email address',
  (select payload::text not like '%@%' from notification_claims));
reset role;
select notification_test.assert('each claimed event increments attempts before delivery',
  (select bool_and(attempts = 1 and lease_token is not null and lease_until > now())
   from private.notification_outbox));
select notification_test.assert('an arbitrary lease cannot acknowledge',
  not private.record_notification_result(
    notification_test.event_id('film_imported:f1000000-0000-4000-8000-000000000001'),
    gen_random_uuid(), 'sent', null));
select notification_test.assert('matching lease records retry',
  private.record_notification_result(
    notification_test.event_id('film_imported:f1000000-0000-4000-8000-000000000001'),
    (select lease_token from private.notification_outbox where event_key = 'film_imported:f1000000-0000-4000-8000-000000000001'),
    'retry', 'timeout'));
select notification_test.assert('retry releases lease and defers delivery',
  (select attempts = 1 and lease_token is null and next_attempt_at > now() and last_error_code = 'timeout'
   from private.notification_outbox where event_key = 'film_imported:f1000000-0000-4000-8000-000000000001'));
select notification_test.assert('matching lease marks delivered',
  private.record_notification_result(
    notification_test.event_id('account_created:f0000000-0000-4000-8000-000000000001'),
    (select lease_token from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000001'),
    'sent', null));
select notification_test.assert('delivered event cannot be acknowledged again',
  not private.record_notification_result(
    notification_test.event_id('account_created:f0000000-0000-4000-8000-000000000001'),
    gen_random_uuid(), 'sent', null));
select notification_test.assert('a delivered event is marked sent',
  (select status = 'sent' and completed_at is not null from private.notification_outbox
   where event_key = 'account_created:f0000000-0000-4000-8000-000000000001'));

-- Simulate a crash after the claim: expired leases become eligible only after backoff.
create temporary table old_notification_lease as select lease_token from private.notification_outbox
 where event_key = 'account_created:f0000000-0000-4000-8000-000000000002';
select notification_test.assert('an unexpired lease is not offered early',
  jsonb_array_length(private.notification_events(5)) = 0);
update private.notification_outbox set lease_until = now() - interval '1 second', next_attempt_at = now() - interval '1 second'
 where event_key = 'account_created:f0000000-0000-4000-8000-000000000002';
select notification_test.assert('expired lease is reclaimed',
  jsonb_array_length(private.notification_events(5)) = 1);
select notification_test.assert('crash retry consumes an attempt',
  (select attempts = 2 from private.notification_outbox
   where event_key = 'account_created:f0000000-0000-4000-8000-000000000002'));
select notification_test.assert('reclaim uses a new token',
  (select o.lease_token is distinct from old.lease_token
   from private.notification_outbox o cross join old_notification_lease old
   where o.event_key = 'account_created:f0000000-0000-4000-8000-000000000002'));
select notification_test.assert('stale result cannot overwrite the new lease',
  not private.record_notification_result(
    notification_test.event_id('account_created:f0000000-0000-4000-8000-000000000002'),
    (select lease_token from old_notification_lease), 'sent', null));
update private.notification_outbox set attempts = 6, lease_until = now() - interval '1 second',
  next_attempt_at = now() - interval '1 second'
 where event_key = 'account_created:f0000000-0000-4000-8000-000000000002';
select private.notification_events(5);
select notification_test.assert('crashed final attempt becomes terminal',
  (select status = 'failed' and last_error_code = 'attempts_exhausted'
   from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000002'));

-- Retention keeps anything still eligible and removes what is finished.
update private.notification_outbox set completed_at = now() - interval '40 days'
 where event_key = 'account_created:f0000000-0000-4000-8000-000000000001';
update private.notification_outbox set occurred_at = now() - interval '90 days', created_at = now() - interval '90 days'
 where event_key = 'film_imported:f1000000-0000-4000-8000-000000000001';
select notification_test.assert('cleanup removes a finished event past the window',
  (select private.cleanup_notifications(30)) = 1);
select notification_test.assert('cleanup preserves a pending event however old',
  (select count(*) from private.notification_outbox where event_key = 'film_imported:f1000000-0000-4000-8000-000000000001') = 1);
select notification_test.assert('the delivered event is gone',
  (select count(*) from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000001') = 0);
select notification_test.assert('a recently failed event is retained',
  (select count(*) from private.notification_outbox where event_key = 'account_created:f0000000-0000-4000-8000-000000000002') = 1);

-- A queue storage failure does not abort signup and is counted without PII.
revoke insert on private.notification_outbox from triggerboxd_writer;
insert into auth.users(id,email_confirmed_at) values ('f0000000-0000-4000-8000-000000000003', now());
grant insert on private.notification_outbox to triggerboxd_writer;
select notification_test.assert('signup survives enqueue failure',
  (select count(*) = 1 from auth.users where id = 'f0000000-0000-4000-8000-000000000003'));
select notification_test.assert('enqueue failure is aggregated without identity',
  (select failure_count = 1 and event_type = 'account_created' from private.notification_enqueue_failures
   where failure_day = current_date));

select name, passed from notification_test.results;
rollback;
