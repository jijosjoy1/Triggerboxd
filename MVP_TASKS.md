# Triggerboxd MVP implementation plan

Status: local implementation authorized and underway. Read MVP_DESIGN.md and IMPLEMENTATION_STATUS.md first. No commits or deployment authorized.
Execution update: user authorized orchestration and local implementation after this plan was saved. Follow the launch amendment; actual progress and blockers are in IMPLEMENTATION_STATUS.md. Commits/deployment still require separate authorization.

Goal: real movie search and community warnings with authenticated contribution and basic moderation, within a measured free-tier budget.
Architecture: Next App Router/OpenNext preferred, Supabase Auth/Postgres, server-only TMDb gateway. Runtime choice is gated by T1.
Model assignments below are proposed handoff owners, not active delegations. Use Sol for coupled security/code tasks, Luna for bounded UI/gateway tasks, Astra only at design/security gates to conserve context. Availability must be checked when handing off; no Terra dependency.

## Launch-scope amendment — 2026-10-12

Read the updated launch scope at the top of MVP_DESIGN.md first. It overrides conflicting task details below; moderation items are retained only as later-milestone references.

- T0: record Google plus proposed email/password, no current monetization and deferred moderators. No requirement to appoint moderators before this smaller launch. Owner handles contact-based support/removal.
- T2: implement profiles, account active/suspended status, movies, categories, contributions, ratings, quotas and idempotency. Defer notes/reports/moderator role and moderation RPC migrations. Keep ownership, visibility and anti-escalation tests; use a narrow private owner action log for manual removal. Do not implement future schema just because it appears in the original task.
- T3: add email/password signup, confirmation, sign-in, forgot/reset-password and verified-email contribution enforcement. Use display name separately, not username login. Add confirmation/reset routes and generic recovery responses. Verify free SMTP sending/domain configuration before enabling public signup; no paid service authorized. Test expired/reused links, unconfirmed users, delivery failures, and Google/email identity interactions without unsafe account merging.
- T5/T6: structured ratings publish immediately. No notes input or note field accepted in the API; no approvedNotes response. Verify search → login → submit → public result → edit/delete without a review stage. Keep unknown/dispute labels and actual counts.
- T7: DEFERRED in full. Do not create moderation pages, queue/report APIs or moderator workflows in the first launch. Manual owner support/removal and account deletion runbook belong in T9.
- T8 dependencies become T0,T6; describe only shipped data handling. No moderation retention claim for nonexistent notes/reports. Keep contact-based removal and deletion instructions accurate.
- T9 dependencies become T1–T6,T8. Remove report/approval-race/moderator tests from launch acceptance. Add real email confirmation/reset tests alongside Google, owner removal/result exclusion and deletion rehearsal. Security and free-runtime gates remain mandatory.

No implementation or provisioning performed by this amendment. The user's “maybe” password option remains a proposal until confirmed; it does not authorize a custom username auth system.

## Universal handoff instructions

Inspect current git status/AGENTS.md before each task; preserve the existing privacy edit and other work. Read these two documents and predecessor interfaces. Use Context7 for current APIs. No secrets in source/logs, no paid provisioning, no unrelated redesign. No commits/push/deployment without new explicit authorization. Ask when a design gate fails rather than silently widening scope. Report changed files, exact test commands/results and unverified behavior. Work sequentially where files overlap. For implementation, use the applicable executing-plans workflow; no automatic agents.

Each implementation task begins with a failing meaningful test, implements the smallest change, runs focused checks, then the existing typecheck/build. Add a minimal test runner only when needed; choose its pinned compatible version in T1. Do not install testing dependencies during planning.

## T0 — Decision and operational gate

Owner: user with Astra review. Dependencies: none.

- [ ] Record explicit answers to MVP_DESIGN section 12; secure licensing clarity before real-data public launch.
- [ ] Identify the moderator and account owner, free-tier constraints, real Cloudflare Worker mapping, provider callback domains and region.
- [ ] Verify missing DESIGN.md/CLOUDFLARE_PLAN.md are not elsewhere; these MVP docs become the approved contract only after approval.

Output: decision log appended to MVP_DESIGN.md; credentials referenced by variable names only. Acceptance: no unresolved decision silently treated as consent. No paid resources or deployments.

## T1 — Runtime proof and testing foundation

Owner: Sol. Dependencies: T0 scope/budget decisions.
Files: package.json/lock, next.config.ts, wrangler.jsonc, new open-next.config.ts, test configuration and .env.example.

- [ ] Verify current Next/React/adapter compatibility, Supabase SSR releases and relevant changelog changes using current docs.
- [ ] Prove one dynamic GET/POST and cookie round-trip in local OpenNext/workerd while preserving marketing routes/assets/404.
- [ ] Build on Linux/WSL or CI; measure compressed Worker output against 3 MiB Free gate. Document runtime flags and installed versions.
- [ ] Add test entry points for domain tests, database integration and browser tests without unnecessary framework duplication.
- [ ] Record local runtime limits versus facts requiring authorized staging (CPU/Google redirects/real secrets). No production deployment from this task.

Acceptance: `npm run typecheck`, `npm run build`, adapter build/preview smoke all pass; absence of paid-only bindings verified. Static export is removed only for the accepted runtime. Free CPU must later be measured in staging, not inferred from laptop timings. If a gate fails, return a concrete fallback proposal; do not build both architectures.

## T2 — Schema, grants and mutation security

Owner: Sol; Astra reviews security boundary once. Dependencies: T0 policy, T1 environment.
Files: new supabase/migrations/*, supabase/tests/*, src/lib/contracts.ts.

- [ ] Define contract DTOs matching design section 8 and six stable category slugs.
- [ ] Add tables/constraints/indexes/RLS/default grants and safe public projections from sections 4–5.
- [ ] Add contribution CRUD, reporting, moderation and quota RPCs with transaction locks, revision checks and controlled EXECUTE grants. No public generic write RPC.
- [ ] Test using actual anon/user-A/user-B/moderator roles, not just mocked handlers.

Acceptance: anonymous writes fail; A cannot edit/read B's private note; user cannot promote self, set note approved, bypass quotas by direct API or tamper actor IDs. Concurrent insert produces one contribution; stale revision returns conflict; invalid category rolls back all changes. Migrations apply cleanly and upgrades preserve data. Hidden notes never appear in public projections. Service keys absent from client bundle.

## T3 — Authentication and draft recovery

Owner: Sol. Dependencies: T1,T2.
Files: src/lib/supabase/{browser,server}.ts, src/lib/auth.ts, src/app/auth/callback/route.ts, logout route, login UI, draft helper.

- [ ] Implement Google PKCE login/session refresh, validated server identity and DB status checks.
- [ ] Implement same-origin/CSRF protection for mutations; exact callback/return-path validation.
- [ ] Preserve non-secret draft across OAuth with 30-minute sessionStorage expiry and documented cleanup.

Acceptance: anonymous reads work; expired/forged token rejected; suspended user rejected despite still-valid token; external redirect refused; logout clears draft/session. Disabled storage handled honestly. Test two different users and no auth responses in shared cache. Real Google callback remains unverified until provider configured and authorized staging tested.

## T4 — TMDb search and selected import

Owner: Luna for gateway implementation after contracts; Sol reviews secret/import boundary. Dependencies: T1,T2; import integration requires T3.
Files: src/lib/tmdb.ts, src/app/api/v1/movies/search/route.ts, movies/import/route.ts, focused gateway tests.

- [ ] Implement fixed-host server fetch, validated queries, pagination/adult exclusion, timeout/retry and bounded cache.
- [ ] Return search DTO without database imports; implement authenticated selected ID import using authoritative details.
- [ ] Add quota enforcement and standard upstream error mapping; never manufacture empty success on outage.

Acceptance: secrets never reach browser; search alone writes no movies; concurrent same TMDb ID imports one row; importing gives all Unknown; supplied fake metadata ignored. Unicode searches, absent poster, 429/timeout/404, blocked adult detail and stale metadata fallback covered. Licensing/storage gate recorded before production use.

## T5 — Warning aggregation and public movie contract

Owner: Sol. Dependencies: T2 and approved warning policy.
Files: DB public summary function, src/lib/warnings.ts for display mapping only, src/app/api/v1/movies/[id]/route.ts, domain/DB tests.

- [ ] Implement authoritative aggregation once in database; client must not calculate competing scores.
- [ ] Return six categories always, per-category counts/distribution, unique movie contributor count and eligible approved notes.
- [ ] Test every vector in design section 6 plus edits, deletions, hiding and user suspension.

Acceptance: [] is null/Unknown, explicit zero is None; [0,3] disputed/provisional with upper median Severe; [0,0,0,0,3] retains visible extreme distribution. Same user editing never increases contributor count. One snapshot supplies consistent counts; index use checked on realistic test fixture sizes. No cached removed notes.

## T6 — Real movie and contribution UI

Owner: Sol. Dependencies: T3,T4,T5.
Files: new src/app/search/page.tsx, src/app/movies/[id]/page.tsx, src/components/movie-search.tsx, movie-warnings.tsx, real-contribution.tsx; API contribution route.

- [ ] Reuse existing visual language, build search/select/movie states and accessible severity controls.
- [ ] Wire full PUT semantics and delete, watched confirmation, revision conflict, idempotent retry and pending-note status.
- [ ] Preserve fictional src/components/contribution.tsx flow as isolated demo; no real writes there.

Acceptance: login-return-submit-edit-delete works; unanswered categories stay Unknown; main plot stays collapsed. Browser offline/error state preserves draft without pretending submission succeeded. Check 320/375/390 px, tablet/desktop, keyboard and screen reader labels; no clipped text/overflow. Two-user summaries reflect actual persisted votes.

## T7 — Moderation and reports

Owner: Luna for UI; Sol owns authorization/RPC integration. Dependencies: T2,T3,T5,T6.
Files: src/app/moderation/page.tsx, moderation queue/actions routes, reports route, report dialog.

- [ ] Wire queue/action states and private contributor feedback; protect page and every API independently.
- [ ] Add approve/reject/hide/restore/suspend/report resolution with reason and exact version.
- [ ] Prevent self-review and add account deletion request/operator checklist.

Acceptance: direct URL/API non-moderator access denied; racing note edit cannot accidentally approve new text; repeated action is idempotent; hide/suspension removes vote from summary; restore returns it. Reporter identity private. Deleted account content removed; required audit redaction tested. No email service assumed.

## T8 — Privacy, SEO and licensing presentation

Owner: Luna; owner supplies legal/business decisions. Dependencies: T0,T6,T7.
Files: src/app/privacy/page.tsx, about/page.tsx, sitemap.ts, robots.ts, movie/search/auth metadata, attribution assets.

- [ ] Preserve/extend existing privacy edit with accurate real-flow handling, retention/deletion and draft disclosures.
- [ ] Add required approved TMDb attribution; preserve original social artwork and working contact link.
- [ ] Implement canonical IDs and conditional indexing with >=3 eligible contributors, noindex demo/search/auth/moderation, filtered sitemap.

Acceptance: hidden/empty/under-threshold movies excluded from sitemap; eligibility reverses after removal. No fake verification/coverage/partnership copy. No personal data in metadata. All public navigation links work; actual contact resolves to info@triggerboxd.com.

## T9 — Release evidence and cost gate

Owner: Sol; Astra one final security/policy review. Dependencies: T1–T8.
Files: tests/e2e/*, operational runbook, .env.example/README updates.

- [ ] Run full typecheck/build/domain/database/browser suites with exact pass/fail counts; scan built public assets for secrets.
- [ ] Exercise full two-user flow, direct-RLS attacks, concurrent edits/moderation, refresh/logout, upstream outages and recovery.
- [ ] With separate permission, measure staging cold/warm CPU, memory, Worker compressed size and quota usage. Verify real OAuth, live callback URLs, Android/iOS browser flows and apex/www redirects.
- [ ] Run encrypted backup/restore rehearsal, identify moderator coverage, confirm no paid services and produce launch/rollback checklist.

Acceptance: no unresolved high-risk auth/RLS defects; free limits demonstrably fit or fallback decision returned to owner. Exact Worker identity reconciled before deploy. State which checks were local/mocked/staging/physical-device; never substitute code inspection for device proof. Production deployment remains a separate approval.

## Review focus

Highest-risk cases are direct-RPC privilege bypass (T2), session refresh/cache leakage (T3), accidental None defaults (T5/T6), concurrent note approval (T7), and a framework build that passes locally but exceeds Worker Free CPU/size (T1/T9). Their acceptance tests are explicit above.

## Current planning validation

Repository and existing changes inspected; Context7/official docs consulted. These two documents are the only intended new files. No application, migration, dependencies, agents, builds, commits or deployments were performed by this planning task. Before implementation, request section 12 decisions and a separate instruction to begin.
