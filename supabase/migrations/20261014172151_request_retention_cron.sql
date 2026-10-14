-- Hosted Supabase provides pg_cron; embedded PGlite does not. The two named jobs
-- avoid affecting any other project's schedules or run history.
begin;
do $migration$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'select cron.schedule($1, $2, $3)'
      using 'triggerboxd-expire-request-state', '17 * * * *',
        'select public.expire_request_state();';
    execute 'select cron.schedule($1, $2, $3)'
      using 'triggerboxd-expire-job-history', '23 3 * * *',
        $job$delete from cron.job_run_details
          where jobid in (select jobid from cron.job
            where jobname in ('triggerboxd-expire-request-state', 'triggerboxd-expire-job-history'))
            and coalesce(end_time, start_time) < now() - interval '7 days';$job$;
  end if;
end
$migration$;
commit;
