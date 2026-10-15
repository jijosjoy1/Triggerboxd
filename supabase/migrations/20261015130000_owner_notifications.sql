-- Owner notifications. Events are captured from authoritative row changes into a
-- private outbox, then delivered asynchronously so a mail outage can never block
-- account creation or a film import. No existing object is altered.
begin;

create table private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  -- The unique key is what makes duplicate event creation impossible.
  event_key text not null unique check (char_length(event_key) between 1 and 200),
  event_type text not null check (event_type in ('account_created','film_imported')),
  occurred_at timestamptz not null default now(),
  -- Only the fields a minimal notification needs. Never an email, provider name,
  -- token, review text or warning detail.
  film_title text check (film_title is null or char_length(film_title) between 1 and 300),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) between 1 and 40),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_outbox_due_idx on private.notification_outbox(next_attempt_at, lease_until)
  where status = 'pending';
create index notification_outbox_retention_idx on private.notification_outbox(completed_at);
alter table private.notification_outbox enable row level security;
revoke all on private.notification_outbox from public, anon, authenticated, service_role;
-- Only the internal writer touches the table; the dispatcher reaches it through
-- the definer functions below, so service_role needs no table access at all.
grant select, insert, update, delete on private.notification_outbox to triggerboxd_writer;
create policy notification_outbox_internal on private.notification_outbox
  to triggerboxd_writer using (true) with check (true);

-- Aggregate only: neither account IDs nor provider details are stored here.
create table private.notification_enqueue_failures (
  failure_day date not null,
  event_type text not null check (event_type in ('account_created','film_imported')),
  failure_count bigint not null default 0,
  last_failure_at timestamptz not null default now(),
  primary key (failure_day, event_type)
);
alter table private.notification_enqueue_failures enable row level security;
revoke all on private.notification_enqueue_failures from public, anon, authenticated, service_role;
grant select, insert, update on private.notification_enqueue_failures to triggerboxd_writer;
create policy notification_enqueue_failures_internal on private.notification_enqueue_failures
  to triggerboxd_writer using (true) with check (true);

-- Capture. The insert is wrapped so a queue problem can never fail the parent
-- write; duplicates are rejected by the unique key rather than re-sent.
create function private.queue_account_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    -- now() rather than new.created_at: the managed auth table is not guaranteed
    -- to expose that column to a custom definer, and the row is new here anyway.
    insert into private.notification_outbox(event_key, event_type, occurred_at)
    values ('account_created:' || new.id::text, 'account_created', now())
    on conflict (event_key) do nothing;
  exception when others then
    begin
      insert into private.notification_enqueue_failures(failure_day,event_type,failure_count)
      values (current_date,'account_created',1)
      on conflict (failure_day,event_type) do update
      set failure_count = private.notification_enqueue_failures.failure_count + 1,
          last_failure_at = now();
    exception when others then
      raise warning 'account notification enqueue failure; aggregate unavailable';
    end;
  end;
  return new;
end $$;
alter function private.queue_account_notification() owner to triggerboxd_writer;
revoke all on function private.queue_account_notification() from public, anon, authenticated, service_role;

create function private.queue_film_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into private.notification_outbox(event_key, event_type, occurred_at, film_title)
    values ('film_imported:' || new.id::text, 'film_imported', coalesce(new.created_at, now()), left(new.title, 300))
    on conflict (event_key) do nothing;
  exception when others then
    begin
      insert into private.notification_enqueue_failures(failure_day,event_type,failure_count)
      values (current_date,'film_imported',1)
      on conflict (failure_day,event_type) do update
      set failure_count = private.notification_enqueue_failures.failure_count + 1,
          last_failure_at = now();
    exception when others then
      raise warning 'film notification enqueue failure; aggregate unavailable';
    end;
  end;
  return new;
end $$;
alter function private.queue_film_notification() owner to triggerboxd_writer;
revoke all on function private.queue_film_notification() from public, anon, authenticated, service_role;

-- Fires for every new auth account, including ones created through the provider
-- outside the website UI. Existing accounts are never backfilled.
create trigger queue_account_notification after insert on auth.users
  for each row execute function private.queue_account_notification();
create trigger queue_film_notification after insert on public.movies
  for each row execute function private.queue_film_notification();

-- Delivery surface. Service role only: the dispatcher runs with the service key
-- and is additionally gated by a server-side shared secret at the HTTP edge.
create function private.notification_events(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'INVALID_REQUEST'; end if;
  -- A crashed sixth attempt has no acknowledgement. Retire it after the lease.
  update private.notification_outbox set status = 'failed', completed_at = now(),
    lease_token = null, lease_until = null, last_error_code = 'attempts_exhausted'
  where status = 'pending' and attempts >= 6 and next_attempt_at <= now()
    and (lease_until is null or lease_until <= now());
  with due as (
    select id from private.notification_outbox
    where status = 'pending' and attempts < 6 and next_attempt_at <= now()
      and (lease_until is null or lease_until <= now())
    order by occurred_at, id
    limit p_limit for update skip locked
  ), claimed as (
    update private.notification_outbox o
      set lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes',
          attempts = o.attempts + 1,
          -- A crash waits at least the lease and then bounded exponential backoff.
          next_attempt_at = now() + greatest(interval '2 minutes',
            (power(2, o.attempts)::text || ' minutes')::interval)
    from due where o.id = due.id
    returning o.id, o.lease_token, o.event_type, o.occurred_at, o.film_title, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'leaseToken', c.lease_token, 'eventType', c.event_type,
    'occurredAt', c.occurred_at, 'filmTitle', c.film_title, 'attempts', c.attempts)), '[]'::jsonb)
  into v_result from claimed c;
  return v_result;
end $$;
alter function private.notification_events(integer) owner to triggerboxd_writer;

create function private.record_notification_result(p_id uuid, p_lease_token uuid, p_outcome text, p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempts smallint;
begin
  if p_outcome not in ('sent','retry','failed') then raise exception 'INVALID_REQUEST'; end if;
  -- Stale workers cannot acknowledge a lease that expired or was reissued.
  select attempts into v_attempts from private.notification_outbox
    where id = p_id and lease_token = p_lease_token and lease_until > clock_timestamp()
      and status = 'pending' for update;
  if v_attempts is null then return false; end if;
  if p_outcome = 'sent' then
    update private.notification_outbox set status = 'sent', last_error_code = null,
      completed_at = now(), lease_token = null, lease_until = null where id = p_id;
  elsif p_outcome = 'failed' then
    update private.notification_outbox set status = 'failed', last_error_code = left(coalesce(p_error_code, 'terminal'), 40),
      completed_at = now(), lease_token = null, lease_until = null where id = p_id;
  else
    -- Attempt count was incremented atomically at claim, even if the sender crashed.
    if v_attempts >= 6 then
      update private.notification_outbox set status = 'failed', last_error_code = left(coalesce(p_error_code, 'retries_exhausted'), 40),
        completed_at = now(), lease_token = null, lease_until = null where id = p_id;
    else
      update private.notification_outbox set last_error_code = left(coalesce(p_error_code, 'retry'), 40),
        next_attempt_at = now() + (power(2, v_attempts - 1)::text || ' minutes')::interval,
        lease_token = null, lease_until = null where id = p_id;
    end if;
  end if;
  return true;
end $$;
alter function private.record_notification_result(uuid,uuid,text,text) owner to triggerboxd_writer;

-- Retention. Sent events and exhausted failures are removed after the window;
-- anything still pending or awaiting a retry is always preserved.
create function private.cleanup_notifications(p_keep_days integer default 30) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  if p_keep_days is null or p_keep_days < 1 or p_keep_days > 365 then raise exception 'INVALID_REQUEST'; end if;
  delete from private.notification_outbox
   where completed_at is not null and completed_at < now() - (p_keep_days::text || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
alter function private.cleanup_notifications(integer) owner to triggerboxd_writer;

revoke all on function private.notification_events(integer),
  private.record_notification_result(uuid,uuid,text,text), private.cleanup_notifications(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.notification_events(integer),
  private.record_notification_result(uuid,uuid,text,text), private.cleanup_notifications(integer) to service_role;

-- PostgREST only exposes the public schema, so the dispatcher reaches the queue
-- through invoker wrappers that are granted to the service role alone.
create function public.notification_events(p_limit integer) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select private.notification_events(p_limit)
$$;
create function public.record_notification_result(p_id uuid, p_lease_token uuid, p_outcome text, p_error_code text default null) returns boolean
language sql security invoker set search_path = '' as $$
  select private.record_notification_result(p_id, p_lease_token, p_outcome, p_error_code)
$$;
create function public.cleanup_notifications(p_keep_days integer default 30) returns integer
language sql security invoker set search_path = '' as $$
  select private.cleanup_notifications(p_keep_days)
$$;
revoke all on function public.notification_events(integer), public.record_notification_result(uuid,uuid,text,text),
  public.cleanup_notifications(integer) from public, anon, authenticated, service_role;
grant execute on function public.notification_events(integer), public.record_notification_result(uuid,uuid,text,text),
  public.cleanup_notifications(integer) to service_role;

-- Queue maintenance reuses the existing Triggerboxd cron conventions. The history
-- cleaner is extended to cover the new job rather than adding a competing one.
do $migration$
begin
if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
execute 'create extension if not exists pg_cron with schema pg_catalog';
execute 'select cron.schedule($1, $2, $3)'
using 'triggerboxd-notification-retention', '17 * * * *',
'select private.cleanup_notifications(30);';
execute 'select cron.schedule($1, $2, $3)'
using 'triggerboxd-expire-job-history', '23 3 * * *',
$job$delete from cron.job_run_details
where jobid in (select jobid from cron.job
where jobname in ('triggerboxd-expire-request-state', 'triggerboxd-expire-job-history', 'triggerboxd-notification-retention'))
and coalesce(end_time, start_time) < now() - interval '7 days';$job$;
end if;
end
$migration$;
commit;
