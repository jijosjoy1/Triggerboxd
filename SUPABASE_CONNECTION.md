# Supabase connection verified — 2026-10-12

TMDb follow-up: the read access token is now stored in ignored .env.local. Real local search returns HTTP 200 and Kumbalangi Nights (2019, Malayalam); the result and selection/sign-in action were verified in the browser. Twelve local HTTP checks pass in live-search mode. The initial 503 was the development server's sandboxed network access; restarting that local-only server with authorized provider access resolved it without application-code changes. No movies or assessments were seeded/imported by the search test. Completing human Google login and authenticated import/contribution remains pending.

Owner explicitly authorized using the supplied credentials for Triggerboxd. They were saved only in ignored .env.local. The database password and Google client secret were not needed by the local app and were not stored there. No secret values appear in this report.

Project: xoqwphilrzcwgbwfmwtr, name Triggerboxd, Mumbai region, healthy PostgreSQL 17 project. Inspection found no existing public/private app tables/functions/roles and zero auth users before the migration. No other app data was replaced.

Applied launch_schema through the Supabase connector. Remote migration version is 20261012113831; the local migration filename was aligned to that version so a future CLI push does not try to apply the initial schema twice.

Verified on the actual hosted project:

- Six warning categories, zero movies/users, RLS enabled on all app tables.
- Public summary RPC works through the real Data API; a missing movie returns null.
- Anonymous raw contribution reads are denied.
- Server credential works with Auth administration (read-only verification).
- Google provider is enabled in public Auth settings.
- Local session endpoint returns configured=true, Google enabled, email/password disabled.
- Local Google-start endpoint returns 200 with the correct project and local callback.
- Supabase forwards the OAuth request to accounts.google.com with HTTP 302.
- Actual browser shows an enabled Continue with Google button.
- Local embedded database regression suite still passes 103 assertions after filename alignment.
- Twelve local HTTP smoke checks pass with the hosted Supabase configuration; the smoke suite now supports both configured and unconfigured Google initiation without completing a login.

Security advisor returned no warning/error findings and one INFO notice: private.operator_actions has RLS without a policy. This is deliberate: application roles must have no access; owner administration uses a restricted administrative procedure. Do not add a permissive policy to silence it. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Latest browser verification (2026-10-12): Google login completed, authenticated Kumbalangi Nights import succeeded, all six categories displayed Unknown, and the signed-in contribution form loaded without errors. The hosted Auth schema rejected custom-role USAGE grants; approved private identity bridges restore existing checks without granting public access. Hosted bridge execute permissions are denied to anon/authenticated and allowed only to the internal writer. Migration versions match remote history. Local database suite: 108 assertions pass, including simulated missing Auth schema access. No fabricated film assessments were published. Publishing/editing/deleting with the owner's actual ratings and simultaneous-user operations remain unverified.

After rotating credentials, replace Supabase keys in .env.local and update a rotated Google client secret in Supabase's Google provider settings. Reload/restart the local app as needed. Never commit .env.local. Cloudflare deployment/runtime secrets remain a separate step; nothing was deployed or pushed.

## Production Google sign-in fix — 2026-10-13

Root cause verified in Supabase dashboard: Site URL was malformed (`http://lohttp://127.0.0.1:4327`) and the redirect allowlist contained only the local callback. Production Google authentication completed at the provider but fell back to this invalid Site URL.

Corrected hosted Site URL to `https://triggerboxd.com`; added the narrowly scoped production callback `https://triggerboxd.com/auth/callback/**`; preserved the local callback. No frontend, database schema, provider credentials or deployed Worker changes were necessary.

Live browser verification: Google sign-in completed and returned to `/search/`; Sign out appeared, survived page reload, and authenticated warning/family contribution controls appeared on Kumbalangi Nights. No console errors. No assessments were submitted during this check. Physical mobile authentication remains unverified.
