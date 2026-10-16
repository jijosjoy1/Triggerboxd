# Triggerboxd Thinks pilot

Admin searches the imported movie catalogue, queues one analysis per film,
reviews the experimental dialogue score against their independent viewing, and
approves, adjusts with a reason, or rejects. The first successful decision closes
the current revision. Reopening requires a reason and immediately withdraws the
public estimate. Community ratings and submissions are never changed.

## Deployment order

1. Review and apply `20261016165452_subtitle_estimates.sql` through the normal
   database deployment process. The local embedded database tests cover this
   migration; production has not been modified by its creation.
2. Deploy the app. Existing admin owners get the new tab; this pilot does not
   grant new accounts moderator access. Requests are limited to imported films.
3. Store a dedicated random `TRIGGERBOXD_PIPELINE_TOKEN` of at least 32 characters
   as a Worker secret and in the worker's protected environment file. Keep the
   Supabase service secret on the app server only.
4. Inspect the GCP VM before installing the separate non-root service. Follow
   `pipeline/deploy/README.md`. Do not restart or reconfigure Keralamemeverse.
5. Queue one film, run one worker job, inspect counts, approve, verify the public
   projection, and reopen to verify withdrawal. Only then enable polling.

## Contracts and bounds

- `GET/POST /api/v1/admin/subtitle-jobs/`: existing authenticated session,
  CSRF protection on mutations, private owner allowlist enforced in SQL.
- `POST /api/internal/subtitle-jobs/`: dedicated bearer credential; claim,
  complete and fail only. It cannot approve or publish.
- `GET /api/v1/movies/:id/subtitle-estimate/`: approved published-movie result
  only, read independently of the main guide. Missing result renders nothing.
- One queue row per film, English only in this pilot. Different cuts need human
  verification; alternate-edition support is not implemented.
- At most 100 queued/processing jobs and 20 new requests per owner per hour.
  Admin lists show the latest 25 jobs; search returns up to 15 imported films.
- One global active worker lease; 30-minute expiry; at most three attempts.
  Provider errors retry after 15 minutes. Quota exhaustion defers to the next UTC
  day. Missing subtitles and exhausted retries require deliberate reopening.
- No subtitle text, private quotes, URLs, credentials, or local filenames are
  accepted remotely. Stored results contain bounded cue counts, language,
  subtitle hash, rule/scorer versions and proposed rating. Public results omit
  hashes, counts, reviewer identity and review notes.
- Worker cache: seven days, at most 100 files of up to 1 MB each. Existing manual
  subtitles are reused and never deleted by worker cleanup. SQLite quota counts
  only apply to runners sharing the same state file.

## Scoring limitations

The scoring weights remain uncalibrated. Do not describe match-count confidence
as measured accuracy. UI uses “Experimental”; rating approval requires a
moderator's watched confirmation. The script evaluates dialogue, not visuals;
gore/nudity/intimacy require independent review. An assault reference does not
prove depiction. Threshold calibration and a separate SDH signal analysis remain
future work. No inference model is called by this worker.
