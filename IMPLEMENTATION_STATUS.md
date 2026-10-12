# MVP execution ledger

Latest update: Supabase and TMDb are configured locally. The initial schema is applied to the fresh owner-authorized project. Hosted API permissions, Google OAuth initiation and real movie search were verified; see SUPABASE_CONNECTION.md. A completed human Google login and authenticated import/contribution remain pending. Earlier setup-pending entries below describe the pre-connection implementation phase.

User authorized orchestration and implementation on 2026-10-12. No commits, push, cloud provisioning or deployment authorized.

## Scope rulings

- Implement structured contributions immediately, with six Unknown-aware categories and the proposed tested median/dispute policy. No moderator UI or public text notes in this milestone; no ads/revenue now.
- Google login enabled when configured. Email/password code is prepared behind `ENABLE_PASSWORD_AUTH`; keep disabled until custom SMTP and verification/recovery are ready. Display name is separate from login email.
- Runtime proof uses a scratch copy without creating branches/worktrees or modifying the deployed preview. Local code implementation is authorized; provider setup is not assumed.
- User confirmed Supabase/TMDb accounts are not yet created. Missing configuration must give an honest unavailable state, never fictional real results.
- Local API/database tasks may proceed alongside the runtime proof because they do not depend on deploying OpenNext. Final runtime adoption waits for proof.

## Work tracking

| Task | Owner | Current evidence |
| --- | --- | --- |
| T0 | Parent | Scope recorded; provider setup missing; TMDb public-use terms remain a launch gate |
| T1 | Sol runtime agent + parent | Guarded adapter patch integrated; original Next/OpenNext build passes; local Worker smoke 12/12 |
| T2/T5 | Sol database agent | Schema/RLS/RPC/aggregation implemented; 103 embedded PostgreSQL assertions; hosted services and simultaneous sessions unverified |
| T3 | Sol auth agent + parent | Google PKCE/gated email auth, refresh, CSRF, return paths implemented; local checks pass; provider flows unverified |
| T4 | Luna + parent integration | Server gateway and routes implemented; 9 TMDb focused tests pass; no live token |
| T6 | Sol UI agent + parent | Search/movie/structured edit-delete UI, public existing guides and account-bound drafts implemented |
| T7 | Deferred | No moderator workflow shipped |
| T8/T9 | Parent | Privacy/contact/SEO integrated; final local checks underway; accounts, approved attribution logo, independent review, Linux/staging CPU and physical devices remain release gates |

Baseline existing Next production build and typecheck passed. HTTP boundary tests 4/4 passed. Pinned Supabase dependencies installed with zero reported npm vulnerabilities at install. Live provider, physical-device and staging CPU checks are not yet possible.

Preserved existing uncommitted privacy change. Final evidence and exact remaining setup will be appended here; these intermediate counts are not the final suite result.

## Integration review findings and fixes

- Next dev normalized the Request URL's loopback hostname, incorrectly rejecting valid CSRF requests. Regression reproduced, then fixed with a development-only loopback Host rule; trusted APP_ORIGIN is explicitly configured for eventual production.
- Independent auth-session fetches could issue mismatched initial CSRF cookies. Components now share a deduplicated refresh helper; a concurrent-read regression passes.
- Explicit adult search results are filtered even if upstream filtering fails; a details response with the wrong movie ID is rejected. These checks have focused tests.
- RPC envelopes, verified-email field, nullable language, safe revision types, full-replacement semantics and private cache headers were aligned across schema, HTTP and UI.
- Automatic metadata refresh on anonymous read is deferred; authenticated selected import refreshes metadata. Warning reads never require TMDb. This avoids unapproved retention/refresh policy and extra launch cost; it changes the original seven-day-on-read proposal deliberately.

Parent inspected actual RLS/grants, private function ownership, actor locking, idempotency, current-account checks, token cookie handling, redirects and public projections. Astra's independent review hit a usage limit before returning findings; it is not recorded as a passed review. The schema agent's files/tests were delivered before its final turn hit the same limit.

Final integrated bundle: 5,944.94 KiB raw / 1,223.85 KiB gzip, measured with Wrangler dry-run (nothing uploaded). Current provider limit wording is documented in RUNTIME_PROOF.md; the old 3 MiB claim in the planning document is historical. Free-tier deployed invocation CPU has not been measured.

## Final local result

Typecheck passed; 35 application/contract/UI tests passed; 103 embedded database assertions passed; 12 HTTP smoke checks passed against the final rebuilt local Worker. Next production and OpenNext builds passed. Git whitespace check passed. Phone-sized 320/390px and desktop 1280px search/sign-in checks found no horizontal overflow; keyboard focus and honest setup-pending behavior were verified. See QA_REPORT.md for the distinction between fixtures, browser checks and unverified provider/device behavior.

Local implementation is ready for provider configuration, not a public production release. The Next development server remains available at http://127.0.0.1:4327/ for review. Temporary Worker test server was stopped after verification. No commit, push or deployment occurred. Next dev generated AGENTS.md; it was read and retained. Existing Cloudflare privacy correction remains in the updated notice.
