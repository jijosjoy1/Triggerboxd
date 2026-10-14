# Triggerboxd MVP — local implementation

Indian movie-warning MVP using Next.js App Router, React, TypeScript, Supabase Auth/Postgres and server-side TMDb metadata. The existing fictional demo remains isolated and memory-only. No ads, payments, public text notes or moderator UI in this milestone.

## Current state

Local code and database tests are implemented. Supabase and TMDb credentials are configured locally; the launch schema is applied to the fresh Triggerboxd project. Google OAuth initiation and real film search are verified. Complete a human sign-in to verify the callback and authenticated contribution flow. See SUPABASE_CONNECTION.md. No commit, push or Cloudflare deployment was performed.

Read MVP_DESIGN.md, MVP_TASKS.md and IMPLEMENTATION_STATUS.md for scope, evidence and remaining release checks. RUNTIME_PROOF.md explains the required adapter compatibility patch.

## Local commands

Requires Node >=22; the native TypeScript tests were verified with Node 24.21.0.

```text
npm ci
npm run dev -- --port 4327
npm run typecheck
npm test
npm run test:db
npm run build:worker
npm run preview:worker
npm run test:smoke
```

Next dev: http://127.0.0.1:4327/ . Local Worker: http://127.0.0.1:4328/ . The smoke suite targets the unconfigured local Worker, not production; run it while preview:worker is running. To test the dev server instead, set MVP_BASE_URL to its origin.

The migration fixture/test database is disposable embedded PostgreSQL. It does not connect to Supabase or seed real catalogue data. See supabase/README.md for RPC contracts and tests. The real migration must be separately reviewed/applied to a disposable provider project before public release.

## Runtime migration

This now uses request-time Route Handlers and OpenNext rather than output:'export'. Marketing pages remain prerenderable, but out/ is no longer the deploy artifact. The Worker uses .open-next/worker.js and .open-next/assets.

OpenNext 1.20.9 is pinned. Next 16.4 loads preview-props.json, which the adapter's manifest glob omits. scripts/patch-opennext-preview-props.mjs applies a checked, exact-version patch on install/build. Review/remove it when upgrading the adapter. OpenNext 1.20.10 had the same omission and introduced an affected build-tool chain during inspection; do not upgrade blindly.

Windows build/local Worker verification passes. Linux build and Cloudflare invocation CPU remain unverified. Do not infer Free-tier production compatibility from a local build or wall-clock timings. No paid services are configured.

## Provider setup still needed

1. Create an owner-controlled Supabase Free project. Choose a region and retain access to its recovery/backup settings. Keep private absent from the Data API exposed schemas.
2. Review/apply supabase/migrations/20261012113831_launch_schema.sql to a fresh disposable project using its migration role. Verify actual hosted grants, ownership and RLS with two users, concurrent sessions, PostgREST and Auth; PGlite alone does not prove those services.
3. Configure Google in Supabase Auth. Google Cloud's Web OAuth client uses the Supabase callback URL copied from the Google provider page: https://<project-ref>.supabase.co/auth/v1/callback . The application's callback is different: /auth/callback/ . Set exact app site/redirect allowlists for local, staging and eventual production; never a production-wide wildcard. Provider docs: https://supabase.com/docs/guides/auth/social-login/auth-google . Keep any Google OAuth testing-user restrictions in mind during testing.
4. Obtain a TMDb read token and confirm applicable non-commercial terms, data retention, poster use and approved logo attribution. Current no-revenue intent is recorded; it is not a licensing clearance. The required TMDb notice is in About. Add an approved TMDb logo before real-data public launch; the official logo page could not be fetched by the documentation tool. Do not fabricate or redraw that logo.
5. Copy .env.example to an ignored .env.local for Next local development; fill actual values locally. No secrets in chat, commits or NEXT_PUBLIC variables. Set APP_ORIGIN to the exact local origin. For Worker local development, use an ignored .dev.vars file and matching build-time public identifiers; preview:worker overrides APP_ORIGIN to its local origin.
6. Google can be tested independently. Leave ENABLE_PASSWORD_AUTH=false until custom SMTP, sender-domain verification, confirmation and recovery deliveries are tested. Receiving mail at info@triggerboxd.com does not provide outbound SMTP. Email/password uses display names, not custom username authentication.
7. Test the full real flow: search → import → all Unknown → login → submit → second-user public summary → edit/delete. Then test bans, expired tokens, callback redirects, link expiry, upstream outages and account deletion.

Environment names:

- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: public project identifiers; supply the matching build/runtime values.
- SUPABASE_SECRET_KEY: server-only Supabase secret/service credential, restricted to the trusted import/quota boundary.
- TMDB_READ_ACCESS_TOKEN: server-only movie metadata credential.
- REQUEST_HASH_SECRET: server-only random secret at least 32 characters for daily-salted request identifiers.
- APP_ORIGIN: exact trusted origin, https://triggerboxd.com for eventual production.
- ENABLE_GOOGLE_AUTH: enabled unless explicitly false, after provider configuration.
- ENABLE_PASSWORD_AUTH: explicit true only after mail setup.

## Contribution and privacy rules

Six categories; Unknown is absent/null, never inferred None. One editable rating per user/movie/category. Upper median, provisional under three category assessments, visible distributions and the documented disagreement threshold. No scraped/generated warning seeds. TMDb is metadata only.

Authenticated mutations validate the current user and account status, confirmed email, CSRF/origin, bounded input, revisions, quotas and idempotency. The DB repeats ownership/verification/quota guards so direct RPC access cannot bypass them. Auth cookies are HttpOnly and private responses are not publicly cached.

Real contribution drafts use tab sessionStorage, expire after 30 minutes and are rejected/removed when checked after expiry. They clear on submit/discard/logout/account change. The fictional demo still stores its optional note only in memory and sends nothing.

## Owner operation / release gates

No public admin API. Use the restricted operator procedure in supabase/README.md for removal/suspension/restoration; verify the actor, use the documented lock/transaction and record a minimal private action. Contact/deletion support uses info@triggerboxd.com. Revoke provider sessions, delete the verified user's account through the authorized admin procedure, and verify ratings/profile removal and audit-reference redaction in a disposable rehearsal first.

The pg_cron migration schedules `public.expire_request_state()` hourly when pg_cron is available; only the service role and database owner can invoke it. Request quota records expire after 48 hours and idempotency records after 24 hours. Physical deletion normally follows at the next successful hourly run, so monitor the job after deployment. The Triggerboxd cleanup job also removes only its own job-run history older than seven days. Set retention/redaction for restricted support logs and prove backup/restore before accepting public contributions.

Marketing/demo/auth/search indexing differs: demo/auth/search are noindex. Movie pages become indexable at three eligible distinct contributors; hidden/empty/under-threshold pages are excluded. The initial sitemap lists up to 500 eligible movie guides; extend pagination before that limit is reached. Original Open Graph art is retained.

The repository Worker name triggerboxd-preview differs from the earlier live Worker lingering-king-c5c0. Reconcile the actual account/Worker/routes before any deployment. Keep the prior static deployment for rollback. Staging and production deployment each remain separate user-authorized actions.
