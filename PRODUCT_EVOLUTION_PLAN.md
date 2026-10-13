# Triggerboxd product evolution execution plan

Status: orchestration and phased local implementation authorized, 2026-10-12. No new commit, push or deployment requested. Preserve existing attribution and architecture-document changes.

Spec: C:/Users/jijos/.codex/attachments/43712b49-79d8-4c7e-a736-f9da6c1a57eb/Pasted text.txt

## Ownership

Parent/Sol owns integration and evidence. Astra reviews data/spoiler security contracts. Luna owns isolated question definitions and verdict copy. Terra is not an available spawn model in this session; parent handles accessibility and QA rather than pretending to delegate to it.

## Existing architecture

Next.js Route Handlers and React movie components; Supabase Google Auth, PostgreSQL RLS and narrow RPCs; TMDb server gateway; Cloudflare/OpenNext deployment target. Reuse src/lib/contracts.ts, validation.ts, movie-api.ts, tmdb.ts, src/components/movie-warnings.tsx and real-contribution.tsx. Do not modify historical applied migrations. Existing category sort-order constraints and fixed category validators need additive migration and coordinated client/server changes.

## Product decisions

- Preserve all six historical warning categories and assessments, including suicide/self-harm and disturbing content.
- Content severity remains None/Mild/Moderate/Severe; unanswered is Unknown.
- Family awkwardness is an independent five-point subjective vote. Representation never contributes automatically.
- New legal/social category descriptors must not silently reinterpret existing numeric ratings.
- Serious victimisation uses factual copy. A descriptor such as animal death does not itself establish a numeric intensity; severity and descriptors are distinct.
- Spoiler-free transformations run server-side. Category-hidden contributions must not expose their identity, icon, severity, counts or derived verdict through public summaries, SSR, accessibility or sharing.
- Claims such as verified absence need an evidence policy; initial labels stay community reported/provisional.
- Comments require reporting and an actionable owner moderation path before publication.

## Phases and checks

### 0 — Contracts and isolated presentation groundwork

- [ ] Astra: review minimal additive schema and reveal contracts; record unresolved disclosure/aggregation rules.
- [x] Luna: implement deterministic signature-question catalog and tests, isolated from application state. src/lib/signature-questions.ts; tests/contracts/signature-questions.test.mjs. Ten focused tests pass.
- [ ] Parent: integrate findings and inspect regression checks.

Deliverable: eight question definitions, 5/3 grouping, safe Unknown and category-spoiler outputs, written schema/API plan. Catalog is groundwork, not a claim that UI/backend features are shipped.

### Astra review findings

1. Spoiler filtering must run inside both existing database summary RPCs. Anonymous clients can invoke these directly, so filtering solely in Next.js is insufficient.
2. Current put_contribution performs full replacement and deletes old category rows. Add an atomic single-category upsert RPC for quick submissions; preserve existing revision/idempotency/account checks. Do not silently erase other assessments.
3. Append animal_harm, drugs, alcohol, language and physical_violence while retaining all six historical slugs.
4. Display family scale 1–5; if storage uses 0–4, validate and explicitly translate at one boundary.
5. Proposed conservative effective spoiler level is the maximum across eligible active reports. Level 2 hides spoiler-sensitive descriptors as well as prose; Level 3 hides aggregates and counts. This may permit malicious over-hiding, so add reports/owner correction and avoid shipping unrestricted sensitive writes before that path exists.
6. Fixed question positions can identify a hidden category even with generic text. Treat hidden and unassessed public rows uniformly, use a universal reveal control without hidden-category counts, and validate output-difference leaks. The isolated catalog alone is not a complete server spoiler policy.
7. Family votes remain independent. Whether to suppress them on category-sensitive films to prevent indirect leaks is unresolved; test concrete examples before finalizing policy.
8. Upgrade summary RPC filtering atomically before accepting spoiler-marked writes. Legacy endpoints must not retain a raw escape path.

Verified baseline plus catalog: 47 application tests, 108 embedded PostgreSQL assertions and typecheck pass. No public UI integration or hosted migration was performed in Phase 0.

### 1 — Data and spoiler foundation

Implementation milestone (2026-10-12): additive migration 20261012162814_product_foundation.sql and routes PATCH warnings, POST reveal, GET/PUT family-vote prepared. Eleven categories retain the historical six. Descriptor/representation schemas added; representation writing remains deferred. Atomic single-category patch, protected family votes, filtered SQL summaries/reveals and safe sitemap are implemented. Legacy form updates preserve new-category assessments and retained metadata; contradictory None updates are rejected.

Checks: 53 application tests, 146 embedded database assertions, historical migration preservation check, typecheck and production build pass. Hosted migration and authenticated browser verification remain pending. The old UI has not yet been replaced. Synopsis is withheld from default summaries; restoring its explicit reveal action is Phase 2 work. Family aggregates are withheld globally pending disclosure-policy review. Comments, timeline, representation mutation, expanded demographic descriptors and owner-reporting UI are not shipped by this milestone.

- [ ] Add extensible category/descriptor definitions; preserve six existing categories and old data.
- [ ] Add rating spoiler metadata and descriptor associations; separate representation records from severity.
- [ ] Add independent family votes with unique movie/user constraint and revision checks.
- [ ] Replace fixed six-category validation consistently across SQL and TypeScript.
- [ ] Introduce safe public summaries and selective reveal APIs with bounded input, no-store reveal responses and explicit user reveal.
- [ ] Ensure authenticated raw-own-contribution responses cannot enter shared caches; public raw table reads remain denied.

Acceptance: migration preserves existing assessments; users cannot edit another user's contributions; duplicate votes cannot increase weight; hidden category data absent from default JSON/HTML/metadata. Test mixed spoiler levels and disagreements, not just single records. Apply hosted migration only after local checks and required permission review.

### 2 — Compact product UI

Public first-open follow-up prepared 2026-10-13: dedicated service-only public import RPC, narrow NOLOGIN importer role with SELECT/INSERT only, visitor/global quotas consumed before TMDb fetch, same-origin CSRF and authoritative metadata. Anonymous retries use unique TMDb ID; authenticated key/body idempotency remains unchanged. Existing/hidden movies are not updated by the anonymous importer. 65 application tests, 164 embedded database assertions, typecheck and production build pass. Hosted migration and anonymous browser verification remain pending; sharing milestone is independently ready.

UI milestone implemented: five visible/three expandable signature questions; selective category reveal; lazy synopsis POST; eleven-category quick partial warnings with descriptors/spoiler levels; own independent family vote; historical full-form edit/delete retained under disclosure. Runtime/genres/certification share one upstream request. 57 application tests, typecheck and production build pass. Browser verified 5/3 disclosure, authenticated controls and lazy synopsis. 390px overflow check passed. Real new quick-warning/family publishing, physical Android/iOS and multi-account browser checks remain unverified. Public first-open importing, representation endpoints, public family consensus, full demographic descriptors and share UI remain pending; this is a UI milestone, not completion of every Phase 2 requirement.

- [ ] Integrate five visible questions and three expanded questions; Unknown defaults for new categories.
- [ ] Add compact factual details and separate representation section.
- [ ] Implement quick partial contribution and independent family voting using Phase 1 contracts.
- [ ] Fetch runtime/genres as optional metadata; failure must not block warnings.
- [ ] Make public first-open import abuse-limited; authenticated writing remains required.

Acceptance: narrow 320/390px layouts, keyboard/screen-reader labels, no overflow, factual warning access without unrelated reveals. Public imports require dedicated privileged RPC/quotas, not removal of the existing actor check.

### 3 — Comments, scenes and reports

Prepared 2026-10-13: private movie-note storage, optional comment/start/end/version/severity, three spoiler levels, lazy paginated public timeline, selected reveal, own CRUD and private reports/corrections. Conservative category visibility combines ratings and notes inside SQL summaries, timelines and sitemap. Chronological pagination uses only disclosed timestamps. Owner moderation runbook: supabase/NOTE_MODERATION.md, revision-checked private audit actions; no public admin endpoint. Notes cap twenty active entries per user/movie and share existing write quotas. Public UI wired with 16px form controls, account-keyed own payloads and reveal reset after refresh; privacy/About updated. 75 application tests, 231 embedded database assertions, typecheck and production build pass. Hosted migration and real note creation/edit/delete/report browser flow remain pending; no fabricated film notes were published. Representation/family consensus/image-sharing/production release checks remain later work.

- [ ] Plain-text bounded comments, start/end timestamps, optional version, spoiler selection.
- [ ] Lazy timeline with category filters and selected reveal; no comment payload until needed.
- [ ] Reports/corrections and owner hide/restore workflow with private audit trail.

Acceptance: malicious text rendered safely; timestamp ordering/version caveats; comments cannot bypass spoiler transformations; owner moderation can resolve reports.

### 4 — Social sharing

Basic link-sharing milestone integrated 2026-10-13: reviewed external model's MovieShare component, wired it into movie header. Canonical title/link only; native sharing availability, WhatsApp/Reddit anchors, copy/manual fallback. 64 tests and typecheck pass. Browser verified dialog opening, copy success feedback, Escape/focus restoration and 320px dialog/document widths without overflow. Actual OS native sharing and third-party posting remain unverified; no external message was sent. Downloadable image cards and final spoiler-safe OG artwork remain pending. Canonical movie links require MVP production deployment before recipients can use them on the public domain.

- [ ] Native share and copy/download fallback; WhatsApp/Reddit links.
- [ ] One 1080x1920 branded card first, from server-filtered data only.
- [ ] Verify poster permissions and CORS before embedding; original artwork fallback.
- [ ] Apply same spoiler policy to Open Graph/search snippets.

Acceptance: no fabricated verdicts, no hidden category leaks, unsupported APIs usable, no promise of direct Instagram Story publication.

### 5 — Community quality and launch

Representation/family follow-up prepared 2026-10-13: seven informational representation tags, owner revision/idempotency-protected add/remove, safe default read and selected reveal. Related tags share conservative spoiler visibility; no severity field exists for representation. Independent family upper-median summary and full distribution load only after explicit check in the Parents row, never from representation or warning values. Account/movie/refresh changes reset revealed payloads. Existing full assessment deletion includes its representation details (confirmation updated); individual representation removal preserves rating rows. 82 application tests, 256 embedded database assertions, typecheck and production build pass. Hosted migration and real mutation/browser verification remain pending.

- [ ] Revision-linked confirm/dispute votes; no self-confirmation; no verification solely by vote count.
- [ ] Permitted metadata/certification cache, refresh and expiry policy; bounded maintenance only.
- [ ] Production auth/cookies, simultaneous accounts, deployed Worker CPU, Android/iOS accessibility and moderation checks.

## Execution boundaries

Representation/family migration applied 2026-10-13; local filename matches hosted version 20261013011920. Anonymous safe representation and explicit family API reads returned HTTP 200 with honest missing-data states. Raw representation/votes remain denied to browser roles; temporary CREATE revoked. Browser verified explicit family check, informational theme empty state and no overflow at 320px. No representation or family votes were fabricated; real new write/edit/remove flows remain unverified in browser.

Phase 3 hosted migration applied 2026-10-13; local version aligned to 20261013010711. Verified anonymous public scenes API HTTP 200 with an empty list, raw notes/reports inaccessible to browser roles and writer CREATE removed. Browser confirmed lazy timeline loading, honest empty state and no horizontal overflow at 390px. Actual owner note publishing/edit/delete/report and multi-account browser flows remain unverified; no fake notes were created.

Hosted public-import migration applied after explicit approval on 2026-10-13. Local filename matches hosted version 20261013005222. Live HTTP verification used a session with no signed-in user: Kantara (2022), previously absent from Triggerboxd, imported with HTTP 201; public guide returned HTTP 200 with eleven categories. No assessments were fabricated. Verified direct anonymous RPC execution denied, service execution allowed, importer UPDATE and schema CREATE denied. Physical-device and anonymous browser click flow remain distinct unverified checks.

Each phase produces tests and a short evidence report. Work on one phase at a time. Do not deploy a partly migrated database/client combination. Licensing confirmation, category-spoiler conflict resolution and verified-absence wording remain explicit product gates. No new infrastructure is required.

Hosted Phase 1 applied 2026-10-12: category count 11; temporary CREATE permissions revoked. Supabase migration version 20261012162814 matches the local filename. Phase 2 UI integration underway.

## Story cards and live MVP release — 2026-10-13

Implemented downloadable 1080x1920 PNG Story cards inside the existing Share dialog. Original canvas artwork avoids poster embedding rights/CORS dependencies. Playful grandma-screening captions use only explicitly checked independent family opinion; unknown/early votes stay honest. No warnings, notes, representation, contributor identities or revealed-category payloads enter the renderer. Native Instagram publishing is not promised.

Verification: 85 application tests, 256 embedded database assertions, typecheck and Next/OpenNext production build passed. Browser verified real family-summary check, downloaded PNG dimensions and 319px no-horizontal-overflow; exported image visually inspected. Physical Android/iOS, multi-user mutation races, Google production login and confirm/dispute voting remain unverified/pending.

User authorized production deployment in this turn. Cloudflare API confirmed both triggerboxd.com and www.triggerboxd.com belong to lingering-king-c5c0; Wrangler identity/self-reference now match that Worker. Runtime configuration loaded via Worker secrets, never committed. Deployed version: 05134e24-eff6-4957-be2d-cb7532fd3022. Live homepage, session, movie search, public movie API and movie guide all returned 200. Session/movie APIs are private/no-store. Live browser verified actual guide rendering.

Remaining: community confirm/dispute workflow, personal preferences, metadata refresh/retention policy and TMDb licensing confirmation, physical-device/authenticated contribution QA, production CPU measurements. Main branch has not been merged; production deployment and Git feature-branch push are separate operations.

## Movie browsing redesign — 2026-10-13
- Poster grid opens a compact movie dialog: View guide, Watchlist, Contribute. Existing import and contribution APIs retained.
- Guide / Contribute tabs preserve drafts; eight static info explanations clarify the playful questions without revealing movie-specific answers.
- Watchlist is browser-local (200 films), explicitly disclosed in controls and privacy; account synchronization remains future work.
- Validation: 90 tests passed; typecheck and OpenNext production build passed. Browser checks at 320/390/1280 widths covered popup, keyboard dismissal/focus, tabs, draft retention, save/reload/remove, and biryani explanation. No observed console errors. Physical Android/iOS not tested.
- Visual comparison against generated concept: retained compact poster/dialog hierarchy and violet accents. Intentional differences: real TMDb artwork/original titles, browser-storage disclosure, existing navigation, honest warning caveats; no fabricated ratings or decorative warning icons.
