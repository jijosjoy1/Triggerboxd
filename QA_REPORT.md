# Local MVP verification — 2026-10-12

This is local evidence, not a production release approval. Supabase and TMDb accounts/credentials are not configured. No live Auth/REST service, cloud migration, commit, push or deployment was performed.

## Automated checks

- `npm run typecheck`: passed.
- `npm test`: 35 passed, 0 failed. Covers HTTP boundaries, quota subjects, auth/CSRF/redirects/cookie propagation, concurrent auth refresh, domain validation, TMDb errors/adult filtering/selected IDs, and React warning display.
- `npm run test:db`: 103 assertions passed in embedded PostgreSQL using fixture auth roles. Actual grants, RLS, PLpgSQL, aggregation, revisions, quotas and idempotency exercised. This does not verify GoTrue/PostgREST or simultaneous independent database sessions.
- `npm run build:worker`: Next production build and patched OpenNext build passed on Windows with exact original Next/React versions retained.
- `npm run test:smoke`: 12 setup-state HTTP checks passed against local workerd; includes public routes/assets, auth CSRF rejection, honest missing-config errors, empty guide noindex and 404.
- `git diff --check`: passed; Git reports ordinary LF/CRLF conversion notices.

Pinned OpenNext 1.20.9 requires a checked manifest compatibility patch documented in RUNTIME_PROOF.md. Install-time dependency audit reported zero vulnerabilities. Linux and deployed invocation CPU are not implied passes.

## Browser checks

Used the available in-app browser via CUA, at http://127.0.0.1:4327. Search → type film title → setup-pending result → sign-in → return to browsing was exercised. Google is disabled honestly while configuration is missing; no fake login or movie warnings were rendered.

Desktop 1280px and phone-sized 320/390px checks observed document width matching content width, no horizontal overflow, meaningful content and no framework error overlay. Keyboard Tab from the film field reached Search with visible focus. Search and sign-in screenshots were inspected. A prior smooth-scroll development warning was fixed with the documented html attribute; no relevant application console errors were observed. Browser rendering is not physical Android/iOS testing. Final bundle: 5,944.94 KiB raw / 1,223.85 KiB gzip; dry-run only, nothing uploaded.

React-render tests separately prove explicit None differs from five unanswered categories and that a severe outlier remains visible even under a None summary. These are fixtures inside tests, not seeded community data or a fully authenticated browser flow.

## Review and known limits

Parent reviewed the security/contracts boundary and fixed local-host CSRF rejection, duplicate initial CSRF-token requests, nullable-language/DTO mismatches and upstream selected-ID/adult-result handling. The scheduled Astra review hit a usage limit before producing findings; independent review remains pending.

Required next checks after provider setup: actual Google callback/session refresh; mail confirmation/recovery/expired links and same-email identities; hosted RLS/role ownership and advisors; concurrent two-user edits/import/quota tests; complete PC/mobile authenticated contribution flow; backup/restore and account-deletion rehearsal; physical retention scheduling; approved TMDb attribution logo/terms; Linux build; live Cloudflare CPU/free quotas and exact Worker/domain mapping.

No guarantee of deployed Free-tier fitness or production safety is made from these local results. The existing preview's uncommitted Cloudflare privacy correction was preserved in the updated privacy wording. The fictional demo remains separate and memory-only.
