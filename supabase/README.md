# Launch database boundary

Connection update: the owner later authorized applying this schema to the fresh Triggerboxd hosted project. Migration history and hosted read/denial checks are documented in ../SUPABASE_CONNECTION.md. Historical local-only statements below describe the initial implementation phase. Do not run the rollback test fixtures against this hosted project.

This folder implements the launch amendment in `MVP_DESIGN.md`. It contains no notes, reports, moderator roles or moderator API. Only metadata/categories and safe aggregate projections are public. Profiles, contributions and ratings can be read by their signed-in owner; direct writes are revoked. Private account state, quota buckets, idempotency responses and the manual operator action log are not available to browser roles.

The migration filename was generated with Supabase CLI 2.83.0 `migration new launch_schema`. No project was linked, provisioned or modified remotely. No database credentials are present here. Apply only to an explicitly authorized disposable Supabase environment before considering deployment.

## RPC interface

PostgREST arguments must use these exact `p_` names. All functions return JSON with camelCase fields, except the two `void` maintenance/quota RPCs.

| Function | Allowed role | Return |
| --- | --- | --- |
| `get_movie_summary(p_movie_id uuid)` | anon, authenticated | `MovieSummary` or SQL null for missing/hidden movie |
| `get_indexable_movies(p_limit integer = 500, p_offset integer = 0)` | anon, authenticated | `[{id,updatedAt}]`; limit 1–1000, offset 0–10000; only movies with >=3 eligible contributors |
| `get_my_account_status()` | authenticated | `{status:"active"\|"suspended",emailVerified:boolean,displayName:string}` |
| `get_my_contribution(p_movie_id uuid)` | authenticated | `{contribution:null\|{revision,watched:true,ratings:[{category,severity}]}}` |
| `put_contribution(p_movie_id uuid,p_expected_revision bigint,p_watched boolean,p_ratings jsonb,p_idempotency_key text)` | authenticated | Same own-contribution envelope, with the new revision |
| `delete_contribution(p_movie_id uuid,p_expected_revision bigint,p_idempotency_key text)` | authenticated | `{deleted:true}`; map to HTTP 204 |
| `import_movie(p_actor_id uuid,p_tmdb_id bigint,p_metadata jsonb,p_idempotency_key text)` | service_role only | `{id,tmdbId,created:boolean}`; map created=true to 201, existing to 200 |
| `consume_search_quota(p_subject_hash text)` | service_role only | void; subject must be 64 lowercase hex characters, a daily-salted hash computed on the server |
| `expire_request_state()` | service_role only | void; physically removes expired buckets and request keys |

The server-only import accepts authoritative metadata `{title,originalTitle,releaseDate,language,productionCountries,posterPath,synopsis}`. All keys are required; date, language, poster and synopsis may be null. A supplied language must match `[a-z]{2,3}`, country codes `[A-Z]{2}`, and poster must be a bounded path to an allowed image extension. Metadata must come from the fixed-host TMDb gateway, whose adult-content and upstream checks are separate requirements. A browser request may provide only the selected positive TMDb ID. The importer rechecks the actor's current active status and confirmed email in the same transaction; it never changes warning ratings or restores hidden movies. Import retry identity includes only the selected TMDb ID, since authoritative upstream metadata can change between retries.

The six slugs are `nudity`, `sexual_content`, `sexual_violence`, `gore_graphic_violence`, `disturbing_content`, `suicide_self_harm`. A rating severity is the integer 0–3. Omitted categories are Unknown: full PUT deletes previously assessed omitted categories. At least one assessment and watched=true are required; use DELETE to remove all. Extra rating fields, unknown/duplicate categories and coercible strings are rejected. HTTP validation additionally rejects all extra top-level keys, including `note:null`, with an 8 KiB streamed body limit required in the handler.

User writes infer `auth.uid()`; they never accept a user ID, role, visibility or approval value. Accounts must exist, be active, have `auth.users.email_confirmed_at` and not be Supabase anonymous users. Account-wide advisory locks serialize quotas, revision checks and idempotency. Each mutation uses a globally increasing safe-integer revision so deletion/recreation cannot reuse a stale revision; do not assume consecutive revisions or increment the previous value in a client. Quotas are 10/minute and 100/UTC day for contributions (PUT and DELETE combined) and imports; search is 30/minute per server hash. All-or-nothing transactions roll back quota changes on failure.

Request keys are 8–128 ASCII letters, digits, `_` or `-`, scoped by actor and operation. Same key and canonical body returns the saved response without consuming quota; a different body conflicts. PUT canonicalizes rating order; import identity is the TMDb ID. Keys expire logically after 24 hours. Buckets expire at their window start +48 hours. `expire_request_state()` must be run by a separately configured and verified maintenance job: physical retention is currently **unverified**, and a cleanup interval adds retention lag. Do not promise <=48-hour physical deletion until scheduling/expiry margins are configured and measured. No scheduler or paid service was provisioned.

SQL application errors use SQLSTATE `P0001` and these exact bounded message strings: `AUTH_REQUIRED`, `ACCOUNT_SUSPENDED`, `EMAIL_NOT_VERIFIED`, `INVALID_REQUEST`, `WATCH_CONFIRMATION_REQUIRED`, `NOT_FOUND`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `FORBIDDEN`, `RATE_LIMITED`. Map only known codes to safe HTTP messages. Unexpected database errors become a generic service failure; never return SQL text, constraints or stack traces. Quota windows are fixed, so an HTTP Retry-After of 60 seconds is safe for minute limits; a daily-limit response may require a later retry. Repeated throttled calls must not tight-loop.

## Security and operations

All exposed wrappers are SECURITY INVOKER. Necessary private definers have an empty search_path and belong to separate NOLOGIN, NOBYPASSRLS writer/reader roles. The writer has only required table/sequence privileges and select access to auth ID/email-confirmation/anonymous status; the aggregate reader has no write privileges or auth.users access. PUBLIC function execution and direct protected-table mutations are revoked. The private schema has USAGE for wrapper callers, but no table access; it **must remain absent from PostgREST's exposed schemas**. Do not grant schema CREATE, role membership, arbitrary SQL, table DML or internal quota/actor helper execution to anon/authenticated/service_role. Service-role use belongs exclusively in the server import/search/maintenance gateway. Normal user writes require their own JWT.

Aggregation uses one SQL statement/snapshot, indexed current eligible rows and six category rows. Active accounts, active contributions and published movies determine eligibility. Unknown is null/count 0; explicit zero is None. The upper median is sorted index floor(n/2); provisional applies to n=1–2. Dispute scans cuts 0 and 1: low <=k and high >=k+2 must each have >=ceil(n*0.25) votes. All four histogram bins remain visible. Unique movie count counts contributions/people once, irrespective of number of category ratings. There is no mutable score cache. Public summaries and indexable IDs must be served without a shared stale warning cache so suspension/hiding/deletion is reflected on the next read.

Manual owner support has no public administrative RPC. An authorized operator must verify the requested account/action outside the database, use a transaction, take the same `pg_advisory_xact_lock(hashtextextended(user_id::text,0))` as user mutation, update the targeted status/visibility and increment the relevant revision, then insert a minimal `private.operator_actions` row before commit. Lock account(s) before contribution/movie row locks consistently. Record a private case/operator reference and short reason, never tokens, email, credentials or content text. Restore only after an explicit owner review. Account deletion requires provider reauthentication/session revocation and an authorized Auth administration procedure; deleting auth.users cascades owned profiles, access, contributions/ratings and idempotency, and nulls retained action user references. Audit retention/redaction and account-deletion rehearsal remain owner-approved operational work. No manual action was performed here.

## Local evidence and remaining gates

Run using a separately installed, pinned PGlite 0.3.14 dependency; it does not alter this repository's package manifest:

```powershell
node supabase/tests/run.mjs C:/Users/jijos/Documents/Codex/triggerboxd-db-scratch/node_modules/@electric-sql/pglite/dist/index.js
node --test tests/contracts/validation.test.mjs
npm.cmd run typecheck
```

The embedded runner constructs fixture auth roles/table/uid(), applies the complete migration from scratch (including an account predating it), and runs `launch.sql` inside a rolled-back transaction. It tests actual PostgreSQL role grants/RLS/PLpgSQL rather than simulated JavaScript handlers. Add `--verbose` to list assertion names. The SQL suite is also runnable with psql against a **disposable** locally configured Supabase database, after creating the pre-migration account fixture and applying the migration. Never run test fixtures against production. Fixture movie titles and ratings exist only inside this rollback test; there is no real-data seed.

Verified locally: migration applies; 103 database assertions passed; 9 contract validation tests passed; repository typecheck passed. Coverage includes anon and users A/B, row ownership, direct mutation denials, privilege/actor spoof prevention, confirmed email and anonymous-auth denial, quotas and rollback, revision conflicts, idempotent retry/conflict, omission-as-Unknown replacement, hide/suspend/delete eligibility, six regression vectors, private service import checks, safe sitemap eligibility/pagination, expiry cleanup, and EXPLAIN confirming the eligibility index for a movie lookup with 5,000 unrelated contributions. The index check is a single indexed lookup, not proof of full aggregate/sitemap performance at production scale.

Not verified: the actual Supabase auth schema/GoTrue identity flows and provider confirmation links; PostgREST exposed-schema/grant integration and JWT signatures; hosted migration role/ownership behavior; simultaneous multi-session insert/edit/quota/import races; Supabase `db advisors`; local Supabase migration-history listing; upgrades from a prior deployed Triggerboxd database; physical retention scheduling; backup/restore, provider deletion and staging CPU/latency. No Docker/psql/local Supabase stack was available, and PGlite is one session rather than a complete Supabase service stack. These remain required disposable-staging checks, not implied passes. Supabase's current database minor-upgrade changelog was reviewed; this migration uses no ltree, btree_gist, pgcrypto legacy ciphers or custom selectivity operators affected by that notice.
