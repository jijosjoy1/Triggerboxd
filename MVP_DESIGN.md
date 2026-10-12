# Triggerboxd first working MVP

Status: local implementation authorized by the later user instruction; provider setup and public release checks remain pending. Originally prepared as a proposal.
Execution update: the user subsequently authorized orchestration/implementation on 2026-10-12. The launch amendment governs scope; see IMPLEMENTATION_STATUS.md for actual evidence and remaining provider/release gates. This document's original planning restrictions describe its creation, not a continuing prohibition on the now-authorized local work.
Prepared: 2026-10-12. Repository: jijosjoy1/Triggerboxd.

## Updated launch scope — user direction, 2026-10-12

This section supersedes conflicting initial proposals below. The detailed moderation design remains future reference, not a launch requirement.

- Confirmed: Google login, no ads or revenue now, normal contribution flow; dedicated moderators and moderation UI come later.
- Proposed addition from the user's “maybe username password”: email/password signup and login, with a display name. A username is not an authentication identifier in this plan. True username/password login requires a separate decision; do not expose an email-lookup endpoint or invent fake emails.
- Launch flow: search → choose movie → read warnings → sign in with Google or verified email/password → confirm watched → select category severities → publish immediately → edit/delete own contribution. No moderator approval step for structured votes. Unknown/disagreement/count rules remain as proposed, not newly approved by this clarification.
- Defer optional free-text notes, in-app reports, moderator roles/UI/APIs and their tables/functions until the moderation milestone. Launch contribution payload has ratings and watched confirmation only; reject a supplied note field. Public movie response omits approvedNotes. This notes deferral is a recommended scope interpretation, not an explicit user request.
- Retain account status, contribution visibility, owner-only emergency removal, secure access policies, rate limits and contact-based abuse/deletion handling. No full moderation system required. A manual owner procedure must verify identity, record minimal restricted action history and refresh affected results; no public admin endpoint or self-assigned privileges.
- No advertising, affiliate links, subscriptions or payments at launch. This records current intent, not a legal conclusion about TMDb licensing. Confirm applicable terms before public API use and reassess if the business model changes.

### Email/password requirements

Use Supabase Auth for password storage and verification; no application password table. Include signup, email confirmation, sign-in, sign-out and forgot/reset-password flows. Require confirmed email before contribution. Keep reset responses generic to avoid account enumeration; validate callback destinations and enforce provider rate limits. Test expired/reused confirmation/reset links and same-email Google/password identities with Supabase's supported identity handling; never manually merge accounts on an unverified email match.

Custom SMTP and verified sender delivery are a production prerequisite for password signup/reset. Receiving mail at info@triggerboxd.com does not establish outbound SMTP. Select an available free-tier sender only after checking its actual limits and domain verification; no paid signup authorized. If SMTP is unavailable, return to the user before enabling password signup; Google can remain independently usable. Source checked through Context7: [Supabase password auth](https://supabase.com/docs/guides/auth/passwords), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Remaining approvals: email/password versus actual username login; proposed note deferral and warning aggregation rules; privacy/retention choices; runtime free-tier gate and provider setup. Naming moderators and building T7 are no longer launch gates. Planning-only boundary remains in effect.

## 1. Inspected baseline

Local checkout: `C:\Users\jijos\Documents\Codex\Triggerboxd`, branch `main`. Existing uncommitted `src/app/privacy/page.tsx` change updates hosting disclosures; preserve it.

Read README.md, package/config files, contribution demo, demo metadata, sitemap and site configuration. No repository/ancestor AGENTS.md was found during inspection; supplied Context7 instructions apply. DESIGN.md and CLOUDFLARE_PLAN.md are missing. The previously supplied product architecture text is background, not an approved implementation contract.

Installed manifest pins Next.js 16.4.0, React 19.3.0 and TypeScript. Current `output: 'export'` produces `out/`. No database/auth/backend exists. Fictional demo submissions are memory-only. Preserve this explicitly labelled demo separately from real submissions.

Repository Wrangler name is `triggerboxd-preview`; earlier deployment context identifies `lingering-king-c5c0`. Live infrastructure was not re-inspected during planning. Reconcile this discrepancy before any deployment; never assume a deploy command targets the live site.

## 2. Product scope

Anonymous visitors search movie metadata and read category warnings. Authenticated users submit or edit their own assessments after confirming they watched the film. Moderators review notes, reports and abuse. Initial editorial coverage is Indian cinema; search remains worldwide so diaspora/co-productions are not incorrectly excluded. Country/language are discovery facets, not proof a movie is Indian. TMDb `region=IN` is not a production-country filter.

Keep current dark cinematic identity. Search shows title, original title, year, language and poster; synopsis stays collapsed. Movie page puts warnings before plot. Show Unknown, contributor count, provisional status and disagreement prominently. Do not describe ratings as verified or guarantee a film is safe. Six categories: nudity, sexual content, sexual violence, gore/graphic violence, disturbing content, suicide/self-harm.

Out: AI-generated warnings, scraped warnings, payments, advertising, profiles, social feeds, reputation weighting, realtime updates, TV episodes, variant-specific ratings, poster-based sharing generator and automatic moderation. Different cuts can differ; disclose this limitation and accept reports. Do not import preview sample ratings into real films.

## 3. Architecture and free-cost gate

Preferred: existing Next App Router plus server Route Handlers on Cloudflare Workers through OpenNext; Supabase Auth/Postgres; HTTPS fetch for TMDb and Supabase. No separate Java service, ORM or paid image pipeline. Use only necessary Supabase JS/SSR and OpenNext/Wrangler dependencies with a lockfile.

Static export cannot serve request-dependent cookies or POST handlers. Future migration removes `output: 'export'`, keeps public marketing pages prerenderable, introduces OpenNext output/assets, and pins a tested adapter/compatibility date. Use the Next Node runtime supported by OpenNext; do not substitute Next Edge runtime. Avoid dependence on unsupported Node middleware/proxy features: authorize inside every protected handler and server data function. Prove session refresh on actual adapter output.

OpenNext currently documents Next 16 support, but this is not proof this checkout's exact dependency combination works. Compatibility spike must test Next 16.4.0/React 19.3.0, SSR cookies, callback redirects, Route Handlers, fetch, static assets, bundle size and runtime CPU. Use Linux CI/WSL for adapter verification because Windows support is qualified. Do not upgrade/downgrade silently.

Free plan is a constraint, not a guarantee. Cloudflare documents 100,000 daily Worker requests, 10 ms CPU and 3 MiB compressed Worker size for Free; recheck at implementation. Supabase Free has quotas, inactivity pausing and backup limitations. No paid plan, card-dependent product or automatic upgrade without approval. Avoid R2/ISR/image services unless demonstrably necessary and approved. Never keep a free DB awake artificially.

If OpenNext exceeds free CPU/size, recommend keeping the static Next shell and adding a small same-origin Worker API using the same contracts. This sacrifices request-rendered movie SEO and changes auth integration; present the measured tradeoff for approval before switching. It is a fallback, not work to build in parallel.

Rollout later: local tests → isolated staging with explicit permission → measured quota/runtime checks → human acceptance → separately authorized production switch. Preserve last static artifact and Worker version for rollback. DB migrations must be additive initially; rollback UI without deleting contributions. No infrastructure changes during this planning task.

## 4. Proposed data model

All timestamps UTC timestamptz. Internal UUID identifiers; movie TMDb ID positive bigint UNIQUE. No email in public profiles. Use migrations, foreign keys, CHECK constraints, indexed authorization keys and explicit grants. Enable RLS on exposed tables; private tables stay in an unexposed schema.

| Table | Key fields and invariants |
| --- | --- |
| profiles | user_id PK → auth.users, display_name 1–60 chars, created_at; no role/status editable here |
| private.user_access | user_id PK, role contributor/moderator, status active/suspended, changed_at; privileged administration only |
| movies | id UUID PK, tmdb_id UNIQUE, title, original_title, release_date nullable, original_language, production_countries, poster_path nullable, synopsis nullable, metadata_fetched_at, visibility published/hidden, created_at; no warning values from TMDb |
| warning_categories | stable slug PK, label, guidance, sort_order; six seeded rows, server-controlled |
| contributions | id PK, user_id FK, movie_id FK, UNIQUE(user_id,movie_id), revision >=1, watched boolean, visibility active/hidden, created_at, updated_at |
| category_ratings | contribution_id + category_slug composite PK, severity smallint CHECK 0..3; unanswered category has NO row |
| contribution_notes | contribution_id PK, body plain text <=500 chars, version, state pending/approved/rejected, reviewed_by nullable, reviewed_at; edited text always returns to pending |
| reports | id PK, reporter_id, contribution_id FK, reason enum spoiler/abuse/inaccurate/other, detail <=500 chars, state open/resolved/dismissed, created_at; partial UNIQUE(reporter_id,contribution_id) WHERE open |
| moderation_actions | id PK, moderator_id, target_type/id, action, reason, timestamp, previous/new state; append-only, private, no unnecessary copy of note text |
| private.request_buckets | action + subject_hash + window PK, count, expires_at; transactional quotas, expire after 48h |
| private.idempotency_keys | actor + operation + key UNIQUE, body_hash, response, expires_at; 24h retention |

Index movie title/TMDb lookup, contributions(movie_id,visibility), category_ratings(category_slug,contribution_id), pending notes(state,updated_at), reports(state,created_at), and all FK/user ownership columns. Bound display strings; escape text in UI, no HTML/Markdown notes. Movie deletion restricted while contributions exist; hide instead. Account deletion removes ratings/notes/profile and updates public results; retained moderation records redact user references. Propose 90-day report/audit retention followed by redaction/deletion, subject to owner approval and published policy.

Start with on-demand aggregation of indexed eligible rows rather than a second mutable aggregate cache. A single DB read returns all six categories from one snapshot; avoid one query per category. No aggregate table can drift. If measured query cost later requires materialization, add transactional recomputation and versioned invalidation as a separate reviewed change.

## 5. Auth, RLS and transaction boundary

Recommend Google-only OAuth through Supabase initially. Anonymous browsing; login only for contribution/report/moderation. Set exact local/staging/production callback allowlists; reject external `next` destinations. PKCE callback exchanges code; validate JWT signature/expiry with supported server claims validation, never trust `getSession()` alone as authorization. Check current DB account status/role on every mutation so bans and moderator removal work without waiting for JWT expiry.

Use `@supabase/ssr` cookie handling appropriate to the pinned version; propagate refresh cookies. Auth responses and all personalized endpoints are `private, no-store`; never cache Set-Cookie responses. Same-origin mutations require JSON, Origin validation and CSRF token; OAuth relies on the provider/library state/PKCE flow. No credentialed wildcard CORS.

Drafts: only a movie ID, six selections and optional note in sessionStorage to survive OAuth, expiring in 30 minutes. Clear on submit, explicit discard, logout and account switch. Tell users this is temporary device storage. Never store tokens in draft storage. Storage disabled: explain draft may be lost before redirect. This changes the real-flow privacy disclosure; fictional demo stays memory-only.

| Data/action | Anonymous | Signed-in owner | Moderator |
| --- | --- | --- | --- |
| Published movies/categories/public aggregates | Read | Read | Read |
| Contributions, ratings, pending/rejected notes | No raw access | Read own only | Review through authorized function |
| Public approved notes | Safe projection only | Same | Same |
| Contribution write | Deny | Controlled RPC, own actor | No editing someone else's assessment |
| Report | Deny | Create/read own; no other reporter data | Read/resolve |
| Roles, user status, movies, moderation audit | Deny writes | Deny writes | Narrow moderation RPC; role assignment remains operator-only |

Do not expose a view that silently bypasses RLS. Use safe explicit public projections (no auth UUID/email/reporter identity) and invoker views where practical. Public notes expose opaque contribution ID for reports, text and date; public contributor names are unnecessary in this MVP.

Revoke direct INSERT/UPDATE/DELETE to protected tables for anon/authenticated; ownership RLS on reads. Grant EXECUTE only on intended RPCs. Because writes must atomically enforce quotas, revisions and note review state, narrow SECURITY DEFINER functions may be necessary: fixed empty search_path, fully-qualified names, no dynamic SQL, explicit auth.uid()/active-status/role checks, least-privileged owner, default PUBLIC EXECUTE revoked. Do not grant generic functions arbitrary target-user access. Test the direct Supabase Data API as well as Next endpoints; hiding APIs is not authorization.

Contribution RPC: infer actor from JWT, lock actor/movie transaction key, check expected revision, validate category set/severities, consume quota, upsert contribution, replace supplied full rating set, update note/review state, commit once. A failing category rolls back everything. No user_id, visibility, approval or role accepted from payload. DELETE uses the same locking/revision rules. Moderation locks target, verifies moderator/expected revision, changes state and inserts audit in one transaction. Same lock ordering prevents submission/hide races. User suspension excludes all that user's votes on subsequent aggregate reads.

TMDb import/rate-limiter privileged functions are server-only. Any Supabase secret/service key is Worker-only and isolated to this gateway, never NEXT_PUBLIC. Normal user mutations use user's JWT, not a bypass key. Establish limits inside RPCs too, preventing direct-API rate-limit bypass.

## 6. Severity and aggregation (proposed policy)

| Value | Label | Meaning |
| --- | --- | --- |
| absent | Unknown | Not assessed; never inferred as None |
| 0 | None | Viewer explicitly reports no content in this category |
| 1 | Mild | Brief/indirect/non-graphic presence |
| 2 | Moderate | Clear, sustained or repeated presence, limited graphic detail |
| 3 | Severe | Explicit, graphic, prolonged or strongly distressing depiction |

Category guidance: nudity concerns exposed bodies, sexual content concerns sexual activity, sexual violence includes threats/coercion/assault, gore concerns injuries/blood detail, disturbing content covers intense distress outside the other categories, suicide/self-harm covers references through depictions. Do not conflate consensual content with assault, or None with an age suitability certificate. Publish category-specific examples without plot details. For sexual violence/self-harm, Mild means indirect references, Moderate non-graphic depiction, Severe explicit/prolonged depiction; labels describe presentation, not seriousness of real harm.

Eligible vote: one current category rating per active account/movie, active contribution and published movie. Hidden/deleted/suspended votes excluded; pending note does not withhold numeric vote. Equal weight; no reputation or moderator overriding a vote.

For each category, collect sorted values. n=0 → severity null/Unknown. Otherwise choose upper median (sorted index floor(n/2), zero-based); avoids fractional labels and resolves even splits toward caution. n=1–2 → provisional; n>=3 → community-reported, never verified. Return full four-bin distribution and distinct category contributor count. Movie count is distinct contributing people, not sum of category counts.

Disputed when n>=2 and there exist two severity groups at least two levels apart with each side containing >=ceil(n*0.25) votes. Implement by scanning cuts k=0,1: count(values<=k) and count(values>=k+2); both must meet threshold. Disputed and provisional can both be true. Show 'Reports differ' plus distribution; keep the upper median visible as a summary, not a definitive verdict.

Regression examples: []→Unknown; [0]→None/provisional; [0,3]→Severe/provisional/disputed; [0,1]→Mild/provisional/not disputed; [0,0,2,2]→Moderate/disputed; [0,0,0,0,3]→None/not disputed but severe vote remains visible in distribution. Reported extremes are never hidden by the UI. Editing to Unknown deletes that category row; omitting a category in full PUT means Unknown. Empty all categories requires DELETE rather than a misleading empty contribution. Rules/version should be recorded with tests and changed only deliberately.

## 7. TMDb boundary

Use server bearer credential and fixed upstream hosts. Search `/search/movie`, then fetch `/movie/{tmdbId}` only on selection/import. Search is anonymous, debounced 350 ms, query 2–100 characters, page 1–20; include_adult=false set by server. Return metadata DTOs, no warning guesses. Do not import every search result. Search result selection may open a read-only metadata preview without a DB write. Signed-in selection/import POST imports one validated movie; existing movie reads remain public.

Import accepts only tmdbId, fetches authoritative fields, rejects adult=true, uses UNIQUE(tmdb_id) upsert for concurrent selection and never overwrites warnings. Unknown production-country metadata does not auto-reject a film. Native title search supported. Imported movie returns six Unknown categories until genuine votes exist.

Timeout 5 seconds; at most one retry for eligible transient GET failure, honor 429 Retry-After, never tight-loop. Search cache proposed 5 minutes; movie metadata refresh after 7 days on access, with stale stored metadata returned if refresh fails. These TTLs are technical proposals contingent on TMDb storage terms. Limit cache keys and page depth; never store raw entire API payloads. Keep poster paths/approved CDN host only, provide original fallback artwork. Do not bulk copy posters or put TMDb artwork into generated social cards until rights confirmed.

API credentials/config needed later: TMDb read token; Supabase project URL/publishable key and server secret; Google OAuth client config; exact allowed site URLs. Never paste secrets into documents or commits. Approval of accounts/provisioning is separate.

## 8. API contract v1

Prefix `/api/v1`. JSON camelCase, UUID internal movie IDs, ISO timestamps. Success `{data: ..., meta?: ...}`; error `{error:{code,message,requestId,fields?}}`. No SQL/upstream secrets or stack traces. Body max 8 KiB; arrays max six unique categories. Cursor lists max 20 items (maximum 50 for moderator lists).

| Method/path | Request | Success |
| --- | --- | --- |
| GET /movies/search?q=&page= | normalized query/page | 200 results[{tmdbId,title,originalTitle,year,language,posterPath}],page,hasMore |
| POST /movies/import | {tmdbId}; auth + Idempotency-Key | 201 new or 200 existing {id,tmdbId} |
| GET /movies/:id | none | 200 public metadata + warnings[{category,severity:null\|0..3,count,distribution,provisional,disputed}],contributorCount,approvedNotes |
| GET /movies/:id/contribution | auth | 200 {contribution:null\|{revision,ratings,note,noteState}} |
| PUT /movies/:id/contribution | {expectedRevision:0 for new else current,watched:true,ratings:[{category,severity:0..3}],note:null\|string}; Idempotency-Key | 200 new revision + own contribution; read public summary again |
| DELETE /movies/:id/contribution | {expectedRevision}; auth | 204 |
| POST /reports | {contributionId,reason,detail?}; auth | 201 {id,state:"open"} |
| GET /moderation/queue?type=&cursor= | moderator, type notes/reports | 200 items,nextCursor |
| POST /moderation/actions | moderator {targetType,targetId,expectedRevision,action,reason}; Idempotency-Key | 200 new state |
| POST /account/delete | auth + recent provider reauthentication | 202 deletion requested; operator-supported audited completion for MVP |

Auth callback/logout use Supabase session endpoints; logout is POST. Moderation actions allowed: approve/reject note, hide/restore contribution, resolve/dismiss report, suspend/restore account. Account status gets a version for expectedRevision checks. Note approval must target note version, never approve text edited since review.

Errors: 400 INVALID_REQUEST, 401 AUTH_REQUIRED, 403 FORBIDDEN/ACCOUNT_SUSPENDED, 404 NOT_FOUND (also hidden movie), 409 REVISION_CONFLICT/REPORT_ALREADY_OPEN/IDEMPOTENCY_CONFLICT, 413 PAYLOAD_TOO_LARGE, 422 MOVIE_NOT_SUPPORTED/WATCH_CONFIRMATION_REQUIRED, 429 RATE_LIMITED with Retry-After, 502 UPSTREAM_ERROR, 503 SERVICE_UNAVAILABLE, 504 UPSTREAM_TIMEOUT. Same idempotency key/body replays result without duplicate quota/vote; different body returns 409. Concurrency losers reload latest revision, never silently overwrite.

Proposed quotas: search 30/min per daily salted IP hash; import 10/min and 100/day per user; contribution writes/deletes 10/min and 100/day per user; reports 5/hour and 20/day per user; moderation 60/min per moderator. Shared-IP limits can affect households: friendly retry. Atomic DB counters for mutations; public search limiter uses server-only counter RPC and fails closed when quota store unavailable. Do not claim process-memory counters work across isolates. Cache hits still count. IP hashes retained <=48h; salts/secrets not logged. Infrastructure flood protection still required; these quotas cannot guarantee zero cost under attack.

Public metadata-only search caching may be shared. Public warning summaries/notes initially no-store to avoid leaking newly hidden content; no authenticated data in shared caches. Moderation and contribution responses always no-store. Logs contain request ID, route, status and timing, not tokens, emails, notes or full searches.

## 9. Moderation and trust

Structured votes publish immediately with count/provisional/dispute labels. Optional notes remain private until approved. Edited approved notes disappear pending fresh review. Moderator queue shows exact version, spoiler flags, reason and action history. Reports alone do not auto-remove a vote; moderation examines abuse/inaccuracy rather than treating disagreement as wrongdoing. Notify submitter via in-app status; no email service in MVP.

Moderator cannot approve their own note or resolve a report on their own contribution; another moderator/operator must handle it. No self-assigned moderator roles from profile metadata. Restore is audited. Moderator suspension immediately denies new submissions and excludes votes without deleting evidence. Limit open beta if owner cannot review the queue; appoint a named responsible moderator before launch. Offer appeal/contact through info@triggerboxd.com and maintain takedown handling.

Deletion request requires account confirmation; operator removes auth account and owned content, redacts retained audit references and confirms completion. Publish a proposed 30-day completion target only once operationally accepted. Rate-limit deletion requests. No broad service-role deletion endpoint without dedicated security review.

## 10. Acceptance and operating limits

Search → import → all Unknown → OAuth → partial category contribution → public counts → edit/delete → report → moderator action must work end to end. Direct unauthorized database access must fail. Two users, concurrent edits, note-edit/approval race, suspended user, expired token, upstream failure and Supabase unavailable are mandatory tests.

Mobile 320/375/390 px plus tablet/desktop: no overflow, 44px targets where practical, visible keyboard focus, labelled severity radio groups, screen-reader Unknown/dispute messages, contrast >=4.5:1 normal text. No spoiler synopsis by default. Google redirect returns to same movie and restores valid draft only.

SEO: canonical `/movies/{internalId}/` stable across title changes. Real populated pages with >=3 distinct eligible contributors indexable; others noindex until useful. Search/auth/moderation/demo noindex; sitemap excludes them and hidden movies. Marketing pages preserved. Recalculate eligibility after vote removal. Social artwork stays original. Privacy must explain auth, contributions, moderation, draft storage, third-party hosting/provider logging, retention and deletion before launch.

Budget operations: review usage daily during beta; alert/act at 70% and 90% quotas where available, reduce search/import traffic and pause writes gracefully before limits. No guarantee provider alerts are available on Free. Keep encrypted manual DB export with restoration drill before public contributions; owner accepts free-tier recovery limitations. No health checks that repeatedly wake paused projects. Seed only watched-film contributions from real people; no fabricated coverage or traction.

## 11. Documentation checked

Context7 queried Next.js, Supabase and Cloudflare docs after resolving library IDs. Official sources checked 2026-10-12; recheck exact pinned versions during implementation:

- [Next static export](https://nextjs.org/docs/app/guides/static-exports): request-time backend requires runtime migration.
- [Supabase server-side auth](https://supabase.com/docs/guides/auth/server-side) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): validated auth and grants/RLS are separate controls.
- [OpenNext Cloudflare](https://opennext.js.org/cloudflare): support/runtime/Windows limits; exact build untested.
- [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) and [Supabase pricing](https://supabase.com/pricing): verify free-account quotas before launch.
- [TMDb search/details](https://developer.themoviedb.org/docs/search-and-query-for-details) and [FAQ](https://developer.themoviedb.org/docs/faq): metadata source, attribution and commercial licensing.
- [Supabase changelog](https://supabase.com/changelog): HTML fetched; markdown endpoint could not be read by web tool. No complete version-specific breaking-change audit was performed; required in runtime spike.

No code build, actual login, staging runtime, database tests or device tests were run for this documents-only task.

## 12. Decisions requiring user approval

1. **Scope/auth:** approve worldwide search with Indian editorial focus, movie-only, Google-only login and adult TMDb entries excluded. Broader auth/TV comes later.
2. **Warnings policy:** approve upper median, provisional n<3, exact 25% disagreement rule, immediate structured votes and premoderated notes. These are product decisions, not established safety standards.
3. **Launch budget/runtime:** approve $0 service-tier target and a compatibility spike; if OpenNext fails Free limits, return with measured static-shell/Worker fallback before any migration or paid plan.
4. **TMDb/business:** owner must state whether revenue is intended (ads/affiliate/subscriptions or other business use). Free access alone does not establish non-commercial eligibility. Confirm appropriate API license, retention/cache terms, poster use and attribution before public real-data launch. Use approved TMDb logo and required notice in About/Credits. No claim licensing has been cleared.
5. **Operations/privacy:** name moderator(s); approve proposed 90-day moderation retention, <=48h request hashes, temporary OAuth drafts and account-deletion process/target. Age eligibility and applicable privacy obligations need owner review before auth launch; no DOB collection proposed.
6. **Credentials/hosting:** confirm live Worker identity, Supabase region/project ownership and Google/TMDb credentials setup. Keep secrets outside chat/repo. No deployment until separately requested.

Approving this design is not permission to deploy, buy services, submit startup applications or fabricate content.
